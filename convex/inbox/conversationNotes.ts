/**
 * Internal notes on a conversation — the human-written trail beside the
 * thread, plus the `system` notes other paths record through
 * `recordConversationNote`.
 */
import type { Doc } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import {
  boundedLimit,
  boundedString,
  CONVERSATION_NOTE_BODY_MAX_LENGTH,
  domainError,
} from "../lib/validators";
import type { ConversationNoteKind } from "../lib/validators";
import { paged } from "../lib/pagination";
import { getConversationInOrg } from "../outreach/draftsModel";
import { conversationNoteFields } from "../schema";
import { v } from "convex/values";

export const vConversationNoteDoc = v.object({
  _id: v.id("conversationNotes"),
  _creationTime: v.number(),
  ...conversationNoteFields,
});

/**
 * Append one note. `system` rows are the thread's lifecycle trail; `note`
 * rows are human annotations.
 *
 * Notes deliberately do NOT advance `contextVersion`: architecture §8 limits
 * bumps to inbound replies, takeover/assignment/closure and explicit context
 * changes, and a private annotation must not invalidate every live approval
 * on the thread. A note can never resolve a business approval; there is no
 * path from this table to approval state.
 */
export async function recordConversationNote(
  ctx: MutationCtx,
  args: {
    conversation: Doc<"conversations">;
    kind: ConversationNoteKind;
    actor: string;
    body: string;
  },
): Promise<Doc<"conversationNotes">> {
  const body = boundedString(args.body, "body", {
    min: 1,
    max: CONVERSATION_NOTE_BODY_MAX_LENGTH,
  });
  const noteId = await ctx.db.insert("conversationNotes", {
    orgId: args.conversation.orgId,
    conversationId: args.conversation._id,
    kind: args.kind,
    actor: boundedString(args.actor, "actor", { min: 1, max: 300 }),
    body,
    createdAt: Date.now(),
  });
  const note = await ctx.db.get("conversationNotes", noteId);
  if (note === null) {
    throw domainError("NOT_FOUND", "conversation note not found");
  }
  return note;
}

/** Internal notes on one thread, newest first, cursor-paginated. */
export const listNotes = query({
  args: {
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vConversationNoteDoc),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    await getConversationInOrg(
      ctx,
      args.orgId,
      args.conversationId,
    );
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("conversationNotes")
      .withIndex("by_conversationId_and_createdAt", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return paged(result, result.page);
  },
});

/** Add a human note to a thread. Never advances the conversation version. */
export const addNote = mutation({
  args: {
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
    body: v.string(),
  },
  returns: vConversationNoteDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(
      ctx,
      args.orgId,
    );
    const conversation = await getConversationInOrg(
      ctx,
      args.orgId,
      args.conversationId,
    );
    return await recordConversationNote(ctx, {
      conversation,
      kind: "note",
      actor: identityKey,
      body: args.body,
    });
  },
});
