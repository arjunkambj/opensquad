/**
 * Getting a lead's work email — the expensive step (PLAN §6: 15 credits, and
 * the hidden cap that makes it at most ten per trial).
 *
 * It is two short steps, never one long action, because the provider's reveal
 * is a job:
 *
 *   submit (here)   reserve 10 provider credits for the lead, post ONE lead
 *                   with `fields: ["email"]`, and record the job id as the
 *                   operation's provider reference. The request has left us
 *                   and nobody knows yet what it cost, so the paid call ends
 *                   `uncertain` ON PURPOSE — that is the honest state, not a
 *                   failure.
 *   poll (revealPoll.ts)
 *                   ask the job what happened and settle the hold with the
 *                   provider's own figures.
 *
 * `phone` is unreachable from every code path: the field list is a constant
 * of this file, and a phone reveal costs 525 credits per lead.
 */
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { internalAction } from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
import { vRefundReason } from "../../billing/paidCall";
import type { RefundReason } from "../../billing/paidCall";
import { withCredits } from "../../billing/withCredits";
import { domainError, vOperationErrorCode } from "../../lib/validators";
import type { OperationErrorCode } from "../../lib/validators";
import { enrichRequest, operationErrorCodeOf, refundReasonOf } from "./client";
import type { EnrichUnknown } from "./client";
import { fetchWalletBalance } from "./wallet";
import { v } from "convex/values";

/** The only field this product ever buys. `phone` is 525 credits a lead. */
const REVEAL_FIELDS = ["email"] as const;

/** What one lead's email costs the provider account (spikes §3). */
export const REVEAL_CREDITS_PER_LEAD = 10;

/** The provider's own ceiling per request; also our batch ceiling. */
export const MAX_LEADS_PER_REVEAL = 25;

/** The provider documents a 2-second poll; the belt keeps to it. */
export const REVEAL_POLL_INTERVAL_MS = 2_000;

const vRevealSubmission = v.union(
  v.object({
    status: v.literal("submitted"),
    sourceLeadId: v.string(),
    /** The ledger's own key — pass it back to the poll and the reconcile. */
    operationKey: v.string(),
    jobId: v.string(),
  }),
  v.object({
    status: v.literal("refunded"),
    sourceLeadId: v.string(),
    reason: vRefundReason,
  }),
  /** This lead's reveal was already paid for; read the stored address. */
  v.object({
    status: v.literal("replayed"),
    sourceLeadId: v.string(),
    operationKey: v.string(),
  }),
  v.object({
    status: v.literal("failed"),
    sourceLeadId: v.string(),
    code: vOperationErrorCode,
  }),
);

export type RevealSubmission =
  | {
      status: "submitted";
      sourceLeadId: string;
      operationKey: string;
      jobId: string;
    }
  | { status: "refunded"; sourceLeadId: string; reason: RefundReason }
  | { status: "replayed"; sourceLeadId: string; operationKey: string }
  | { status: "failed"; sourceLeadId: string; code: OperationErrorCode };

type SubmitResponse = { jobId?: unknown; creditsReserved?: unknown };

/**
 * Buy the email addresses of up to 25 leads, one paid call each.
 *
 * One reveal per lead is not an implementation detail: the credit price is
 * per email (PLAN §6), so each lead gets its own reservation, its own
 * operation row and its own settlement. A batch that is half-refused is
 * therefore honest rather than all-or-nothing.
 *
 * The wallet is read first — free — so we never ask for more leads than the
 * platform balance can actually pay for, whatever our own ledger believes.
 */
