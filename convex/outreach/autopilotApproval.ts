/**
 * Autopilot's EMAIL approval — "yes, send this text", decided by the agent
 * (PLAN §9.3 "Autopilot does not bypass anything").
 *
 * It produces the same thing a person produces: one immutable `approvals` row
 * bound to the exact draft revision, payload hash, normalized recipient and
 * conversation context version, with `actor: "autopilot"`. The send then goes
 * through the UNCHANGED ledger — suppression, blocklist, sending window,
 * daily limit, idempotency key, credits, platform budget, kill switch — because
 * `sendGates.evaluateSendGates` is what reads that row, and it cannot tell who
 * wrote it.
 *
 * `outreach/approvals.ts` is the human path and stays exactly as it was: it
 * authenticates an editor, writes `actor: "user"`, and can also reject. The
 * two are separate functions rather than one with a flag, because a mutation
 * that can skip `requireWorkspaceEditor` on a boolean is one refactor away
 * from skipping it by accident.
 *
 * WHAT IT CANNOT DO. It never writes `agents.mode` or `agents.autopilot` —
 * Autopilot is turned on in exactly one place, behind the consent dialog
 * (`agents/settingsMode.ts`) — and it refuses unless that consent is on the
 * agent at the moment of effect.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { recordActivityEvent } from "../activity/model";
import { domainError } from "../lib/validators";
import { matchSuppression } from "./suppressions";
import { v } from "convex/values";

/**
 * Why Autopilot did not approve its own draft. Every member is a fact that
 * changed between writing and approving — which is exactly the window PLAN
 * §9.1's invalidation table is about.
 */
const vAutopilotRefusal = v.union(
  v.literal("not_autopilot"),
  v.literal("consent_missing"),
  v.literal("workspace_paused"),
  v.literal("draft_not_current"),
  v.literal("context_changed"),
  v.literal("agent_revision_changed"),
  v.literal("lead_rejected"),
  v.literal("lead_replied"),
  v.literal("suppressed"),
  v.literal("booking_not_current"),
);

type AutopilotRefusal = typeof vAutopilotRefusal.type;

export const vAutopilotApprovalResult = v.union(
  v.object({
    approved: v.literal(true),
    approvalId: v.id("approvals"),
    replayed: v.boolean(),
  }),
  v.object({ approved: v.literal(false), reason: vAutopilotRefusal }),
);

export type AutopilotApprovalResult = typeof vAutopilotApprovalResult.type;

/**
 * Approve one draft as Autopilot and wake the send boundary.
 *
 * Every check below is re-read here rather than trusted from the step that
 * wrote the draft: writing and approving are two transactions, and a pause, a
 * rejection, a reply, an unsubscribe or an instruction change can land in
 * between. The send boundary then re-runs all of it a third time — this
 * function's refusals only save a pointless reservation.
 */
