/**
 * Conversation staging — a minimal internal seam over `conversations`.
 *
 * The public conversations module lives in `inbox/`. These internal-only
 * mutations exist so preflight facts can be staged, a workspace inbox bound
 * and inbound-driven invalidation applied from the outreach side without
 * reaching into that domain's public surface.
 */
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import {
  boundedString,
  domainError,
  PROVIDER_REF_MAX_LENGTH,
  vConversationState,
  vMessageSource,
} from "../lib/validators";
import { vConversationDoc } from "./draftsModel";
import { v } from "convex/values";

/**
 * Stage or patch a conversation (internal only). Creates the row keyed on
 * (inboxRef, providerThreadRef) when `conversationId` is absent; otherwise
 * patches the listed mutable facts. Exists so preflight facts — versions,
 * takeover, state, prospect link — can be staged before P11's real module
 * lands; probes and P11's inbound processing share it.
 */
export const stageConversation = internalMutation({
  args: {
    conversationId: v.optional(v.id("conversations")),
    workspaceId: v.id("workspaces"),
    inboxRef: v.string(),
    providerThreadRef: v.optional(v.string()),
    prospectId: v.optional(v.id("prospects")),
    /**
     * The agent whose reply work this thread runs under, frozen here the way
     * `conversations.associateProspect` freezes it for an inbound thread. The
     * outreach loop stages the threads it STARTS, and a conversation with no
     * agent would leave `evaluateSendGates` with nothing to fence the mode and
     * the revision against — so an outbound thread records it at creation.
     * Refused unless the named agent owns the named lead.
     */
    agentId: v.optional(v.id("agents")),
    source: v.optional(vMessageSource),
    state: v.optional(vConversationState),
    humanTakeover: v.optional(v.boolean()),
    /** Staging override — real bumps flow through applyInboundContext etc. */
    contextVersion: v.optional(v.number()),
    unreadCount: v.optional(v.number()),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const inboxRef = boundedString(args.inboxRef, "inboxRef", {
      min: 1,
      max: PROVIDER_REF_MAX_LENGTH,
    });
    const providerThreadRef =
      args.providerThreadRef === undefined
        ? undefined
        : boundedString(args.providerThreadRef, "providerThreadRef", {
            min: 1,
            max: PROVIDER_REF_MAX_LENGTH,
          });
    const prospectId = args.prospectId;
    if (args.agentId !== undefined) {
      const agent = await ctx.db.get("agents", args.agentId);
      if (agent === null || agent.workspaceId !== args.workspaceId) {
        throw domainError("NOT_FOUND", "agent not found");
      }
      // The same refusal `conversations.associateProspect` makes: a thread may
      // only be bound to the agent the lead actually belongs to.
      if (prospectId !== undefined) {
        const prospect = await ctx.db.get("prospects", prospectId);
        if (prospect === null || prospect.workspaceId !== args.workspaceId) {
          throw domainError("NOT_FOUND", "prospect not found");
        }
        if (prospect.agentId !== agent._id) {
          throw domainError(
            "CONFLICT",
            "the lead belongs to a different agent than the one named",
          );
        }
      }
    }

    if (args.conversationId !== undefined) {
      const existing = await ctx.db.get("conversations", args.conversationId);
      if (existing === null || existing.workspaceId !== args.workspaceId) {
        throw domainError("NOT_FOUND", "conversation not found");
      }
      // The (inboxRef, providerThreadRef) pair must stay unique on patch too
      // — otherwise two conversations claim the same provider thread and the
      // create-path `.unique()` lookup starts throwing forever.
      if (providerThreadRef !== undefined) {
        const duplicate = await ctx.db
          .query("conversations")
          .withIndex("by_inboxRef_and_providerThreadRef", (q) =>
            q
              .eq("inboxRef", existing.inboxRef)
              .eq("providerThreadRef", providerThreadRef),
          )
          .unique();
        if (duplicate !== null && duplicate._id !== existing._id) {
          throw domainError(
            "CONFLICT",
            `inbox/thread already mapped to conversation ${duplicate._id}`,
          );
        }
      }
      await ctx.db.patch("conversations", existing._id, {
        ...(providerThreadRef !== undefined ? { providerThreadRef } : {}),
        ...(prospectId !== undefined ? { prospectId } : {}),
        ...(args.agentId !== undefined ? { agentId: args.agentId } : {}),
        ...(args.state !== undefined ? { state: args.state } : {}),
        ...(args.humanTakeover !== undefined
          ? { humanTakeover: args.humanTakeover }
          : {}),
        ...(args.contextVersion !== undefined
          ? { contextVersion: args.contextVersion }
          : {}),
        ...(args.unreadCount !== undefined
          ? { unreadCount: args.unreadCount }
          : {}),
        updatedAt: Date.now(),
      });
      const updated = await ctx.db.get("conversations", existing._id);
      if (updated === null) {
        throw domainError("NOT_FOUND", "conversation not found");
      }
      return updated;
    }

    // Unique (inboxRef, providerThreadRef) mapping (§4.3 invariant).
    if (providerThreadRef !== undefined) {
      const duplicate = await ctx.db
        .query("conversations")
        .withIndex("by_inboxRef_and_providerThreadRef", (q) =>
          q.eq("inboxRef", inboxRef).eq("providerThreadRef", providerThreadRef),
        )
        .unique();
      if (duplicate !== null) {
        throw domainError(
          "CONFLICT",
          `inbox/thread already mapped to conversation ${duplicate._id}`,
        );
      }
    }

    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      workspaceId: args.workspaceId,
      inboxRef,
      state: args.state ?? "open",
      // A staged thread is live mail unless the caller says it came from the
      // connect-time backfill.
      source: args.source ?? "live",
      humanTakeover: args.humanTakeover ?? false,
      contextVersion: args.contextVersion ?? 1,
      unreadCount: args.unreadCount ?? 0,
      createdAt: now,
      updatedAt: now,
      ...(prospectId !== undefined ? { prospectId } : {}),
      ...(args.agentId !== undefined ? { agentId: args.agentId } : {}),
      ...(providerThreadRef !== undefined ? { providerThreadRef } : {}),
    });
    const conversation = await ctx.db.get("conversations", conversationId);
    if (conversation === null) {
      throw domainError("NOT_FOUND", "conversation not found after insert");
    }
    return conversation;
  },
});

