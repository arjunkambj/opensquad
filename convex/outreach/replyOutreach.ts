/**
 * Send — or queue — ONE reply in an existing conversation, under the same
 * mode matrix and the same ledger as a first touch (PLAN §9.3).
 *
 * This is the door the reply flow uses once it has decided WHAT to say. It
 * deliberately owns none of that decision: classification, the reply gate, the
 * two-automatic-replies ceiling and "never answer history" all belong to the
 * inbox domain, which calls this only after they have all passed.
 *
 * What this door guarantees, and why it exists rather than each caller
 * assembling a draft itself:
 *   THE OPT-OUT LINE. Appended here with `withOptOutLine`, the same helper the
 *   first touch and every follow-up use, so PLAN §12's "every outbound email
 *   carries an opt-out line" is one function rather than three habits.
 *   THE MODE MATRIX. Autopilot approves and the send boundary takes it from
 *   there; Review leaves a draft for a person; `sourcing_only` and `paused`
 *   are refused before a draft exists.
 *   THE UNCHANGED LEDGER. Nothing here touches the provider. It produces a
 *   draft revision and, in Autopilot, an `approvals` row — after which the
 *   ordinary send boundary applies every gate, the window, the daily limit
 *   and the idempotency key.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import { withOptOutLine } from "../ai/writeOutreach";
import {
  boundedString,
  DRAFT_BODY_MAX_LENGTH,
  DRAFT_SUBJECT_MAX_LENGTH,
  domainError,
  normalizeEmailAddress,
  SENDING_AGENT_MODES,
} from "../lib/validators";
import type { AutopilotApprovalResult } from "./autopilotApproval";
import { matchSuppression } from "./suppressions";
import { v } from "convex/values";

/**
 * Why no reply draft was produced. Every member is a state of the world the
 * caller can report, not an error in it — the same vocabulary the reply gate
 * and the send gates already use.
 */
const vReplyRefusal = v.union(
  v.literal("conversation_not_open"),
  v.literal("human_takeover"),
  v.literal("workspace_paused"),
  v.literal("inbox_unassigned"),
  v.literal("inbox_mismatch"),
  v.literal("agent_not_sending"),
  v.literal("association_missing"),
  v.literal("recipient_unknown"),
  v.literal("suppressed"),
  v.literal("lead_rejected"),
);

const vReplyOutcome = v.union(
  v.object({ drafted: v.literal(false), reason: vReplyRefusal }),
  v.object({
    drafted: v.literal(true),
    draftId: v.id("drafts"),
    /** true = waiting for a person (Review); false = with the send ledger. */
    queued: v.boolean(),
  }),
);

export type ReplyOutcome = typeof vReplyOutcome.type;

/**
 * Draft a reply on an open conversation and, in Autopilot, approve it and
 * wake the send boundary.
 *
 * `requestId` makes the whole thing idempotent: it is the draft's dedupe key,
 * so a re-driven reply step replays the revision it already wrote instead of
 * proposing a second one, and the autopilot approval is keyed on that draft.
 */