export const approveAsAutopilot = internalMutation({
  args: { draftId: v.id("drafts") },
  returns: vAutopilotApprovalResult,
  handler: async (ctx, args): Promise<AutopilotApprovalResult> => {
    const refuse = (reason: AutopilotRefusal): AutopilotApprovalResult => ({
      approved: false,
      reason,
    });

    const draft = await ctx.db.get("drafts", args.draftId);
    if (draft === null) {
      throw domainError("NOT_FOUND", "draft not found");
    }
    const conversation = await ctx.db.get("conversations", draft.conversationId);
    const workspace = await ctx.db.get("workspaces", draft.workspaceId);
    if (conversation === null || workspace === null) {
      throw domainError("NOT_FOUND", "approval context is incomplete");
    }

    // --- the exact draft binding (the same one `resolveDraft` applies) ----
    if (
      conversation.currentDraftId !== draft._id ||
      draft.supersededAt !== undefined ||
      draft.state !== "current"
    ) {
      return refuse("draft_not_current");
    }
    if (conversation.contextVersion !== draft.basedOnContextVersion) {
      return refuse("context_changed");
    }

    // --- the mode matrix, at the moment of effect ------------------------
    if (workspace.automationState !== "active") {
      return refuse("workspace_paused");
    }
    const agent =
      conversation.agentId === undefined
        ? null
        : await ctx.db.get("agents", conversation.agentId);
    if (agent === null || agent.mode !== "autopilot") {
      return refuse("not_autopilot");
    }
    if (agent.autopilot === undefined) {
      return refuse("consent_missing");
    }
    if (agent.revision !== draft.agentRevision) {
      return refuse("agent_revision_changed");
    }

    // --- the lead this text is for ---------------------------------------
    const lead =
      conversation.prospectId === undefined
        ? null
        : await ctx.db.get("prospects", conversation.prospectId);
    if (lead !== null && lead.workspaceId === workspace._id) {
      if (lead.approval === "rejected" || lead.stage === "rejected") {
        return refuse("lead_rejected");
      }
      if (lead.lastReplyAt !== undefined && lead.lastReplyAt >= draft.createdAt) {
        return refuse("lead_replied");
      }
    }
    if (
      (await matchSuppression(ctx, workspace._id, draft.normalizedRecipient)) !==
      null
    ) {
      return refuse("suppressed");
    }
    if (draft.bookingId !== undefined && !(await bookingStillOffered(ctx, draft, conversation))) {
      return refuse("booking_not_current");
    }

    // --- the row, and the wake -------------------------------------------
    // One approval per draft revision, ever: the request id is derived from
    // the draft and its revision, so a re-driven write step replays the
    // recorded verdict instead of minting a second one.
    const requestId = `autopilot:${draft._id}:r${draft.revision}`;
    const prior = await ctx.db
      .query("approvals")
      .withIndex("by_workspaceId_and_requestId", (q) =>
        q.eq("workspaceId", workspace._id).eq("requestId", requestId),
      )
      .unique();
    if (prior !== null) {
      return { approved: true, approvalId: prior._id, replayed: true };
    }

    const now = Date.now();
    const approvalId = await ctx.db.insert("approvals", {
      workspaceId: workspace._id,
      actor: "autopilot",
      draftId: draft._id,
      draftRevision: draft.revision,
      payloadHash: draft.payloadHash,
      normalizedRecipient: draft.normalizedRecipient,
      contextVersion: conversation.contextVersion,
      decision: "approved",
      // Not a human identity: the authorisation behind it is
      // `agents.autopilot`, recorded when a person accepted the consent
      // dialog, and this names the agent that acted on it.
      approverIdentityKey: `autopilot:${agent._id}`,
      createdAt: now,
      requestId,
    });
    await recordActivityEvent(ctx, {
      workspaceId: workspace._id,
      kind: "approval_recorded",
      summary:
        `Autopilot approved draft revision ${draft.revision} for ` +
        `${draft.normalizedRecipient} (payload ${draft.payloadHash.slice(0, 12)}…)`,
      actor: "autopilot",
      dedupeKey: `approval:${approvalId}:recorded`,
      conversationId: conversation._id,
    });
    // The send boundary re-runs EVERY gate fresh; approval alone never sends.
    await ctx.scheduler.runAfter(
      0,
      internal.outreach.sendActions.sendApprovedDraft,
      { draftId: draft._id },
    );
    return { approved: true, approvalId, replayed: false };
  },
});

/**
 * §4.3: a booking-linked draft is approvable only while the proposal it names
 * is still live at the exact version the content was written against. Outreach
 * drafts carry no booking link today; the reply flow may, so the check is
 * here rather than assumed away.
 */
async function bookingStillOffered(
  ctx: MutationCtx,
  draft: Doc<"drafts">,
  conversation: Doc<"conversations">,
): Promise<boolean> {
  if (draft.bookingId === undefined) {
    return true;
  }
  const booking = await ctx.db.get("bookings", draft.bookingId);
  return (
    booking !== null &&
    booking.workspaceId === draft.workspaceId &&
    booking.state === "proposed" &&
    booking.version === draft.bookingVersion &&
    booking.prospectId === conversation.prospectId
  );
}