/**
 * Inbound-reply application (internal only). Advances `contextVersion`,
 * records the inbound reference/time, bumps the unread counter and cancels
 * the parked attempts on the now-stale current draft — the facts that make a
 * recorded approval or a reserved send refuse at preflight (§8.5, V17).
 */
export const applyInboundContext = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    lastInboundMessageRef: v.string(),
    at: v.optional(v.number()),
    markUnread: v.optional(v.boolean()),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    const messageRef = boundedString(
      args.lastInboundMessageRef,
      "lastInboundMessageRef",
      { min: 1, max: PROVIDER_REF_MAX_LENGTH },
    );
    // Idempotent per message: a re-delivered inbound must not bump
    // contextVersion again — a second bump would strand a draft approved
    // after the first application via `context_changed`.
    if (conversation.lastInboundMessageRef === messageRef) {
      return conversation;
    }
    const at = args.at ?? Date.now();
    // `lastMessageAt` backs the inbox ordering indexes, so it is MONOTONIC —
    // the same guard `sendOutcome.linkConversationThread` applies on the outbound
    // side. Signed provider deliveries arrive out of order (P05 observed
    // `message.delivered` before `message.sent` for one message), and P11's
    // receipt drain can re-drive an older inbound after a newer one has
    // already landed; neither may rewind a thread's position in the list.
    //
    // `lastInboundAt` is deliberately NOT clamped: it is the arrival time of
    // the message `lastInboundMessageRef` names, and the two must keep
    // describing the same message.
    const lastMessageAt =
      conversation.lastMessageAt === undefined || conversation.lastMessageAt < at
        ? at
        : conversation.lastMessageAt;
    await ctx.db.patch("conversations", conversation._id, {
      contextVersion: conversation.contextVersion + 1,
      lastInboundMessageRef: messageRef,
      lastInboundAt: at,
      lastMessageAt,
      unreadCount:
        conversation.unreadCount + (args.markUnread === false ? 0 : 1),
      updatedAt: Date.now(),
    });

    // Inbound mail makes a pending draft approval obsolete (§8.5): the
    // context version just moved, so no recorded approval still matches. A
    // parked send intent authorized against the now-stale context can never
    // legally dispatch either, so retire it here rather than letting it
    // block the conversation until its stale wake fires.
    if (conversation.currentDraftId !== undefined) {
      await ctx.runMutation(
        internal.outreach.sendControls.cancelParkedConversationAttempts,
        {
          workspaceId: conversation.workspaceId,
          conversationId: conversation._id,
          reason: "inbound mail changed the conversation context",
        },
      );
    }

    const updated = await ctx.db.get("conversations", conversation._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    return updated;
  },
});