export const draftAndSendReply = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    /** Absent reuses the thread's subject — a reply keeps its thread. */
    subject: v.optional(v.string()),
    body: v.string(),
    /** The message being answered. Absent uses the thread's last inbound. */
    replyToMessageRef: v.optional(v.string()),
    evidenceIds: v.optional(v.array(v.string())),
    /** Booking proposal this reply offers, validated by `createRevision`. */
    bookingId: v.optional(v.id("bookings")),
    bookingVersion: v.optional(v.number()),
    requestId: v.string(),
  },
  returns: vReplyOutcome,
  handler: async (ctx, args): Promise<ReplyOutcome> => {
    const refuse = (reason: typeof vReplyRefusal.type): ReplyOutcome => ({
      drafted: false as const,
      reason,
    });

    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    const workspace = await ctx.db.get("workspaces", conversation.workspaceId);
    if (workspace === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    if (conversation.state !== "open") {
      return refuse("conversation_not_open");
    }
    if (conversation.humanTakeover) {
      return refuse("human_takeover");
    }
    if (workspace.automationState !== "active") {
      return refuse("workspace_paused");
    }
    if (workspace.inboxRef === undefined || workspace.inboxConnection !== "connected") {
      return refuse("inbox_unassigned");
    }
    if (workspace.inboxRef !== conversation.inboxRef) {
      return refuse("inbox_mismatch");
    }
    const agent =
      conversation.agentId === undefined
        ? null
        : await ctx.db.get("agents", conversation.agentId);
    if (agent === null || agent.workspaceId !== workspace._id) {
      return refuse("association_missing");
    }
    // Sourcing-only and paused agents are shown their replies and answer none
    // of them (PLAN §9.3).
    if (!SENDING_AGENT_MODES.includes(agent.mode)) {
      return refuse("agent_not_sending");
    }
    const lead =
      conversation.prospectId === undefined
        ? null
        : await ctx.db.get("prospects", conversation.prospectId);
    if (lead !== null && (lead.approval === "rejected" || lead.stage === "rejected")) {
      return refuse("lead_rejected");
    }

    const resolved = await outboundRecipient(ctx, conversation, lead);
    if (resolved === null) {
      return refuse("recipient_unknown");
    }
    if ((await matchSuppression(ctx, workspace._id, resolved.recipient)) !== null) {
      return refuse("suppressed");
    }

    const subject = boundedString(
      args.subject ?? resolved.subject ?? "Re:",
      "subject",
      { min: 1, max: DRAFT_SUBJECT_MAX_LENGTH },
    );
    // THE opt-out line, from the one helper every outbound path shares.
    const body = withOptOutLine(args.body).slice(0, DRAFT_BODY_MAX_LENGTH);
    const replyToMessageRef =
      args.replyToMessageRef ?? conversation.lastInboundMessageRef;

    const draft = await ctx.runMutation(
      internal.outreach.draftRevisions.createRevision,
      {
        conversationId: conversation._id,
        recipient: resolved.recipient,
        subject,
        body,
        evidenceIds: args.evidenceIds ?? [],
        createdBy: "agent",
        requestId: boundedString(args.requestId, "requestId", {
          min: 1,
          max: 100,
        }),
        ...(replyToMessageRef !== undefined ? { replyToMessageRef } : {}),
        ...(args.bookingId !== undefined && args.bookingVersion !== undefined
          ? { bookingId: args.bookingId, bookingVersion: args.bookingVersion }
          : {}),
      },
    );

    if (agent.mode !== "autopilot") {
      // Review: the suggested reply waits for the user's send.
      return { drafted: true as const, draftId: draft._id, queued: true };
    }
    const approval: AutopilotApprovalResult = await ctx.runMutation(
      internal.outreach.autopilotApproval.approveAsAutopilot,
      { draftId: draft._id },
    );
    return {
      drafted: true as const,
      draftId: draft._id,
      queued: !approval.approved,
    };
  },
});

/**
 * The address this thread's automation would mail, and the subject it would
 * keep.
 *
 * The linked lead's contact wins, because that is the person the agent is
 * working; the thread's latest revision is the fallback for a conversation
 * whose lead carries no address. Resolved here rather than imported from the
 * inbox domain so the dependency stays one-way (inbox reads outreach, never
 * the other way round) — the rule is the same one `resolveOutboundRecipient`
 * applies, and both feed `matchSuppression` before anything is drafted.
 */
async function outboundRecipient(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  lead: Doc<"prospects"> | null,
): Promise<{ recipient: string; subject?: string } | null> {
  const latest = await ctx.db
    .query("drafts")
    .withIndex("by_conversationId_and_revision", (q) =>
      q.eq("conversationId", conversation._id),
    )
    .order("desc")
    .first();
  const subject = latest?.subject;
  const email = lead?.email;
  if (lead !== null && email !== undefined) {
    try {
      return {
        recipient: normalizeEmailAddress(email, "recipient"),
        ...(subject !== undefined ? { subject } : {}),
      };
    } catch {
      // An unusable stored address falls through to the thread's own.
    }
  }
  if (latest === null) {
    return null;
  }
  return {
    recipient: latest.normalizedRecipient,
    ...(subject !== undefined ? { subject } : {}),
  };
}
