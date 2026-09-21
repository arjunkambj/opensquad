/**
 * The one door every AI call goes through (PLAN §4, §6, EXECUTION T03).
 *
 * `runStructured` is `withCredits` with a model behind it: it truncates the
 * input to a fixed character budget, bounds the output tokens, asks the
 * gateway for a schema-constrained object, re-validates that object with the
 * SAME Convex validator the schema was derived from, and reports back in the
 * three outcomes of PLAN §6. No task-specific prompt lives here — a task
 * brings its own `system`, `input` and result validator (`convex/ai/*.ts`).
 *
 * Failure accounting, which is the whole point of the wrapper:
 *
 *   refunded   refused before the request left us — our own input was
 *              unusable, the deployment's gateway token could not be minted,
 *              or the credit wrapper itself said no (kill switch, budget,
 *              cap, rate limit; those never even reach `fn`) — and also when
 *              the gateway ANSWERED an error before generating anything: an
 *              unknown model id or an upstream rejection comes back as a 400
 *              in ~50 ms (spikes §1), and 401/403/429 likewise cost nothing.
 *              A refusal only refunds while NO attempt has completed: once
 *              tokens are spent, a later refusal cannot unspend them.
 *   uncertain  the request left us and we do not know what it did: a 5xx, a
 *              dropped connection, our own timeout. We THROW, so the hold
 *              parks as `uncertain` and the recovery sweep owns it. Handing
 *              back money we may have spent is not a refund.
 *   billed     a generation COMPLETED. The tokens are gone, so it is billed
 *              even when the object it produced is unusable: that case is
 *              retried once (worst case `ai_calls: 2`, `actualUnits` reports
 *              the attempts really made) and then returned as
 *              `{ status: "invalid_response" }` — billed, with no object.
 *              The second attempt being refused changes nothing about the
 *              first one: the operation is still billed for what ran.
 *
 * Provider and gateway wording never leaves `convex/ai/` (PLAN §4): a failure
 * becomes a `RefundReason`, a `DomainErrorCode` (`ai/failures.ts`) or
 * `invalid_response`, and the only thing kept from the gateway is the status
 * code, the token counts and the price it charged.
 */
import { generateText, jsonSchema, Output } from "ai";
import { v } from "convex/values";
import type { Infer, Validator } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { PaidCallOutcome, PaidWork } from "../billing/paidCall";
import { setPlatformBreaker } from "../billing/platformBudgets";
import { withCredits } from "../billing/withCredits";
import type { PaidAction } from "../lib/limits";
import { domainError } from "../lib/validators";
import { classifyGatewayError } from "./failures";
import { gatewayTokenMintable, MODELS, modelForTier } from "./models";
import type { ModelTier } from "./models";
import { parseStructured, strictJsonSchema } from "./structured";

/** Characters of task input one call may carry. Scraped pages and threads
 *  are unbounded in the wild; a model bill must not be. */
const AI_INPUT_CHAR_BUDGET = 24_000;

/**
 * Characters reserved for the END of an over-long input (see `truncateInput`).
 * It has to cover the largest block any task puts last, which is
 * `handleReply.ts`'s fenced inbound reply — bounded at
 * `INBOUND_BODY_CONTEXT_MAX_LENGTH` (8 000) plus its subject and markers.
 * Deliberately a local number rather than an import: this door does not know
 * its tasks, it only guarantees them both ends.
 */
const AI_INPUT_TAIL_CHAR_BUDGET = 10_000;

/** Marks the cut so a model does not treat a severed sentence as the end. */
const AI_INPUT_TRUNCATION_MARK = "\n…[input truncated]\n";

/** Output ceiling per tier, unless the caller asks for a smaller one. */
const AI_MAX_OUTPUT_TOKENS: Record<ModelTier, number> = {
  fast: 1_024,
  smart: 4_096,
};

/** A completed generation whose object we reject is retried exactly once —
 *  hence the worst case of two billable calls per paid operation. */
const AI_MAX_ATTEMPTS = 2;

