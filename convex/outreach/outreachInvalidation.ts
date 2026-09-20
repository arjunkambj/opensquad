/**
 * PLAN §9.1's invalidation table, for the two events that retire OUTREACH
 * work: the agent's wording changed, and the lead replied.
 *
 * The rule the whole table rests on: the authoritative check is at the moment
 * of effect. `sendGates.evaluateSendGates` re-validates everything inside the
 * send mutation's own transaction, so a draft this file fails to retire can
 * still never be mailed. Retiring it is the COURTESY on top — it is what
 * turns "refused forever" into "rewritten on the next pass", and what stops a
 * stale parked intent blocking the conversation until its wake fires.
 *
 * The other three rows of the table are elsewhere by design:
 *   pause / kill switch — `outreachPlan.agentRunsOutreach` starts nothing new,
 *   and unsent drafts are deliberately left as drafts;
 *   reject — `leads/approval.cancelWorkForRejectedLead` already supersedes the
 *   lead's open drafts and cancels its parked attempts in the rejecting
 *   transaction;
 *   unsubscribe / blocklist — a suppression row, re-read at send time.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { boundedString, domainError } from "../lib/validators";
import { CONVERSATION_SCAN_MAX, draftIsUnsent } from "./outreachLeadState";
import { v } from "convex/values";

/**
 * Supersede a conversation's UNSENT open draft and retire the pre-dispatch
 * intents authorized against it.
 *
 * `state` and `supersededAt` move together — see `vDraftState`. Only a
 * `current` row is touched, and only one that never reached the provider: a
 * draft stays `current` after it is sent, and sent mail is untouched by every
 * row of the table. Parked (`reserved`) attempts are retired through the send
 * boundary's own mutation, which releases the usage reservation each one
 * holds; `requesting` and `uncertain` rows are never touched here, because a
 * request that already left us is not ours to retract (PLAN §9.1
 * "Cancellation never decides money").
 */
export async function retireConversationDrafts(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  reason: string,
): Promise<number> {
  const open = await ctx.db
    .query("drafts")
    .withIndex("by_conversationId_and_state", (q) =>
      q.eq("conversationId", conversation._id).eq("state", "current"),
    )
    .take(CONVERSATION_SCAN_MAX);
  const now = Date.now();
  let superseded = 0;
  for (const draft of open) {
    if (!(await draftIsUnsent(ctx, draft._id))) {
      continue;
    }
    await ctx.db.patch("drafts", draft._id, {
      state: "superseded",
      supersededAt: now,
    });
    superseded += 1;
  }
  await ctx.runMutation(
    internal.outreach.sendControls.cancelParkedConversationAttempts,
    {
      orgId: conversation.orgId,
      conversationId: conversation._id,
      reason,
    },
  );
  return superseded;
}

/* ------------------------------------------------------------------ */
/* A reply arrived                                                     */
/* ------------------------------------------------------------------ */

/**
 * THE "a reply arrived" helper (PLAN §9.1): cancel this conversation's queued
 * follow-ups and supersede its unsent drafts.
 *
 * Called by the reply flow in the SAME transaction that stores the reply, so
 * a follow-up can never be dispatched by something that started a millisecond
 * after the reply landed. The other two halves of that row of the table
 * already happen in that transaction today:
 * `conversationStaging.applyInboundContext` advances `contextVersion` (which
 * makes every recorded approval stop applying), and `leads.mutations.markReplied`
 * moves the lead to `replied` and clears its due time.
 *
 * Deliberately NOT a takeover and NOT a suppression: answering a reply is a
 * legitimate next step, and the reply flow decides that separately.
 */
export const retireOutreachForReply = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    reason: v.optional(v.string()),
  },
  returns: v.object({ draftsSuperseded: v.number() }),
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    const reason = boundedString(
      args.reason ?? "the lead replied — queued outreach for this thread is retired",
      "reason",
      { min: 1, max: 500 },
    );
    const draftsSuperseded = await retireConversationDrafts(
      ctx,
      conversation,
      reason,
    );
    return { draftsSuperseded };
  },
});

/* ------------------------------------------------------------------ */
/* The agent's wording changed                                         */
/* ------------------------------------------------------------------ */

/**
 * Retire the mail one lead has queued under a superseded agent revision, and
 * make the lead due for a rewrite.
 *
 * PLAN §9.1: "unsent drafts under the old revision → `superseded` and
 * rewritten on the next pass (1 credit each, only for leads still due); sent
 * mail untouched". Sent mail is untouched here by construction — an
 * acknowledged send has no `current` draft left to supersede, and nothing in
 * this file reads `sendAttempts` at all.
 */
export const refreshStaleRevisionLead = internalMutation({
  args: {
    agentId: v.id("agents"),
    prospectId: v.id("prospects"),
  },
  returns: v.object({ refreshed: v.boolean(), draftsSuperseded: v.number() }),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    const lead = await ctx.db.get("prospects", args.prospectId);
    if (agent === null || lead === null || lead.agentId !== agent._id) {
      return { refreshed: false, draftsSuperseded: 0 };
    }
    // A lead a person has taken out of the pipeline is not rewritten, and
    // neither is one that has replied — the rewrite would only be refused.
    if (
      lead.approval !== "approved" ||
      lead.lastReplyAt !== undefined ||
      lead.stage === "rejected" ||
      lead.stage === "closed_lost" ||
      lead.stage === "needs_attention"
    ) {
      return { refreshed: false, draftsSuperseded: 0 };
    }

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_prospectId", (q) => q.eq("prospectId", lead._id))
      .take(CONVERSATION_SCAN_MAX);
    let draftsSuperseded = 0;
    for (const conversation of conversations) {
      if (conversation.orgId !== lead.orgId) {
        continue;
      }
      const stale = await hasStaleCurrentDraft(ctx, conversation, agent.revision);
      if (!stale) {
        continue;
      }
      draftsSuperseded += await retireConversationDrafts(
        ctx,
        conversation,
        `the agent's instructions moved to revision ${agent.revision} after this draft was written`,
      );
    }
    if (draftsSuperseded === 0) {
      return { refreshed: false, draftsSuperseded: 0 };
    }
    // Due now: the next tick writes the message the agent would say today.
    await ctx.db.patch("prospects", lead._id, {
      nextActionAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { refreshed: true, draftsSuperseded };
  },
});

async function hasStaleCurrentDraft(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  revision: number,
): Promise<boolean> {
  const open = await ctx.db
    .query("drafts")
    .withIndex("by_conversationId_and_state", (q) =>
      q.eq("conversationId", conversation._id).eq("state", "current"),
    )
    .take(CONVERSATION_SCAN_MAX);
  for (const draft of open) {
    if (
      draft.agentRevision !== revision &&
      (await draftIsUnsent(ctx, draft._id))
    ) {
      return true;
    }
  }
  return false;
}

/** The conversations one lead holds, for callers that need them all. */
export async function conversationsOfLead(
  ctx: MutationCtx,
  prospectId: Id<"prospects">,
): Promise<Doc<"conversations">[]> {
  return await ctx.db
    .query("conversations")
    .withIndex("by_prospectId", (q) => q.eq("prospectId", prospectId))
    .take(CONVERSATION_SCAN_MAX);
}