/**
 * Assign the workspace's AgentMail inbox reference (internal only — the real
 * inbox-assignment flow arrives with P11's onboarding/inbox work). Preflight
 * refuses dispatch when the draft's inbox differs from the workspace's.
 */
export const assignWorkspaceInbox = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    inboxRef: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (workspace === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    const inboxRef = boundedString(args.inboxRef, "inboxRef", {
      min: 1,
      max: PROVIDER_REF_MAX_LENGTH,
    });
    const holder = await ctx.db
      .query("workspaces")
      .withIndex("by_inboxRef", (q) => q.eq("inboxRef", inboxRef))
      .unique();
    if (holder !== null && holder._id !== workspace._id) {
      throw domainError(
        "CONFLICT",
        "inbox is already assigned to another organization",
      );
    }
    await ctx.db.patch("workspaces", workspace._id, {
      inboxRef,
      updatedAt: Date.now(),
    });
    // The assignment is what the quarantine was waiting for. An AgentMail
    // inbox is provisioned before this mutation commits, so a verified event
    // can arrive in the window between the two and find no workspace to
    // belong to; it is held rather than dropped, and this is the moment it
    // becomes replayable. Scheduled, not inlined: the replay reads the mail
    // component and re-drives ingest, and none of that may roll back an
    // assignment an operator asked for.
    await ctx.scheduler.runAfter(0, internal.inbox.quarantine.replayForInbox, {
      inboxRef,
    });
    return null;
  },
});

/**
 * Retire the live work a conversation carries, because a fact just changed
 * that every recorded approval and every parked send was authorized against.
 *
 * This is the same cancellation `applyInboundContext` runs, exported so the
 * takeover, assignment, association and closure paths invalidate EXACTLY the
 * way an inbound reply does, rather than each growing its own half-correct
 * version.
 *
 * It is not optional politeness on a `contextVersion` bump. Once the version
 * moves, `approvals.resolveDraft` refuses the bound revision forever
 * (`conversation.contextVersion !== draft.basedOnContextVersion`), so a
 * parked attempt left alive can never legally dispatch.
 *
 * Callers must not patch an attempt themselves: the attempt path owns the
 * usage reservation release.
 */
export const retireConversationWork = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    const reason = boundedString(args.reason, "reason", { min: 1, max: 500 });
    // A conversation that never had a draft has no reserved attempt to
    // retire — the same guard `applyInboundContext` uses.
    if (conversation.currentDraftId === undefined) {
      return null;
    }
    // The retired counts are deliberately not returned: the send boundary imports
    // this module, so typing this call's result here would make the two
    // modules' inference circular. Nothing needs the numbers — the retiring
    // mutations record their own activity.
    await ctx.runMutation(internal.outreach.sendControls.cancelParkedConversationAttempts, {
      workspaceId: conversation.workspaceId,
      conversationId: conversation._id,
      reason,
    });
    return null;
  },
});
