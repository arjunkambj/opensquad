/**
 * Association and resume: binding an unassigned thread to a lead, and handing
 * a taken-over thread back to the agent.
 *
 * Resume is gated, not a toggle — it refuses with an explicit block code
 * whenever the thread is not in a state the agent may act on.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import {
  boundedString,
  domainError,
  SENDING_AGENT_MODES,
} from "../lib/validators";
import {
  getConversationInOrg,
  vConversationDoc,
} from "../outreach/draftsModel";
import { matchSuppression } from "../outreach/suppressions";
import { recordConversationNote } from "./conversationNotes";
import {
  advanceContext,
  assertContextVersion,
  resolveOutboundRecipient,
} from "./conversationsModel";
import { scheduleReplyHandling } from "./repliesModel";
import { v } from "convex/values";

/**
 * Why a resume refused to re-arm automation. These are returned, not thrown:
 * the operator needs to see which gate is closed, and every one of them
 * leaves takeover ON, so a refusal is always safe.
 *
 * Names line up with `SEND_BLOCK_CODES` wherever the same gate exists, so the
 * inbox and the send preflight speak one vocabulary.
 */
export const RESUME_BLOCK_CODES = [
  "association_missing",
  "agent_mismatch",
  "agent_not_sending",
  "org_paused",
  "inbox_unassigned",
  "inbox_mismatch",
  "recipient_unknown",
  "sender_unverified",
  "sender_contact_mismatch",
  "suppressed_email",
  "suppressed_domain",
] as const;

export type ResumeBlockCode = (typeof RESUME_BLOCK_CODES)[number];

/**
 * Declared as a const rather than inline so the handler can be annotated with
 * its own return type — the same reason `conversationStaging.retireConversationWork`
 * returns `v.null()` and every handler in this domain states its type.
 */
const vResumeResult = v.object({
  conversation: vConversationDoc,
  /** Whether reply automation was started for the latest inbound message. */
  dispatched: v.boolean(),
  /** A `RESUME_BLOCK_CODES` member when a policy check refused. */
  blockedBy: v.optional(v.string()),
  /** Why no reply automation started, when the resume itself succeeded. */
  replyNote: v.optional(v.string()),
});

export type ResumeResult = typeof vResumeResult.type;

/**
 * Link an unassigned thread to a lead and agent already in this org.
 *
 * Association is HUMAN-ONLY: email content can never choose a lead, and this
 * mutation takes ids from an authenticated editor only. It validates that the
 * lead is in this org and that it belongs to the named agent — a
 * caller asserting which agent it believes it is binding turns a
 * disagreement into a CONFLICT instead of a silent bind.
 *
 * It DISPATCHES NOTHING. §8: "advance context, set state to open and keep
 * takeover enabled." No draft, no send — re-arming automation is the
 * separate, checked act of `resume` (V16 step 3).
 *
 * `requestId` is accepted because §5 names it, and it is bounded; association
 * needs no receipt store because it is once-per-conversation by construction
 * (only an `unassigned` conversation can be associated, and the first
 * association makes it `open`). A retry of the same association returns the
 * doc unchanged.
 */
export const associateProspect = mutation({
  args: {
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
    expectedContextVersion: v.number(),
    prospectId: v.id("prospects"),
    agentId: v.id("agents"),
    requestId: v.string(),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(
      ctx,
      args.orgId,
    );
    boundedString(args.requestId, "requestId", { min: 1, max: 100 });
    const conversation = await getConversationInOrg(
      ctx,
      args.orgId,
      args.conversationId,
    );
    // Idempotent retry, checked before the version so a replayed request
    // returns the doc rather than a spurious CONFLICT.
    if (
      conversation.prospectId === args.prospectId &&
      conversation.agentId === args.agentId
    ) {
      return conversation;
    }
    if (conversation.state !== "unassigned") {
      throw domainError(
        "CONFLICT",
        "association accepts only an unassigned conversation",
      );
    }
    assertContextVersion(conversation, args.expectedContextVersion);
    const prospect = await ctx.db.get("prospects", args.prospectId);
    // The same message for a missing lead and one in another org —
    // never reveal another org's rows.
    if (prospect === null || prospect.orgId !== args.orgId) {
      throw domainError("NOT_FOUND", "prospect not found");
    }
    const agent = await ctx.db.get("agents", args.agentId);
    if (agent === null || agent.orgId !== args.orgId) {
      throw domainError("NOT_FOUND", "agent not found");
    }
    if (prospect.agentId !== args.agentId) {
      throw domainError("CONFLICT", "prospect belongs to a different agent");
    }
    const updated = await advanceContext(
      ctx,
      conversation,
      {
        prospectId: args.prospectId,
        agentId: args.agentId,
        state: "open",
        // Deliberately kept: association proves who the thread is about, not
        // that automation may speak for us again.
        humanTakeover: true,
        takeoverReason: "awaiting_resume",
        takeoverBy: identityKey,
        takeoverAt: Date.now(),
      },
      "the conversation was associated with a lead",
    );
    await recordConversationNote(ctx, {
      conversation,
      kind: "system",
      actor: identityKey,
      body: `Associated with ${prospect.companyName ?? "this lead"} on agent "${agent.name}". Takeover stays on until resume.`,
    });
    // A reply that arrived while the thread was still unassigned is a reply
    // fact once the lead is named — stamp `lastReplyAt`/`replied` from the
    // recorded inbound now (P19). Keyed on the message ref, so re-running it
    // later is a no-op.
    if (
      updated.lastInboundMessageRef !== undefined &&
      updated.lastInboundAt !== undefined
    ) {
      await ctx.runMutation(internal.leads.mutations.markReplied, {
        conversationId: updated._id,
        messageRef: updated.lastInboundMessageRef,
        at: updated.lastInboundAt,
      });
    }
    return updated;
  },
});

