/**
 * The second half of a reveal: asking the job what happened and settling the
 * hold with the provider's own figures.
 *
 * `reveal.ts` submits and ends `uncertain` on purpose — the request has left
 * us and nobody knows yet what it cost. Everything that turns that unknown
 * into money lives here, and all of it goes through one door:
 * `billing/settlement.ts#reconcilePaidCall`, the only path allowed to RELEASE
 * an uncertain hold, precisely because this file looked the operation up
 * before calling it (PLAN §6 "recovery sweep").
 *
 * The authoritative number is `results.creditsUsed` minus what the job says
 * it refunded (spikes §3): lead-finder `meta` carries a request id and
 * nothing else, so no credit figure is ever read from a response envelope.
 */
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { internalAction, internalQuery } from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
import type { RefundReason } from "../../billing/paidCall";
import { vOperationErrorCode } from "../../lib/validators";
import type { OperationErrorCode } from "../../lib/validators";
import { enrichRequest, operationErrorCodeOf } from "./client";
import { firstRevealedContact, vRevealedContact } from "./revealContact";
import type { RevealedContact } from "./revealContact";
import { REVEAL_POLL_INTERVAL_MS } from "./reveal";
import { v } from "convex/values";

/**
 * How many times the belt re-polls before it stops (~2 minutes at the
 * documented 2-second interval). Past this the hold stays `uncertain` and
 * `reconcileRevealOperation` settles it from the job itself.
 */
const REVEAL_POLL_MAX_ATTEMPTS = 60;

/** The receipt a settled operation stores ends in `;ref=<jobId>`. */
const RECEIPT_REFERENCE = /;ref=([^;]+)$/;

const vRevealPollResult = v.union(
  v.object({
    status: v.literal("pending"),
    processed: v.optional(v.number()),
    total: v.optional(v.number()),
  }),
  v.object({
    status: v.literal("revealed"),
    contact: vRevealedContact,
    /** Provider units actually charged — zero when served from their cache. */
    providerCredits: v.number(),
  }),
  /** The provider looked and had no address on file. Never an invented one. */
  v.object({ status: v.literal("no_email"), providerCredits: v.number() }),
  v.object({ status: v.literal("failed"), code: vOperationErrorCode }),
  /** Nothing could be learned this time; the hold stays as it was. */
  v.object({ status: v.literal("unknown"), code: vOperationErrorCode }),
);

export type RevealPollResult =
  | { status: "pending"; processed?: number; total?: number }
  | { status: "revealed"; contact: RevealedContact; providerCredits: number }
  | { status: "no_email"; providerCredits: number }
  | { status: "failed"; code: OperationErrorCode }
  | { status: "unknown"; code: OperationErrorCode };

type PollResponse = {
  status?: unknown;
  progress?: { processed?: unknown; total?: unknown } | null;
  results?: {
    revealed?: unknown;
    creditsUsed?: unknown;
    creditsRefunded?: unknown;
  } | null;
  error?: unknown;
  creditsRefunded?: unknown;
};

/**
 * Ask one reveal job what happened and settle the hold with the answer.
 *
 * Free, idempotent and safe to call from anywhere: a settled operation
 * replays its recorded outcome instead of moving a counter, so the caller
 * polling for the address and the belt polling for the money cannot
 * double-settle each other.
 */
export const pollLeadReveal = internalAction({
  args: {
    orgId: v.id("orgs"),
    /** The key `revealLeadEmails` returned — already namespaced by action. */
    operationKey: v.string(),
    jobId: v.string(),
  },
  returns: vRevealPollResult,
  handler: async (ctx, args): Promise<RevealPollResult> => {
    const result = await enrichRequest<PollResponse>({
      path: `/lead-finder/reveal-jobs/${encodeURIComponent(args.jobId)}`,
      method: "GET",
      idempotent: true,
    });
    if (result.kind !== "ok") {
      return { status: "unknown", code: operationErrorCodeOf(result.reason) };
    }
    const body = result.data;
    const status = typeof body.status === "string" ? body.status : "";

    if (status === "pending" || status === "processing") {
      const progress = body.progress ?? undefined;
      return {
        status: "pending",
        ...(typeof progress?.processed === "number"
          ? { processed: progress.processed }
          : {}),
        ...(typeof progress?.total === "number" ? { total: progress.total } : {}),
      };
    }

    if (status === "failed") {
      // A failed job normally hands back everything it reserved — an
      // insufficient balance arrives here rather than as a 402 (spikes §3).
      // The provider's own figures still decide: anything it says it kept is
      // billed, and only the rest is refunded. The wording is read to
      // classify the refusal and then dropped; it never leaves this file.
      const kept = chargedOn(body);
      const reason: RefundReason = /insufficient/i.test(
        typeof body.error === "string" ? body.error : "",
      )
        ? "insufficient_credits"
        : "unknown";
      if (kept > 0) {
        await settle(ctx, args, {
          outcome: "billed",
          actualUnits: { enrich_credits: kept },
        });
      } else {
        await settle(ctx, args, { outcome: "refunded", reason });
      }
      return {
        status: "failed",
        code:
          reason === "insufficient_credits" ? "insufficient_credits" : "unknown",
      };
    }

    if (status !== "completed") {
      return { status: "unknown", code: "invalid_response" };
    }

    const providerCredits = chargedOn(body);
    const contact = firstRevealedContact((body.results ?? {}).revealed);
    if (contact === null && providerCredits === 0) {
      // The provider looked, had no address on file and charged nothing for
      // it. Nothing was bought, so the credits go back in full (PLAN §6).
      await settle(ctx, args, {
        outcome: "refunded",
        reason: "provider_charged_nothing",
      });
    } else {
      // An address came back, so the work WAS done and the user is charged
      // what the button said (PLAN §6: "credits commit at the posted price").
      // `providerCredits` is zero when the field was served from the
      // provider's 24-hour team cache — that is a hidden unit we did not
      // spend, not a free email: the hidden cap keeps its unit and only the
      // visible price is committed.
      await settle(ctx, args, {
        outcome: "billed",
        actualUnits: { enrich_credits: providerCredits },
      });
    }
    return contact === null
      ? { status: "no_email", providerCredits }
      : { status: "revealed", contact, providerCredits };
  },
});