export const revealLeadEmails = internalAction({
  args: {
    orgId: v.id("orgs"),
    leads: v.array(
      v.object({
        sourceLeadId: v.string(),
        /** Caller's own idempotency key for this lead, e.g. `<prospectId>`. */
        operationKey: v.string(),
      }),
    ),
  },
  returns: v.union(
    v.object({
      status: v.literal("done"),
      results: v.array(vRevealSubmission),
      /** Leads left unasked because the platform balance would not cover
       *  them. The caller may retry them later. */
      deferred: v.array(v.string()),
    }),
    v.object({ status: v.literal("failed"), code: vOperationErrorCode }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | { status: "done"; results: RevealSubmission[]; deferred: string[] }
    | { status: "failed"; code: OperationErrorCode }
  > => {
    if (args.leads.length === 0 || args.leads.length > MAX_LEADS_PER_REVEAL) {
      throw domainError(
        "INVALID",
        `leads must hold between 1 and ${MAX_LEADS_PER_REVEAL} entries`,
      );
    }
    const balance = await fetchWalletBalance();
    if (balance.kind !== "ok") {
      // Without a balance we cannot promise the reveals are payable, and a
      // reveal that fails for lack of funds still costs a round trip and a
      // parked hold. Refuse the batch; nothing was reserved.
      return { status: "failed", code: operationErrorCodeOf(balance.reason) };
    }
    const affordable = Math.max(
      0,
      Math.floor(balance.data.balance / REVEAL_CREDITS_PER_LEAD),
    );
    const asked = args.leads.slice(0, Math.min(args.leads.length, affordable));
    const deferred = args.leads
      .slice(asked.length)
      .map((lead) => lead.sourceLeadId);

    const results: RevealSubmission[] = [];
    for (const lead of asked) {
      results.push(
        await submitOne(ctx, {
          orgId: args.orgId,
          sourceLeadId: lead.sourceLeadId,
          operationKey: lead.operationKey,
        }),
      );
    }
    return { status: "done", results, deferred };
  },
});

/** One lead, one reservation, one job. */
async function submitOne(
  ctx: ActionCtx,
  args: {
    orgId: Id<"orgs">;
    sourceLeadId: string;
    operationKey: string;
  },
): Promise<RevealSubmission> {
  let unknownReason: EnrichUnknown | null = null;
  let jobId = "";
  let outcome;
  try {
    outcome = await withCredits(
      ctx,
      {
        orgId: args.orgId,
        action: "get_email",
        operationKey: args.operationKey,
        worstCaseProviderUnits: { enrich_credits: REVEAL_CREDITS_PER_LEAD },
      },
      async () => {
        const result = await enrichRequest<SubmitResponse>({
          path: "/lead-finder/reveal",
          method: "POST",
          body: {
            leads: [{ id: args.sourceLeadId }],
            fields: [...REVEAL_FIELDS],
          },
          // Never repeated after the request left us: a second submit is a
          // second job and a second charge.
          idempotent: false,
        });
        if (result.kind === "refused") {
          return {
            outcome: "refunded" as const,
            reason: refundReasonOf(result.reason),
          };
        }
        if (result.kind === "unknown") {
          unknownReason = result.reason;
          throw new Error("reveal submit outcome unknown");
        }
        const id =
          typeof result.data.jobId === "string" ? result.data.jobId : "";
        if (id === "") {
          // A 2xx we cannot follow up: the job may exist and may be charging.
          unknownReason = "invalid_response";
          throw new Error("reveal submit returned no job reference");
        }
        jobId = id;
        // The job is running. What it costs is not known until the poll, so
        // the hold stays — deliberately (PLAN §6 "uncertain").
        return { outcome: "uncertain" as const, providerReference: id };
      },
    );
  } catch (error) {
    if (unknownReason !== null) {
      return {
        status: "failed",
        sourceLeadId: args.sourceLeadId,
        code: operationErrorCodeOf(unknownReason),
      };
    }
    throw error;
  }

  if (outcome.kind === "refunded") {
    return {
      status: "refunded",
      sourceLeadId: args.sourceLeadId,
      reason: outcome.reason,
    };
  }
  if (outcome.kind === "billed") {
    return {
      status: "replayed",
      sourceLeadId: args.sourceLeadId,
      operationKey: outcome.operationKey,
    };
  }
  const operationKey = outcome.hold.operationKey;
  if (jobId === "") {
    // A replayed hold from an earlier submit: recover its job id from the
    // recorded receipt so the belt can still settle it.
    const recorded = await ctx.runQuery(
      internal.integrations.enrich.revealPoll.revealJobOf,
      { orgId: args.orgId, operationKey },
    );
    if (recorded === null || recorded.jobId === null) {
      return {
        status: "failed",
        sourceLeadId: args.sourceLeadId,
        code: "unknown",
      };
    }
    jobId = recorded.jobId;
  }
  // The belt: the caller may poll for the address itself, but the money must
  // settle even if the caller never comes back.
  await ctx.scheduler.runAfter(
    REVEAL_POLL_INTERVAL_MS,
    internal.integrations.enrich.revealPoll.driveRevealPoll,
    { orgId: args.orgId, operationKey, jobId, attempt: 1 },
  );
  return {
    status: "submitted",
    sourceLeadId: args.sourceLeadId,
    operationKey,
    jobId,
  };
}