/**
 * Transport-level retries inside the SDK: NONE, so one attempt is exactly one
 * upstream request.
 *
 * The SDK's retry is invisible to us — it makes a second billable request
 * without telling us it did — so any non-zero value makes the reservation a
 * lie: two attempts at `maxRetries: 1` fit FOUR upstream calls under a
 * two-unit reserve, and `actualUnits` could only ever guess at what really
 * ran. Reserving the guess instead would be worse: it triples the hold every
 * call takes out of the hidden caps and the platform budget, and still would
 * not know what to commit. Nothing is lost by refusing it — the answers the
 * SDK retries on are exactly the ones classified before any generation (429
 * refunds, a 5xx parks `uncertain`), and PLAN §9.1 makes the recovery sweep
 * the retry mechanism for those.
 */
const AI_TRANSPORT_RETRIES = 0;

/** One call's wall-clock ceiling. Past it the outcome is unknown, not free. */
const AI_REQUEST_TIMEOUT_MS = 60_000;

/** What a second attempt is told, in words no task owns. */
const AI_RETRY_NUDGE =
  "\n\nThe previous answer did not match the required shape. Answer again, " +
  "using exactly the required fields and nothing else.";

/** The gateway's own accounting for a call: what it read, wrote and charged.
 *  Server-side only — it is recorded on `providerOperations`, never returned
 *  to a client. */
export type AiUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  /** `providerMetadata.convexGateway.cost` in USD when the gateway reports
   *  it (spikes §1), so the usage ledger shows actual spend per AI call. */
  costUsd: number | null;
};

/**
 * The result of a BILLED AI call. Two statuses, because "the tokens were
 * spent" and "we got something we can write" are different facts: a
 * generation that completed and then failed our own validation is billed and
 * returns no object.
 */
export type StructuredResult<T> =
  | { status: "object"; object: T; attempts: number; usage: AiUsage }
  | { status: "invalid_response"; attempts: number; usage: AiUsage };

export type RunStructuredArgs<T extends Validator<unknown, "required", string>> = {
  orgId: Id<"orgs">;
  /**
   * The action whose price applies. A single-provider AI action carries its
   * own credits (`generate_icp`, `recommend_signals`, `generate_keywords`,
   * `write_email`, `handle_reply`); the AI half of a two-provider action uses
   * the zero-credit `profile_company` / `score_lead`, because the user
   * already paid on the step that fetched the page (see `lib/limits.ts`).
   */
  action: PaidAction;
  tier: ModelTier;
  system: string;
  input: string;
  /** The shape of the answer. One source: the schema sent to the gateway is
   *  derived from this, and the answer is re-validated against it. */
  result: T;
  operationKey: string;
  maxOutputTokens?: number;
};

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function addUsage(total: AiUsage, step: AiUsage): AiUsage {
  const sum = (a: number | null, b: number | null): number | null =>
    a === null && b === null ? null : (a ?? 0) + (b ?? 0);
  return {
    inputTokens: sum(total.inputTokens, step.inputTokens),
    outputTokens: sum(total.outputTokens, step.outputTokens),
    costUsd: sum(total.costUsd, step.costUsd),
  };
}

/** The receipt kept on `providerOperations`: what the gateway charged and
 *  how many attempts it took. No provider wording, no prompt, no answer. */
function usageReference(modelId: string, attempts: number, usage: AiUsage): string {
  const parts = [`model=${modelId}`, `attempts=${attempts}`];
  if (usage.inputTokens !== null) {
    parts.push(`in=${usage.inputTokens}`);
  }
  if (usage.outputTokens !== null) {
    parts.push(`out=${usage.outputTokens}`);
  }
  if (usage.costUsd !== null) {
    parts.push(`cost=${usage.costUsd}`);
  }
  return parts.join(";");
}

/**
 * Cut an over-long input down to the budget by taking the middle out of it,
 * never an end.
 *
 * THE CONTRACT EVERY PROMPT BUILDER IS WRITTEN AGAINST: truncation eats the
 * bulk — the scraped page, the quoted thread — and never the task. The
 * builders honour it by putting their unbounded material where it can be
 * eaten, and they do not agree on which end that is: `researchLead.ts` and
 * `writeOutreach.ts` put the page and the old mail LAST, while
 * `handleReply.ts` puts the reply to classify last precisely because it is
 * the task. Keeping only the head would throw that reply away; keeping only
 * the tail would throw the other two tasks' instructions away. So both ends
 * survive and the cut is taken out of the middle, which is bulk under every
 * builder's layout.
 */
