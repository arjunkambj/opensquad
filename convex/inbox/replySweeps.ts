/**
 * The recovery belt for reply handling (PLAN §9.1 "the sweep IS the retry
 * mechanism").
 *
 * WHY IT HAS TO EXIST. `handleInboundReply` is scheduled fire-and-forget from
 * the transaction that stores an inbound message. Convex does not re-run a
 * scheduled mutation that throws, so a single failure inside it — a read that
 * met an unexpected row, a downstream mutation that refused — left the thread
 * with an inbound message and no disposition, forever: not classified, not
 * shown as anything in the Inbox, and, worse, never put through the FREE
 * rules, so an unsubscribe or a hard bounce in that message was never acted
 * on. The receipt drain does not cover it: the receipt reached `handled` the
 * moment ingest committed, which is exactly when this schedule was made.
 *
 * WHAT IT RE-DRIVES. Conversations whose latest inbound is newer than their
 * latest disposition — the one honest definition of "this message never got a
 * verdict" — inside a bounded recovery window. Nothing else is touched.
 *
 * WHY THE WINDOW HAS TWO ENDS. The near end keeps the sweep from racing the
 * ingest transaction's own schedule. The far end is what stops it looping
 * forever on threads that legitimately have no disposition and never will: a
 * message in a thread we did not start, one older than the connection, one
 * flagged by the provider, our own echo. Every one of those is refused by the
 * history gate without writing anything, so without a far end they would fill
 * the sweep's page on every run and starve the threads that actually failed.
 *
 * IT SPENDS NOTHING BY ITSELF. Re-driving runs the gates again from scratch;
 * a thread that has since been dispositioned is refused with `already_handled`
 * before the paid call, and `free_only` threads never reach one at all.
 */
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { SWEEP_BATCH_SIZE } from "../lib/limits";
import { v } from "convex/values";

/**
 * How long an inbound message is left alone before the sweep re-drives it.
 * Comfortably longer than the ingest transaction's own commit-time schedule
 * plus the reply step behind it, so the belt never races the primary path.
 */
export const REPLY_REDRIVE_MIN_AGE_MS = 15 * 60 * 1000;

/**
 * How far back the sweep looks. Past this, a thread that still carries no
 * disposition is one the gates refuse by design, not one whose step was lost.
 */
export const REPLY_REDRIVE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Organizations examined per run. */
const ORG_SCAN_MAX = SWEEP_BATCH_SIZE;

/** Conversations examined per organization. */
const CONVERSATION_SCAN_MAX = 25;

/** Threads re-driven per run, across every organization. */
const REDRIVE_MAX = 25;

/**
 * Re-drive reply handling for conversations whose latest inbound never got a
 * verdict. Registered as the `inbound-reply-sweep` cron.
 */
export const sweepUndispositionedConversations = internalMutation({
  args: {},
  returns: v.object({ scanned: v.number(), redriven: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const newest = now - REPLY_REDRIVE_MIN_AGE_MS;
    const oldest = now - REPLY_REDRIVE_MAX_AGE_MS;
    let scanned = 0;
    let redriven = 0;

    // One bounded page of organizations. There is no global conversations
    // index over time — `by_orgId_and_lastInboundAt` is per organization — so
    // the sweep walks the tenants and ranges inside each one. Both bounds are
    // small, and the range itself is exact rather than a filtered page.
    const orgs = await ctx.db.query("orgs").take(ORG_SCAN_MAX);
    for (const org of orgs) {
      if (redriven >= REDRIVE_MAX) {
        break;
      }
      const candidates = await ctx.db
        .query("conversations")
        .withIndex("by_orgId_and_lastInboundAt", (q) =>
          q
            .eq("orgId", org._id)
            .gte("lastInboundAt", oldest)
            .lte("lastInboundAt", newest),
        )
        // Newest first: the most recent failure is the one a person is most
        // likely to be waiting on.
        .order("desc")
        .take(CONVERSATION_SCAN_MAX);
      for (const conversation of candidates) {
        if (redriven >= REDRIVE_MAX) {
          break;
        }
        scanned += 1;
        const lastInboundAt = conversation.lastInboundAt;
        if (
          lastInboundAt === undefined ||
          conversation.lastInboundMessageRef === undefined
        ) {
          continue;
        }
        // A disposition is only ever stamped for the LATEST inbound, so one at
        // or after this message's arrival IS this message's verdict — the same
        // rule `evaluateReplyHistory` reads for `already_handled`.
        if (
          conversation.lastDispositionAt !== undefined &&
          conversation.lastDispositionAt >= lastInboundAt
        ) {
          continue;
        }
        // Scheduled, never run inline: one thread whose handling throws must
        // not roll back the whole sweep.
        await ctx.scheduler.runAfter(
          0,
          internal.inbox.repliesSteps.handleInboundReply,
          {
            conversationId: conversation._id,
            messageRef: conversation.lastInboundMessageRef,
          },
        );
        redriven += 1;
      }
    }
    return { scanned, redriven };
  },
});
