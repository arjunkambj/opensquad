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
 *              unusable, or the credit wrapper itself said no (kill switch,
 *              budget, cap, rate limit; those never even reach `fn`) — and
 *              also when the gateway ANSWERED an error before generating
 *              anything: an unknown model id or an upstream rejection comes
 *              back as a 400 in ~50 ms (spikes §1), and 401/403/429 likewise
 *              cost nothing.
 *   uncertain  the request left us and we do not know what it did: a 5xx, a
 *              dropped connection, our own timeout. We THROW, so the hold
 *              parks as `uncertain` and the recovery sweep owns it. Handing
 *              back money we may have spent is not a refund.
 *   billed     a generation COMPLETED. The tokens are gone, so it is billed
 *              even when the object it produced is unusable: that case is
 *              retried once (worst case `ai_calls: 2`, `actualUnits` reports
 *              the attempts really made) and then returned as
 *              `{ status: "invalid_response" }` — billed, with no object.
 *
 * Provider and gateway wording never leaves `convex/ai/` (PLAN §4): a failure
 * becomes a `RefundReason`, a `DomainErrorCode` (`ai/failures.ts`) or
 * `invalid_response`, and the only thing kept from the gateway is the status
 * code, the token counts and the price it charged.
 */
import { generateText, jsonSchema, Output } from "ai";
import type { Infer, Validator } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { PaidCallOutcome, PaidWork } from "../billing/paidCall";
import { withCredits } from "../billing/withCredits";
import type { PaidAction } from "../lib/limits";
import { domainError } from "../lib/validators";
import { classifyGatewayError } from "./failures";
import { gatewayModel, MODELS, modelForTier } from "./models";
import type { ModelTier } from "./models";
import { parseStructured, strictJsonSchema } from "./structured";

/* ------------------------------------------------------------------ */
/* Bounded cost                                                        */
/*                                                                     */
/* These four belong in `convex/lib/limits.ts` with every other number */
/* the product spends money against; they are local constants only     */
/* because that file is integrator-only (EXECUTION §0).                */
/* ------------------------------------------------------------------ */

/** Characters of task input one call may carry. Scraped pages and threads
 *  are unbounded in the wild; a model bill must not be. */
const AI_INPUT_CHAR_BUDGET = 24_000;

/** Marks the cut so a model does not treat a severed sentence as the end. */
const AI_INPUT_TRUNCATION_MARK = "\n…[input truncated]";

/** Output ceiling per tier, unless the caller asks for a smaller one. */
const AI_MAX_OUTPUT_TOKENS: Record<ModelTier, number> = {
  fast: 1_024,
  smart: 4_096,
};

/** A completed generation whose object we reject is retried exactly once —
 *  hence the worst case of two billable calls per paid operation. */
const AI_MAX_ATTEMPTS = 2;

/** Transport-level retries inside the SDK, for 429/5xx answers that never
 *  generated anything. Kept low: a paid call may not sit on a hold. */
const AI_TRANSPORT_RETRIES = 1;

/** One call's wall-clock ceiling. Past it the outcome is unknown, not free. */
const AI_REQUEST_TIMEOUT_MS = 60_000;

/** What a second attempt is told, in words no task owns. */
const AI_RETRY_NUDGE =
  "\n\nThe previous answer did not match the required shape. Answer again, " +
  "using exactly the required fields and nothing else.";

/* ------------------------------------------------------------------ */
/* What a completed generation is worth                                */
/* ------------------------------------------------------------------ */

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
  /**
   * Health-check only (`ai/health.ts`): call a raw model id instead of the
   * tier's, so the gateway's "not a valid model ID" branch can be provoked
   * on a deployment. No product call site passes it.
   */
  modelId?: string;
};

/* ------------------------------------------------------------------ */
/* Reading a completed generation                                      */
/* ------------------------------------------------------------------ */

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

function truncateInput(input: string): string {
  return input.length <= AI_INPUT_CHAR_BUDGET
    ? input
    : input.slice(0, AI_INPUT_CHAR_BUDGET) + AI_INPUT_TRUNCATION_MARK;
}

/* ------------------------------------------------------------------ */
/* The call                                                            */
/* ------------------------------------------------------------------ */

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
  const modelId = args.modelId ?? MODELS[args.tier];
  const model =
    args.modelId === undefined ? modelForTier(args.tier) : gatewayModel(args.modelId);
  const maxOutputTokens = args.maxOutputTokens ?? AI_MAX_OUTPUT_TOKENS[args.tier];

  return await withCredits(
    ctx,
    {
      orgId: args.orgId,
      action: args.action,
      operationKey: args.operationKey,
      // Worst case is the retry: one completed generation whose object we
      // reject, plus the second attempt it earns.
      worstCaseProviderUnits: { ai_calls: AI_MAX_ATTEMPTS },
    },
    async (): Promise<PaidWork<StructuredResult<Infer<T>>>> => {
      const system = args.system.trim();
      const input = truncateInput(args.input.trim());
      if (system === "" || input === "" || maxOutputTokens <= 0) {
        // Our own input is unusable, so no request ever leaves us.
        return { outcome: "refunded", reason: "validation" };
      }

      let usage: AiUsage = { inputTokens: null, outputTokens: null, costUsd: null };
      let attempts = 0;

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
          if (failure.kind === "refunded") {
            return { outcome: "refunded", reason: failure.reason };
          }
          // Unknown outcome: throwing is what parks the hold as `uncertain`.
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
          // A getter: it throws when the step produced no parseable output.
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
      return {
        outcome: "billed",
        result: { status: "invalid_response", attempts, usage },
        actualUnits: { ai_calls: attempts },
        providerReference: usageReference(modelId, attempts, usage),
      };
    },
  );
}