function truncateInput(input: string): string {
  if (input.length <= AI_INPUT_CHAR_BUDGET) {
    return input;
  }
  const head = input.slice(0, AI_INPUT_CHAR_BUDGET - AI_INPUT_TAIL_CHAR_BUDGET);
  const tail = input.slice(input.length - AI_INPUT_TAIL_CHAR_BUDGET);
  return head + AI_INPUT_TRUNCATION_MARK + tail;
}

/* The platform breaker for AI (PLAN §6 "Platform-wide circuit         */
/* breakers")                                                          */

/**
 * A 402 from the gateway is not this org's problem: it says the PLATFORM's
 * own funds are gone, so the next call, and every other org's next call, will
 * fail the same way. Refunding each one and moving on would reserve and
 * release for ever with nothing tripped and nothing to alert on.
 *
 * So it trips a breaker the same way the lead-data watchdog does
 * (`billing/platformBalance.ts`): a marker far larger than any real usage is
 * added to the `ai_calls` platform budget for the current period, which
 * `withCredits` already checks, so every paid AI call then refuses with the
 * neutral capacity code before it reserves anything. The genuine usage under
 * the marker is preserved, and because `ai_calls` resets on the UTC day the
 * trip clears itself with the period — an operator who has topped the
 * platform up sooner clears it by calling this with `tripped: false`.
 *
 * The marker convention itself lives in `billing/platformBudgets.ts` and is
 * shared with the lead-data wallet watchdog, so there is one definition of
 * what a tripped breaker looks like in the budget row.
 */
export const setAiGatewayBreaker = internalMutation({
  args: { tripped: v.boolean() },
  returns: v.object({ tripped: v.boolean(), changed: v.boolean() }),
  handler: async (ctx, args): Promise<{ tripped: boolean; changed: boolean }> => {
    const changed = await setPlatformBreaker(ctx, "ai_calls", args.tripped);
    return { tripped: args.tripped, changed };
  },
});

/**
 * Trip the breaker from inside a paid call. It is an alarm, not the money
 * rule: a trip that fails must never turn a provable refund into an
 * `uncertain` hold, so nothing here throws.
 */
