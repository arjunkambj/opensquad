/**
 * The unassigned queue — internal, inbound ingest only.
 *
 * A verified message whose thread we cannot attribute to a lead still has to
 * land somewhere a human can see it, so it gets a conversation with no
 * prospect rather than being dropped.
 */
import { internalMutation } from "../_generated/server";
import { vConversationDoc } from "../outreach/draftsModel";
import { recordConversationNote } from "./conversationNotes";
import { v } from "convex/values";

/**
 * Find or create the workspace-scoped unassigned conversation for a verified
 * inbound message that matched no existing thread (architecture §8 step 4,
 * integrations.md §G3 "unmatched known-inbox messages enter that workspace's
 * unassigned queue under human takeover").
 *
 * The inbox is already known to belong to this workspace — the callback
 * resolved it from the saved assignment, never from a body or a display
 * address — so the row has a legitimate owner. What it does NOT have is a
 * lead: no prospect is guessed, no campaign is guessed, and nothing about the
 * sender selects one. `associateProspect` is the only way a lead is attached,
 * and it is human-only.
 *
 * The row is created with `state: "unassigned"` and `humanTakeover: true`, so
 * the reply-automation gate refuses it three separate ways. Its lifecycle is
 * recorded on the conversation row and in `conversationNotes`.
 *
 * IT NEVER THROWS for a condition a retry cannot fix. This runs inside the
 * ingest transaction, and a throw there leaves the receipt `pending` for the
 * drain to retry forever. An unrecoverable condition is returned as a reason
 * so the receipt can record it as `failed` and an operator can see it.
 */
export const ensureUnassignedConversation = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    inboxRef: v.string(),
    providerThreadRef: v.string(),
    /** Ingest time of the message, never the provider's own timestamp. */
    at: v.number(),
    messageRef: v.string(),
    fromAddress: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      created: v.boolean(),
      conversation: vConversationDoc,
    }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (workspace === null) {
      return { ok: false as const, reason: "workspace not found" };
    }
    // Re-check the claim inside this transaction. `.collect()` plus a
    // workspace filter, not `.unique()`: the pair's uniqueness is
    // transactional and the index is global, so a foreign row must neither
    // block the claim nor be adopted. A concurrent claim is resolved by
    // returning the winner, never by throwing CONFLICT — a throw here would
    // lose the event.
    const claimed = (
      await ctx.db
        .query("conversations")
        .withIndex("by_inboxRef_and_providerThreadRef", (q) =>
          q
            .eq("inboxRef", args.inboxRef)
            .eq("providerThreadRef", args.providerThreadRef),
        )
        .collect()
    )
      .filter((row) => row.workspaceId === args.workspaceId)
      .sort((left, right) => left._creationTime - right._creationTime);
    if (claimed.length > 0) {
      return { ok: true as const, created: false, conversation: claimed[0] };
    }

    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      workspaceId: args.workspaceId,
      inboxRef: args.inboxRef,
      state: "unassigned",
      // An unassigned thread is created by a live webhook event; the backfill
      // importer names its own source when it creates a thread.
      source: "live",
      humanTakeover: true,
      takeoverReason: "unassigned_inbound",
      takeoverBy: "system",
      takeoverAt: now,
      contextVersion: 1,
      unreadCount: 1,
      createdAt: now,
      updatedAt: now,
      providerThreadRef: args.providerThreadRef,
      // The inbound facts are written at insert so the very first message is
      // already applied. `drafts.applyInboundContext` then no-ops for it
      // (`lastInboundMessageRef` already matches) and the row opens at
      // contextVersion 1 rather than 2 — while a SECOND message on the same
      // unassigned thread advances it normally.
      lastInboundMessageRef: args.messageRef,
      lastInboundAt: args.at,
      lastMessageAt: args.at,
      ...(args.fromAddress !== undefined
        ? { lastInboundFrom: args.fromAddress }
        : {}),
    });
    const conversation = await ctx.db.get("conversations", conversationId);
    if (conversation === null) {
      return { ok: false as const, reason: "conversation not found after insert" };
    }
    await recordConversationNote(ctx, {
      conversation,
      kind: "system",
      actor: "system",
      body: "Unmatched reply held for review. Link a lead and campaign to work it; automation stays frozen until an explicit resume.",
    });
    return { ok: true as const, created: true, conversation };
  },
});
