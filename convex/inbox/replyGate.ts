/**
 * The reply-automation gate: may the agent answer this thread itself?
 *
 * Read AFTER the inbound message has been applied, so it sees the takeover,
 * opt-out and context changes that message just caused. Every refusal is an
 * explicit block code — the gate never guesses.
 */
import type { Doc } from "../_generated/dataModel";
import type { AuthCtx } from "../lib/auth";
import { SENDING_AGENT_MODES } from "../lib/validators";
import type { OptOutSignal } from "../lib/validators";
import { matchSuppression } from "../outreach/suppressions";
import { resolveOutboundRecipient } from "./conversationsModel";
import { v } from "convex/values";

/**
 * Why automation did not answer this reply. Architecture §8 step 7: "if
 * takeover is active, the conversation is unassigned/closed, or no valid
 * prospect/campaign is linked, retain the reply for human review without a
 * reply workflow, draft or send."
 *
 * Names line up with `SEND_BLOCK_CODES` and `conversations.RESUME_BLOCK_CODES`
 * wherever the same gate exists, so the inbox, the resume path and the send
 * preflight speak one vocabulary.
 */
export const REPLY_GATE_BLOCK_CODES = [
  "opt_out_explicit",
  "opt_out_ambiguous",
  "conversation_unassigned",
  "conversation_closed",
  "human_takeover",
  "association_missing",
  "agent_mismatch",
  "agent_not_sending",
  "workspace_paused",
  "inbox_unassigned",
  "inbox_mismatch",
  "recipient_unknown",
  "suppressed_email",
  "suppressed_domain",
] as const;

export type ReplyGateBlockCode = (typeof REPLY_GATE_BLOCK_CODES)[number];

export const vReplyGateBlockCode = v.union(
  v.literal("opt_out_explicit"),
  v.literal("opt_out_ambiguous"),
  v.literal("conversation_unassigned"),
  v.literal("conversation_closed"),
  v.literal("human_takeover"),
  v.literal("association_missing"),
  v.literal("agent_mismatch"),
  v.literal("agent_not_sending"),
  v.literal("workspace_paused"),
  v.literal("inbox_unassigned"),
  v.literal("inbox_mismatch"),
  v.literal("recipient_unknown"),
  v.literal("suppressed_email"),
  v.literal("suppressed_domain"),
);

export const vReplyGateVerdict = v.union(
  v.object({ start: v.literal(true) }),
  v.object({ start: v.literal(false), blockedBy: vReplyGateBlockCode }),
);

export type ReplyGateVerdict = typeof vReplyGateVerdict.type;

/**
 * THE gate every path to model work on an inbound reply passes through.
 *
 * It is a pure read, so it can be re-run — and must be. Ingest runs it here;
 * every later path to model work re-runs it before dispatch, because a
 * takeover, a close, a workspace pause or a suppression can land in between,
 * and a stale wake must then spend nothing.
 *
 * Order matters only for which blocker gets REPORTED, and it is chosen so the
 * operator sees the most specific cause of this particular message: the
 * opt-out that just arrived before the takeover it caused, and the missing
 * association before the policy checks that association would feed.
 */
export async function evaluateReplyAutomation(
  ctx: AuthCtx,
  conversation: Doc<"conversations">,
  optOutSignal: OptOutSignal,
): Promise<ReplyGateVerdict> {
  const blocked = (blockedBy: ReplyGateBlockCode): ReplyGateVerdict => ({
    start: false,
    blockedBy,
  });

  if (optOutSignal === "explicit") {
    return blocked("opt_out_explicit");
  }
  if (optOutSignal === "ambiguous") {
    return blocked("opt_out_ambiguous");
  }
  if (conversation.state === "unassigned") {
    return blocked("conversation_unassigned");
  }
  if (conversation.state === "closed") {
    return blocked("conversation_closed");
  }
  if (conversation.humanTakeover) {
    return blocked("human_takeover");
  }
  if (
    conversation.prospectId === undefined ||
    conversation.agentId === undefined
  ) {
    return blocked("association_missing");
  }
  const prospect = await ctx.db.get("prospects", conversation.prospectId);
  if (prospect === null || prospect.workspaceId !== conversation.workspaceId) {
    return blocked("association_missing");
  }
  const agent = await ctx.db.get("agents", conversation.agentId);
  if (agent === null || agent.workspaceId !== conversation.workspaceId) {
    return blocked("association_missing");
  }
  // The agent frozen on the conversation at association is the authority; a
  // lead re-pointed since must not silently retarget in-flight work.
  if (prospect.agentId !== conversation.agentId) {
    return blocked("agent_mismatch");
  }
  // Sourcing-only and paused agents are shown their replies and answer none
  // of them (PLAN §9.3).
  if (!SENDING_AGENT_MODES.includes(agent.mode)) {
    return blocked("agent_not_sending");
  }
  const workspace = await ctx.db.get("workspaces", conversation.workspaceId);
  if (workspace === null || workspace.automationState !== "active") {
    return blocked("workspace_paused");
  }
  if (workspace.inboxRef === undefined) {
    return blocked("inbox_unassigned");
  }
  if (workspace.inboxRef !== conversation.inboxRef) {
    return blocked("inbox_mismatch");
  }
  const { recipient } = await resolveOutboundRecipient(ctx, conversation);
  if (recipient === null) {
    return blocked("recipient_unknown");
  }
  // P10's matcher, not a second one: email key first, then the explicit
  // domain key. An email suppression never implies its domain.
  const suppression = await matchSuppression(
    ctx,
    conversation.workspaceId,
    recipient,
  );
  if (suppression !== null) {
    return blocked(
      suppression.matchedBy === "domain" ? "suppressed_domain" : "suppressed_email",
    );
  }
  return { start: true };
}