/**
 * The belt behind a submitted reveal: poll until the job is terminal, then
 * stop. Past the bound the hold stays `uncertain` on purpose — PLAN §6's
 * sweep commits it after 24 hours unless `reconcileRevealOperation` gets a
 * real answer first.
 */
export const driveRevealPoll = internalAction({
  args: {
    orgId: v.id("orgs"),
    operationKey: v.string(),
    jobId: v.string(),
    attempt: v.number(),
  },
  returns: v.object({ status: v.string(), attempt: v.number() }),
  handler: async (ctx, args): Promise<{ status: string; attempt: number }> => {
    const polled: RevealPollResult = await ctx.runAction(
      internal.integrations.enrich.revealPoll.pollLeadReveal,
      {
        orgId: args.orgId,
        operationKey: args.operationKey,
        jobId: args.jobId,
      },
    );
    const keepGoing =
      (polled.status === "pending" || polled.status === "unknown") &&
      args.attempt < REVEAL_POLL_MAX_ATTEMPTS;
    if (keepGoing) {
      await ctx.scheduler.runAfter(
        REVEAL_POLL_INTERVAL_MS,
        internal.integrations.enrich.revealPoll.driveRevealPoll,
        { ...args, attempt: args.attempt + 1 },
      );
    }
    return { status: polled.status, attempt: args.attempt };
  },
});

/**
 * The provider half of PLAN §6's recovery sweep: given an `uncertain`
 * `get_email` hold, look its job up and settle from what the provider says.
 *
 * This is the ONLY way such a hold is released — `billing/sweeps.ts` may only
 * commit one, because releasing without proof hands back money we may have
 * spent.
 */
export const reconcileRevealOperation = internalAction({
  args: {
    orgId: v.id("orgs"),
    operationKey: v.string(),
  },
  returns: v.object({ resolved: v.boolean(), status: v.string() }),
  handler: async (ctx, args): Promise<{ resolved: boolean; status: string }> => {
    const recorded = await ctx.runQuery(
      internal.integrations.enrich.revealPoll.revealJobOf,
      { orgId: args.orgId, operationKey: args.operationKey },
    );
    if (recorded === null || recorded.jobId === null) {
      // No job reference was ever recorded, so there is nothing to look up
      // and the hold must wait for the worst-case commit.
      return { resolved: false, status: "no_reference" };
    }
    const polled: RevealPollResult = await ctx.runAction(
      internal.integrations.enrich.revealPoll.pollLeadReveal,
      {
        orgId: args.orgId,
        operationKey: args.operationKey,
        jobId: recorded.jobId,
      },
    );
    return {
      resolved:
        polled.status === "revealed" ||
        polled.status === "no_email" ||
        polled.status === "failed",
      status: polled.status,
    };
  },
});

/** The reveal job a recorded operation is waiting on, if it has one. */
export const revealJobOf = internalQuery({
  args: {
    orgId: v.id("orgs"),
    operationKey: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({ jobId: v.union(v.string(), v.null()), state: v.string() }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{ jobId: string | null; state: string } | null> => {
    const operation = await ctx.db
      .query("providerOperations")
      .withIndex("by_orgId_and_provider_and_operationKey", (q) =>
        q
          .eq("orgId", args.orgId)
          .eq("provider", "enrich")
          .eq("operationKey", args.operationKey),
      )
      .unique();
    if (operation === null) {
      return null;
    }
    // The job id is kept in the operation's backend receipt, which the
    // settle writes as `<provider>:<action>;credits=…;units=…;ref=<jobId>`.
    const match = RECEIPT_REFERENCE.exec(operation.componentRequestRef ?? "");
    return { jobId: match === null ? null : match[1], state: operation.state };
  },
});

/** Settle the hold through the reconciliation door. */
async function settle(
  ctx: ActionCtx,
  args: {
    orgId: Id<"orgs">;
    operationKey: string;
    jobId: string;
  },
  settlement:
    | { outcome: "billed"; actualUnits: { enrich_credits: number } }
    | { outcome: "refunded"; reason: RefundReason },
): Promise<void> {
  await ctx.runMutation(internal.billing.settlement.reconcilePaidCall, {
    orgId: args.orgId,
    provider: "enrich",
    operationKey: args.operationKey,
    outcome: settlement.outcome,
    ...(settlement.outcome === "billed"
      ? { actualUnits: settlement.actualUnits }
      : { reason: settlement.reason }),
    providerReference: args.jobId,
  });
}

/**
 * What the job really cost: `results.creditsUsed` minus what it refunded. A
 * refund is reported in two places depending on whether the job completed or
 * failed, so both are read and the larger is taken.
 */
function chargedOn(body: PollResponse): number {
  const results = body.results ?? {};
  const used = wholeNumber(results.creditsUsed);
  const refunded = Math.max(
    wholeNumber(results.creditsRefunded),
    wholeNumber(body.creditsRefunded),
  );
  return Math.max(0, used - refunded);
}

function wholeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}
