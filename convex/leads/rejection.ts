/**
 * What "no, never contact this person" stops (PLAN §9.1, the invalidation
 * table: *queued (not yet started) reveal, draft, send and follow-ups for that
 * lead cancelled; open drafts → `superseded`*).
 *
 * Two rules shape every line here:
 *
 *   Cancellation never decides money. Nothing below refunds anything. A
 *   parked send intent that provably never dispatched is retired by the send
 *   boundary's own mutation, which releases what it reserved; a reveal already
 *   in flight runs to its recorded result, is billed what it cost, and its
 *   address is STORED rather than thrown away.
 *
 *   Only work that has not started is stopped. Clearing `nextActionAt` is what
 *   cancels the queued steps — the state machine selects due leads, so a lead
 *   with no due time is never picked up again — and superseding the open draft
 *   is what stops the text that was written for it.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Conversations one lead can hold. A lead has a handful at most. */
const CONVERSATION_SCAN_MAX = 25;

/**
 * Retire the outreach a rejected lead had queued.
 *
 * `drafts` belongs to the outreach domain and is patched here for one reason:
 * the rejection and everything it invalidates have to land in ONE transaction,
 * or a send scheduled a millisecond later would pass a gate the user has just
 * closed. The patch is the exact one `vDraftState` documents for this case
 * ("written when … the lead is rejected"), and it is the only outreach row
 * this domain ever writes.
 */
export async function cancelWorkForRejectedLead(
  ctx: MutationCtx,
  lead: Doc<"prospects">,
  reason: string,
): Promise<{ draftsSuperseded: number; conversations: number }> {
  const conversations = await ctx.db
    .query("conversations")
    .withIndex("by_prospectId", (q) => q.eq("prospectId", lead._id))
    .take(CONVERSATION_SCAN_MAX);

  const now = Date.now();
  let draftsSuperseded = 0;
  for (const conversation of conversations) {
    const open = await ctx.db
      .query("drafts")
      .withIndex("by_conversationId_and_state", (q) =>
        q.eq("conversationId", conversation._id).eq("state", "current"),
      )
      .take(CONVERSATION_SCAN_MAX);
    for (const draft of open) {
      // `state` and `supersededAt` move together — see `vDraftState`.
      await ctx.db.patch("drafts", draft._id, {
        state: "superseded",
        supersededAt: now,
      });
      draftsSuperseded += 1;
    }
    // Pre-dispatch intents only: the send boundary owns the distinction, and
    // a request that already left us is never retracted here.
    await ctx.runMutation(
      internal.outreach.sendControls.cancelParkedConversationAttempts,
      {
        workspaceId: lead.workspaceId,
        conversationId: conversation._id,
        reason,
      },
    );
  }
  return { draftsSuperseded, conversations: conversations.length };
}
