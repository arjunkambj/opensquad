/**
 * The receipt drain: re-drives `pending` inbound receipts whose scheduled
 * ingest was lost, and reaps outbound receipts that can no longer reach an
 * attempt so they stop accumulating.
 */
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { settleReceipt } from "./inboundModel";
import { v } from "convex/values";

/**
 * How stale a pending receipt must be before the drain re-drives it. Long
 * enough that the callback's own schedule, which runs at commit time, is not
 * raced by the cron.
 */
const DRAIN_MIN_AGE_MS = 2 * 60 * 1000;

/** Rows re-driven per sweep. */
const DRAIN_DISPATCH_LIMIT = 50;

/**
 * How old an outbound receipt that matches no send attempt must be before the
 * sweep settles it.
 *
 * An attempt records its `providerMessageRef` in the same transaction as the
 * provider's acceptance, so a receipt for mail this application sent finds its
 * attempt within seconds. A day later, no attempt in the workspace carries
 * that reference and none ever will — the message was sent from the shared
 * inbox by something other than OpenSquad, or it belongs to an attempt an
 * operator resolved as "not sent" and replaced under a new provider id.
 */
const OUTBOUND_REAP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Outbound rows examined per sweep. */
const OUTBOUND_REAP_LIMIT = 50;

/**
 * Re-drive inbound receipts that never reached a terminal handling state —
 * the recovery path G3 asks for ("retain a small replay/reconciliation record
 * so failed callback handling is visible and recoverable").
 *
 * It exists because the callback that schedules handling cannot be retried:
 * Workpool does not retry mutations, and the component will not re-dispatch an
 * `event_id` it has already ingested. Without this, one lost schedule strands
 * a verified reply forever.
 *
 * THE SCAN IS A RANGE, NOT A FILTERED PAGE. The two halves of the mail path
 * reach a terminal `handlingState` by completely different routes: an inbound
 * row through `applyInboundMessage`, an outbound one only once a send attempt
 * carries its `providerMessageRef`. An outbound receipt whose reference never
 * lands on an attempt therefore stays `pending` forever — and those rows, by
 * definition the oldest pending rows in the table, filled an oldest-first
 * page taken on `handlingState` alone. Two hundred of them and this sweep
 * returned `{scanned: 200, scheduled: 0}` on every run, silently, with the
 * recovery path for a lost inbound callback dead. `direction` leads the index
 * so the sweep ranges over inbound rows only (§5 — a post-filtered page is
 * not a filtered result). Each row is scheduled separately, not run inline, so
 * one poisoned receipt cannot roll back the whole sweep.
 *
 * The same run settles the outbound rows that produced that starvation, so
 * they stop accumulating — but only after proving the claim, by looking for
 * the attempt they would have folded onto.
 */
export const drainPendingInboundReceipts = internalMutation({
  args: {},
  returns: v.object({
    scanned: v.number(),
    scheduled: v.number(),
    reaped: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - DRAIN_MIN_AGE_MS;
    const stale = await ctx.db
      .query("emailEventReceipts")
      .withIndex("by_direction_and_handlingState_and_receivedAt", (q) =>
        q
          .eq("direction", "inbound")
          .eq("handlingState", "pending")
          .lt("receivedAt", cutoff),
      )
      .take(DRAIN_DISPATCH_LIMIT);
    for (const receipt of stale) {
      await ctx.scheduler.runAfter(0, internal.inbox.inbound.applyInboundMessage, {
        receiptId: receipt._id,
      });
    }
    const reaped = await reapUnmatchedOutboundReceipts(ctx, now);
    return { scanned: stale.length, scheduled: stale.length, reaped };
  },
});

/**
 * Settle outbound delivery receipts that can no longer reach an attempt.
 *
 * `sendReceipts.recordReceipt` folds a delivery fact onto its attempt the
 * moment either side knows about the other — at insert when the attempt
 * already carries the provider message reference, and from
 * `sendOutcome.recordSendOutcome` when the acknowledgement lands afterwards.
 * Nothing settles a receipt whose reference never appears on an attempt at
 * all: mail sent from the shared AgentMail inbox by something other than
 * OpenSquad, or the original of a timed-out send an operator resolved as
 * "not sent" and replaced under a new provider id. Those rows sat `pending`
 * forever.
 *
 * The claim is PROVED, not assumed: the same `by_providerMessageRef` lookup
 * the fold uses runs first, and a receipt whose attempt turns up is left
 * alone for the fold to handle. `failed` with a stated reason keeps the row
 * auditable in `sendAttempts.listReceipts` and replayable by hand.
 */
async function reapUnmatchedOutboundReceipts(
  ctx: MutationCtx,
  now: number,
): Promise<number> {
  const cutoff = now - OUTBOUND_REAP_MIN_AGE_MS;
  const rows = await ctx.db
    .query("emailEventReceipts")
    .withIndex("by_direction_and_handlingState_and_receivedAt", (q) =>
      q
        .eq("direction", "outbound")
        .eq("handlingState", "pending")
        .lt("receivedAt", cutoff),
    )
    .take(OUTBOUND_REAP_LIMIT);
  let reaped = 0;
  for (const receipt of rows) {
    const candidates = await ctx.db
      .query("sendAttempts")
      .withIndex("by_providerMessageRef", (q) =>
        q.eq("providerMessageRef", receipt.providerMessageRef),
      )
      .collect();
    if (
      candidates.some(
        (attempt) => attempt.workspaceId === receipt.workspaceId,
      )
    ) {
      continue;
    }
    await settleReceipt(ctx, receipt, "failed", "no_matching_send_attempt");
    reaped += 1;
  }
  return reaped;
}