/**
 * Re-arm automation on a frozen thread — the ONLY path that clears
 * `humanTakeover` (V16 step 3).
 *
 * Architecture §8 requires an explicit resume to validate the association,
 * the verified sender/contact match, the campaign and the current policy.
 * Each of those is re-run here, in order, and a failure RETURNS its block
 * code with takeover left on rather than throwing — the operator needs to see
 * which gate is closed, and a refusal is always the safe outcome.
 *
 * The verified sender/contact match is what stops a stranger's reply on an
 * associated thread from re-arming outreach to that lead: the stored
 * `lastInboundFrom` must match the address we actually mail. It can only
 * refuse, never grant — the send recipient is always resolved by the
 * application, never from the inbound payload.
 *
 * Once every check passes the thread is re-armed. Drafting a reply to the
 * latest inbound message is not yet wired up.
 */
export const resume = mutation({
  args: {
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
    expectedContextVersion: v.number(),
    requestId: v.string(),
  },
  returns: vResumeResult,
  handler: async (ctx, args): Promise<ResumeResult> => {
    const { identityKey, org } = await requireOrgMember(
      ctx,
      args.orgId,
    );
    boundedString(args.requestId, "requestId", { min: 1, max: 100 });
    const conversation = await getConversationInOrg(
      ctx,
      args.orgId,
      args.conversationId,
    );
    // Idempotent retry: an already-resumed thread returns rather than
    // CONFLICTing on a version that the first call advanced.
    if (!conversation.humanTakeover) {
      return { conversation, dispatched: false };
    }
    if (conversation.state !== "open") {
      throw domainError(
        "CONFLICT",
        `conversation is ${conversation.state}; only an open conversation can resume`,
      );
    }
    assertContextVersion(conversation, args.expectedContextVersion);

    const blocked = (
      code: ResumeBlockCode,
    ): {
      conversation: Doc<"conversations">;
      dispatched: boolean;
      blockedBy: string;
    } => ({ conversation, dispatched: false, blockedBy: code });

    if (
      conversation.prospectId === undefined ||
      conversation.agentId === undefined
    ) {
      return blocked("association_missing");
    }
    const prospect = await ctx.db.get("prospects", conversation.prospectId);
    if (prospect === null || prospect.orgId !== args.orgId) {
      return blocked("association_missing");
    }
    const agent = await ctx.db.get("agents", conversation.agentId);
    if (agent === null || agent.orgId !== args.orgId) {
      return blocked("association_missing");
    }
    if (prospect.agentId !== conversation.agentId) {
      return blocked("agent_mismatch");
    }
    // Sourcing-only and paused agents never speak: automation may be re-armed
    // only under a mode that is allowed to put mail on the wire (PLAN §9.3).
    if (!SENDING_AGENT_MODES.includes(agent.mode)) {
      return blocked("agent_not_sending");
    }
    if (org.automationState !== "active") {
      return blocked("org_paused");
    }
    if (org.inboxRef === undefined) {
      return blocked("inbox_unassigned");
    }
    if (org.inboxRef !== conversation.inboxRef) {
      return blocked("inbox_mismatch");
    }

    // The address we would actually mail, resolved by the application: the
    // lead's contact, else the address the last revision was authorized
    // against. Never the inbound `from`.
    const { recipient, latestDraft } = await resolveOutboundRecipient(
      ctx,
      conversation,
    );
    if (recipient === null) {
      return blocked("recipient_unknown");
    }

    if (conversation.lastInboundMessageRef !== undefined) {
      if (conversation.lastInboundFrom === undefined) {
        // Mail arrived but its sender never parsed as a single address, so
        // there is nothing to verify against. Refuse rather than guess.
        return blocked("sender_unverified");
      }
      const matchesContact = conversation.lastInboundFrom === recipient;
      const matchesLastDraft =
        latestDraft !== null &&
        conversation.lastInboundFrom === latestDraft.normalizedRecipient;
      if (!matchesContact && !matchesLastDraft) {
        return blocked("sender_contact_mismatch");
      }
    }

    const suppression = await matchSuppression(
      ctx,
      args.orgId,
      recipient,
    );
    if (suppression !== null) {
      return blocked(
        suppression.matchedBy === "domain"
          ? "suppressed_domain"
          : "suppressed_email",
      );
    }

    const updated = await advanceContext(
      ctx,
      conversation,
      {
        humanTakeover: false,
        takeoverReason: undefined,
        takeoverBy: undefined,
        takeoverAt: undefined,
      },
      "an operator resumed automation on the conversation",
    );
    await recordConversationNote(ctx, {
      conversation,
      kind: "system",
      actor: identityKey,
      body: "Automation resumed; association, campaign, sender and policy checks passed.",
    });
    // Automation is re-armed, so the thread's latest inbound message goes
    // back to reply handling. It re-reads every gate in its own transaction
    // and refuses a message that already carries a disposition, so resuming
    // an already-classified thread costs nothing and answers nothing twice.
    const dispatched = await scheduleReplyHandling(ctx, updated);
    return { conversation: updated, dispatched };
  },
});
