/**
 * The delivery-uncertain ask and the stale-request sweeps.
 *
 * An attempt whose action died between dispatch and outcome cannot be
 * assumed failed: it moves to `uncertain`, which KEEPS capacity blocked
 * deliberately — we cannot prove we were not billed.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { recordActivityEvent } from "../activity/model";
import { REQUEST_STALE_SWEEP_MS } from "./sendModel";
import { v } from "convex/values";

/** Shared uncertain transition for a stale `requesting` attempt. */
async function markLostAcknowledgement(
  ctx: MutationCtx,
  attempt: Doc<"sendAttempts">,
): Promise<boolean> {
  if (
    attempt.state !== "requesting" ||
    attempt.requestStartedAt === undefined
  ) {
    return false;
  }
  await ctx.db.patch("sendAttempts", attempt._id, {
    state: "uncertain",
    error: {
      message:
        "dispatch outcome was never recorded — provider acknowledgement lost",
      at: Date.now(),
      reason: "lost_acknowledgement",
    },
    updatedAt: Date.now(),
  });
  const reservation = await ctx.runMutation(
    internal.billing.reservations.getByOperationKey,
    {
      orgId: attempt.orgId,
      operationKey: attempt.operationKey,
    },
  );
  if (reservation !== null && reservation.state === "reserved") {
    await ctx.runMutation(internal.billing.reservations.markUncertain, {
      orgId: attempt.orgId,
      operationKey: attempt.operationKey,
    });
  }
  const draft = await ctx.db.get("drafts", attempt.draftId);
  if (draft !== null) {
    await recordActivityEvent(ctx, {
      orgId: attempt.orgId,
      kind: "send_attempt_uncertain",
      summary: "Send attempt lost its acknowledgement — marked uncertain",
      actor: "system",
      dedupeKey: `sendattempt:${attempt._id}:uncertain`,
      conversationId: attempt.conversationId,
    });
  }
  return true;
}

/**
 * Lost-acknowledgement sweep: a `requesting` attempt older than the provider
 * timeout + margin means the dispatch action died between the commit point
 * and outcome recording. The attempt becomes `uncertain` (capacity retained)
 * and the delivery-uncertain ask is opened. Scheduled by the dispatch path
 * and safe to call at any time — any other state is a no-op.
 */
export const sweepStaleRequesting = internalMutation({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: v.object({ swept: v.boolean() }),
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null) {
      return { swept: false };
    }
    if (
      attempt.requestStartedAt !== undefined &&
      attempt.requestStartedAt + REQUEST_STALE_SWEEP_MS > Date.now()
    ) {
      return { swept: false };
    }
    return { swept: await markLostAcknowledgement(ctx, attempt) };
  },
});

/**
 * The cron belt (see `crons.ts`): org-agnostic sweep covering the two
 * durable wait states. `requesting` rows past the stale margin get the
 * lost-acknowledgement treatment; `reserved` rows whose recorded
 * `nextPermittedAt` passed get a fresh `dispatchAttempt` schedule — covers
 * a scheduled wake that never fired. Both bounds keep the scan small.
 */
export const sweepStaleAttemptsGlobal = internalMutation({
  args: {},
  returns: v.object({ swept: v.number(), redriven: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const staleRequesting = await ctx.db
      .query("sendAttempts")
      .withIndex("by_state_and_updatedAt", (q) =>
        q
          .eq("state", "requesting")
          .lt("updatedAt", now - REQUEST_STALE_SWEEP_MS),
      )
      .take(64);
    let swept = 0;
    for (const attempt of staleRequesting) {
      if (await markLostAcknowledgement(ctx, attempt)) {
        swept += 1;
      }
    }
    const overdue = await ctx.db
      .query("sendAttempts")
      .withIndex("by_state_and_nextPermittedAt", (q) =>
        q.eq("state", "reserved").lte("nextPermittedAt", now),
      )
      .take(64);
    let redriven = 0;
    for (const attempt of overdue) {
      // The wake is re-armed against the CURRENT time — the recorded
      // instant already passed. dispatchAttempt re-runs every gate; a
      // still-blocked attempt re-parks itself with a fresh schedule.
      await ctx.scheduler.runAfter(0, internal.outreach.sendActions.dispatchAttempt, {
        sendAttemptId: attempt._id,
      });
      redriven += 1;
    }
    return { swept, redriven };
  },
});
