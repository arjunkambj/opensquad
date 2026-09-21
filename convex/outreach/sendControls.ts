/**
 * The public triggers over the send boundary: ask for a dispatch, ask for a
 * reconciliation, cancel an attempt. Each one authorises the caller and then
 * schedules the internal action — no public function ever talks to a
 * provider itself.
 */
import { internal } from "../_generated/api";
import { internalMutation, mutation } from "../_generated/server";
import { recordActivityEvent } from "../activity/model";
import { requireOrgMember } from "../lib/auth";
import { domainError } from "../lib/validators";
import { getDraftInOrg } from "./draftsModel";
import { vSendAttemptDoc } from "./sendAttempts";
import { RECONCILE_WINDOW_MS } from "./sendModel";
import { v } from "convex/values";

/**
 * Trigger the send boundary for a draft (owner/operator). Only schedules —
 * every gate still runs inside `sendApprovedDraft`; calling this on an
 * unapproved draft is a safe no-op that surfaces `preflight_refused` in the
 * attempt audit. Idempotent via the operation key.
 */
export const requestDispatch = mutation({
  args: {
    orgId: v.id("orgs"),
    draftId: v.id("drafts"),
  },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    await getDraftInOrg(ctx, args.orgId, args.draftId);
    await ctx.scheduler.runAfter(
      0,
      internal.outreach.sendActions.sendApprovedDraft,
      {
        draftId: args.draftId,
      },
    );
    return { scheduled: true };
  },
});

/**
 * Ask for one guarded reconciliation replay of an uncertain attempt
 * (owner/operator). Refuses once the provider's idempotency window has
 * expired — that case is human-review-only by design.
 */
export const requestReconciliation = mutation({
  args: {
    orgId: v.id("orgs"),
    sendAttemptId: v.id("sendAttempts"),
  },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null || attempt.orgId !== args.orgId) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    if (attempt.state !== "uncertain") {
      throw domainError(
        "CONFLICT",
        `attempt is ${attempt.state}; reconciliation applies to uncertain attempts only`,
      );
    }
    const started = attempt.requestStartedAt ?? attempt.createdAt;
    if (started + RECONCILE_WINDOW_MS < Date.now()) {
      throw domainError(
        "CONFLICT",
        "the provider idempotency window has expired — a human must resolve the uncertain attempt instead",
      );
    }
    await ctx.scheduler.runAfter(
      0,
      internal.outreach.sendReconcile.reconcileUncertainAttempt,
      { sendAttemptId: args.sendAttemptId },
    );
    return { scheduled: true };
  },
});

/**
 * Cancel a `reserved` (pre-dispatch) send intent — the only attempt state a
 * human can retract, because nothing has reached the provider yet.
 */
export const cancelAttempt = mutation({
  args: {
    orgId: v.id("orgs"),
    sendAttemptId: v.id("sendAttempts"),
  },
  returns: vSendAttemptDoc,
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null || attempt.orgId !== args.orgId) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    if (attempt.state !== "reserved") {
      throw domainError(
        "CONFLICT",
        `attempt is ${attempt.state}; only a reserved (pre-dispatch) intent can be cancelled`,
      );
    }
    const now = Date.now();
    await ctx.db.patch("sendAttempts", attempt._id, {
      state: "cancelled",
      error: { message: "cancelled by operator", at: now, reason: "manual" },
      updatedAt: now,
    });
    const reservation = await ctx.runMutation(
      internal.billing.reservations.getByOperationKey,
      {
        orgId: args.orgId,
        operationKey: attempt.operationKey,
      },
    );
    if (reservation !== null && reservation.state === "reserved") {
      await ctx.runMutation(internal.billing.reservations.release, {
        orgId: args.orgId,
        operationKey: attempt.operationKey,
      });
    }
    const draft = await ctx.db.get("drafts", attempt.draftId);
    if (draft !== null) {
      await recordActivityEvent(ctx, {
        orgId: args.orgId,
        kind: "send_attempt_cancelled",
        summary: "Reserved send intent cancelled by operator",
        actor: "operator",
        dedupeKey: `sendattempt:${attempt._id}:cancelled`,
        conversationId: attempt.conversationId,
      });
    }
    const updated = await ctx.db.get("sendAttempts", attempt._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "send attempt not found after update");
    }
    return updated;
  },
});

/**
 * Retire every parked `reserved` intent on a conversation — invoked by
 * `drafts` when a revision or inbound context invalidates the draft an
 * attempt was authorized against. `reserved` is provably pre-dispatch (the
 * commit point flips to `requesting`), so cancelling can never retract a
 * sent request; `requesting`/`uncertain` rows are untouched — those are
 * honest in-flight states the reconcile path owns.
 */
export const cancelParkedConversationAttempts = internalMutation({
  args: {
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
    reason: v.string(),
  },
  returns: v.object({ cancelled: v.number() }),
  handler: async (ctx, args) => {
    const parked = await ctx.db
      .query("sendAttempts")
      .withIndex("by_conversationId_and_state", (q) =>
        q
          .eq("conversationId", args.conversationId)
          .eq("state", "reserved"),
      )
      .collect();
    const now = Date.now();
    for (const attempt of parked) {
      await ctx.db.patch("sendAttempts", attempt._id, {
        state: "cancelled",
        error: {
          message: args.reason.slice(0, 200),
          at: now,
          reason: "superseded",
        },
        updatedAt: now,
      });
      const reservation = await ctx.runMutation(
        internal.billing.reservations.getByOperationKey,
        {
          orgId: args.orgId,
          operationKey: attempt.operationKey,
        },
      );
      if (reservation !== null && reservation.state === "reserved") {
        await ctx.runMutation(internal.billing.reservations.release, {
          orgId: args.orgId,
          operationKey: attempt.operationKey,
        });
      }
      const draft = await ctx.db.get("drafts", attempt.draftId);
      if (draft !== null) {
        await recordActivityEvent(ctx, {
          orgId: args.orgId,
          kind: "send_attempt_cancelled",
          summary: `Parked send intent retired — ${args.reason.slice(0, 160)}`,
          actor: "workflow",
          dedupeKey: `sendattempt:${attempt._id}:cancelled`,
          conversationId: args.conversationId,
        });
      }
    }
    return { cancelled: parked.length };
  },
});