async function tripAiGatewayBreaker(ctx: ActionCtx): Promise<void> {
  try {
    const applied = await ctx.runMutation(internal.ai.run.setAiGatewayBreaker, {
      tripped: true,
    });
    if (applied.changed) {
      console.error(
        "ai gateway reports the platform is out of funds: paid AI calls stopped for this period",
      );
    }
  } catch (error) {
    console.error("ai gateway breaker could not be tripped", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Run one schema-constrained generation as a paid call.
 *
 * Returns the three outcomes of PLAN §6 unflattened, so a caller can tell
 * "we were refused and owe nothing" from "we paid and got nothing usable"
 * from "we do not know". A `billed` + `replayed` outcome carries no object:
 * that operation was already bought once, and the caller re-reads whatever it
 * stored under this `operationKey` instead of paying again.
 */
export async function runStructured<T extends Validator<unknown, "required", string>>(
  ctx: ActionCtx,
  args: RunStructuredArgs<T>,
): Promise<PaidCallOutcome<StructuredResult<Infer<T>>>> {
  // Derived BEFORE any money moves: a result validator this mapping cannot
  // express is a bug in the task, not a refusal to charge a user for.
  const schema = jsonSchema<unknown>(strictJsonSchema(args.result));
  const modelId = MODELS[args.tier];
  const model = modelForTier(args.tier);
  const maxOutputTokens = args.maxOutputTokens ?? AI_MAX_OUTPUT_TOKENS[args.tier];

  return await withCredits(
    ctx,
    {
      orgId: args.orgId,
      action: args.action,
      operationKey: args.operationKey,
      // Worst case is the retry: one completed generation whose object we
      // reject, plus the second attempt it earns. It is also the real
      // upstream count, because `AI_TRANSPORT_RETRIES` is 0 — one attempt is
      // one request, and no call can quietly cost more than it reserved.
      worstCaseProviderUnits: { ai_calls: AI_MAX_ATTEMPTS },
    },
    async (): Promise<PaidWork<StructuredResult<Infer<T>>>> => {
      const system = args.system.trim();
      const input = truncateInput(args.input.trim());
      if (system === "" || input === "" || maxOutputTokens <= 0) {
        // Our own input is unusable, so no request ever leaves us.
        return { outcome: "refunded", reason: "validation" };
      }
      if (!(await gatewayTokenMintable())) {
        // The gateway is not usable by this deployment. Nothing left the
        // process, so this is a refund and not a hold.
        return { outcome: "refunded", reason: "platform_capacity" };
      }

      let usage: AiUsage = { inputTokens: null, outputTokens: null, costUsd: null };
      let attempts = 0;

      /** Everything already paid for, with no object to show for it. The
       *  shape a later refusal collapses to once tokens have been spent. */
      const billedSoFar = (): PaidWork<StructuredResult<Infer<T>>> => ({
        outcome: "billed",
        result: { status: "invalid_response", attempts, usage },
        actualUnits: { ai_calls: attempts },
        providerReference: usageReference(modelId, attempts, usage),
      });

      while (attempts < AI_MAX_ATTEMPTS) {
        const prompt = attempts === 0 ? input : input + AI_RETRY_NUDGE;
        // Our own deadline, built from the two primitives this deployment is
        // known to have (`integrations/agentmail.ts` uses the same pair)
        // rather than the SDK's `timeout`, which reaches for
        // `AbortSignal.timeout` — unverified in the Convex runtime.
        const deadline = new AbortController();
        const timer = setTimeout(
          () => deadline.abort(new Error("ai request deadline")),
          AI_REQUEST_TIMEOUT_MS,
        );
        let generated;
        try {
          generated = await generateText({
            model,
            system,
            prompt,
            output: Output.object({ schema }),
            maxOutputTokens,
            maxRetries: AI_TRANSPORT_RETRIES,
            abortSignal: deadline.signal,
          });
        } catch (error) {
          const failure = classifyGatewayError(error);
          if (failure.kind === "invalid_response") {
            // The generation COMPLETED and the answer was unusable. In
            // `ai@7` that arrives as a throw, not as a value: `generateText`
            // awaits `parseCompleteOutput` inside its own body and raises
            // `NoObjectGeneratedError` before it can return. The tokens are
            // gone, so this attempt is counted and billed like any other, and
            // it is what earns the retry this call reserved for.
            attempts += 1;
            usage = addUsage(usage, {
              inputTokens: finiteOrNull(failure.usage?.inputTokens),
              outputTokens: finiteOrNull(failure.usage?.outputTokens),
              // The error carries the token counts but no provider metadata,
              // so this attempt's gateway cost is simply not knowable.
              costUsd: null,
            });
            continue;
          }
          // Refund ONLY what is proven not to have been charged (PLAN §6): a
          // first attempt that already completed is money spent, whatever the
          // second attempt was then refused for.
          if (failure.kind === "platform_exhausted") {
            await tripAiGatewayBreaker(ctx);
            return attempts === 0
              ? { outcome: "refunded", reason: "platform_capacity" }
              : billedSoFar();
          }
          if (failure.kind === "refunded") {
            return attempts === 0
              ? { outcome: "refunded", reason: failure.reason }
              : billedSoFar();
          }
          // Unknown outcome: throwing is what parks the hold as `uncertain`,
          // at the worst case, which is the one honest answer when an attempt
          // that may have generated follows one that certainly did.
          throw domainError(failure.code, failure.message);
        } finally {
          clearTimeout(timer);
        }

        // Past this line the tokens are spent, whatever the answer says.
        attempts += 1;
        usage = addUsage(usage, {
          inputTokens: finiteOrNull(generated.usage.inputTokens),
          outputTokens: finiteOrNull(generated.usage.outputTokens),
          costUsd: finiteOrNull(
            generated.finalStep.providerMetadata?.convexGateway?.cost,
          ),
        });

        let answered: unknown = null;
        try {
          // A getter, and still a throwing one: an answer that failed the
          // schema never reaches here (it was raised inside `generateText`
          // and handled above), but a step that produced NO output at all —
          // empty text, or a finish reason the SDK will not parse — leaves
          // the getter with nothing and raises `NoOutputGeneratedError`.
          answered = generated.output;
        } catch {
          answered = null;
        }
        const object = answered === null ? null : parseStructured(args.result, answered);
        if (object !== null) {
          return {
            outcome: "billed",
            result: { status: "object", object, attempts, usage },
            actualUnits: { ai_calls: attempts },
            providerReference: usageReference(modelId, attempts, usage),
          };
        }
      }

      // Both attempts completed and neither answer survived our validation.
      // Billed: the model did the work, badly.
      return billedSoFar();
    },
  );
}
