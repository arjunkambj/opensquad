/**
 * The one thing a person says about a reply that the agent cannot say for
 * them: "this one is interested".
 *
 * It is the human twin of the classifier. The agent writes
 * `conversations.lastDisposition` from what it read; this writes the same
 * field from what a person decided, and moves the lead to `interested` with
 * it — so the Interested pill, the row chip and the Contacts stage agree
 * whichever of the two said so.
 *
 * It deliberately stops there. It does not book a meeting (PLAN §9.5 —
 * "Mark as booked" with a date and time is a different act, and the only one
 * that writes `meeting_booked`), it does not resume automation on a thread a
 * person took over, and it sends nothing.
 */
import { mutation } from "../_generated/server";
import { requireWorkspaceEditor } from "../lib/auth";
import { boundedString, domainError } from "../lib/validators";
import { appendLeadEvent, findLeadEventByOperationKey } from "../leads/events";
import { getConversationInWorkspace } from "../outreach/draftsModel";
import { v } from "convex/values";
import {
  assertContextVersion,
  vConversationSummary,
} from "./conversationsModel";
import { summarize } from "./conversationsModel";
import { advanceLead, leadOfConversation } from "./repliesLead";
import { applyDisposition, noteOnThread } from "./repliesModel";

/**
 * Mark this conversation's lead as interested.
 *
 * `requestId` is the logical intent, not the click: the lead event it writes
 * is keyed on it, so a double-tapped button or a retried request records one
 * decision. `expectedContextVersion` is the ordinary optimistic-concurrency
 * check every versioned inbox mutation shares — it is read AFTER the
 * idempotency check, so a replayed request returns the row rather than a
 * spurious CONFLICT against a version the first call already moved.
 */
export const markInterested = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    expectedContextVersion: v.number(),
    requestId: v.string(),
  },
  returns: vConversationSummary,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const conversation = await getConversationInWorkspace(
      ctx,
      args.workspaceId,
      args.conversationId,
    );
    const lead = await leadOfConversation(ctx, conversation);
    if (lead === null) {
      throw domainError(
        "CONFLICT",
        "this conversation is not linked to a lead yet",
      );
    }
    const operationKey = `lead:${lead._id}:marked-interested:${requestId}`;
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.workspaceId,
      operationKey,
    );
    if (prior !== null) {
      return await summarize(ctx, conversation);
    }
    assertContextVersion(conversation, args.expectedContextVersion);

    await applyDisposition(ctx, conversation, "interested");
    await appendLeadEvent(ctx, {
      workspaceId: args.workspaceId,
      prospectId: lead._id,
      kind: "note_added",
      summary: "Marked interested from the Inbox",
      operationKey,
      actor: { source: "human", identityKey },
      details: { note: "A team member marked this reply as interested." },
    });
    // Forward only, and never out of a terminal stage or into a booked
    // meeting — `advancedLeadStage` owns all three rules.
    await advanceLead(ctx, lead, "interested", {
      reason: "A team member marked this reply as interested",
      operationKey: `${operationKey}:stage`,
    });
    await noteOnThread(
      ctx,
      conversation,
      "Marked interested. The lead moved to Interested in Contacts; a meeting still counts only when you press Mark as booked.",
    );
    const updated = await getConversationInWorkspace(
      ctx,
      args.workspaceId,
      args.conversationId,
    );
    return await summarize(ctx, updated);
  },
});
