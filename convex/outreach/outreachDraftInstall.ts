/**
 * What happens to the text the model wrote: it becomes the conversation's
 * next draft revision, and in Autopilot it is approved and handed to the send
 * boundary. Plus the two ways the step can end badly — the retry ladder and
 * the no-fault release.
 *
 * Every fact the claim checked is checked AGAIN here. Writing takes seconds,
 * and a pause, a rejection, a reply or an instruction change can land inside
 * them; a draft born under a revision that has already moved on would only be
 * refused by the send gates, so it is not born at all.
 */
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { vOperationErrorCode } from "../lib/validators";
import type { AutopilotApprovalResult } from "./autopilotApproval";
import {
  failOutreachStep,
  loadLeadForAgent,
  releaseLeadClaim,
  restLeadAfterWrite,
} from "./outreachLeadState";
import { v } from "convex/values";

const vInstallResult = v.union(
  v.object({ installed: v.literal(false), reason: v.string() }),
  v.object({
    installed: v.literal(true),
    draftId: v.id("drafts"),
    /** Autopilot only: the draft is approved and the send is scheduled. */
    approved: v.boolean(),
  }),
);

export type InstallOutreachDraftResult = typeof vInstallResult.type;

/**
 * Store what the model wrote as the conversation's next draft revision, and —
 * in Autopilot — approve it and wake the send boundary.
 *
 * In Review this is where the loop stops. The draft waits for the user's own
 * `approvals.approve`, which is the existing human path and is not touched
 * here; the lead rests until that approval's send is accepted.
 */
export const installOutreachDraft = internalMutation({
  args: {
    agentId: v.id("agents"),
    prospectId: v.id("prospects"),
    conversationId: v.id("conversations"),
    revision: v.number(),
    /** The normalized address the claim resolved — never re-derived here. */
    recipient: v.string(),
    subject: v.string(),
    body: v.string(),
    /** The paid call's operation key, reused as the draft's dedupe key. */
    requestId: v.string(),
    replyToMessageRef: v.optional(v.string()),
    evidenceIds: v.optional(v.array(v.string())),
  },
  returns: vInstallResult,
  handler: async (ctx, args): Promise<InstallOutreachDraftResult> => {
    const agent = await ctx.db.get("agents", args.agentId);
    const lead = await loadLeadForAgent(ctx, args.agentId, args.prospectId);
    if (agent === null || lead === null) {
      return { installed: false as const, reason: "agent_or_lead_missing" };
    }
    if (agent.revision !== args.revision) {
      // The wording moved while this text was being written. Installing it
      // would create a draft the send gates refuse on sight, so the lead goes
      // back due and the next pass writes what the agent says today.
      await releaseLeadClaim(ctx, lead);
      return { installed: false as const, reason: "agent_revision_changed" };
    }
    if (
      lead.approval !== "approved" ||
      lead.stage === "rejected" ||
      lead.lastReplyAt !== undefined
    ) {
      await restLeadAfterWrite(ctx, lead);
      return { installed: false as const, reason: "lead_not_writable" };
    }

    const draft = await ctx.runMutation(
      internal.outreach.draftRevisions.createRevision,
      {
        conversationId: args.conversationId,
        recipient: args.recipient,
        subject: args.subject,
        body: args.body,
        evidenceIds: args.evidenceIds ?? [],
        createdBy: "agent",
        requestId: args.requestId,
        ...(args.replyToMessageRef !== undefined
          ? { replyToMessageRef: args.replyToMessageRef }
          : {}),
      },
    );
    await restLeadAfterWrite(ctx, lead);

    if (agent.mode !== "autopilot") {
      // Review: the draft waits for a person. Nothing is approved, nothing is
      // reserved, nothing is sent.
      return { installed: true as const, draftId: draft._id, approved: false };
    }
    const approval: AutopilotApprovalResult = await ctx.runMutation(
      internal.outreach.autopilotApproval.approveAsAutopilot,
      { draftId: draft._id },
    );
    return {
      installed: true as const,
      draftId: draft._id,
      approved: approval.approved,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Failure                                                             */
/* ------------------------------------------------------------------ */

/** One rung of the retry ladder for a write that failed (PLAN §9.1). */
export const failOutreachWrite = internalMutation({
  args: {
    agentId: v.id("agents"),
    prospectId: v.id("prospects"),
    code: vOperationErrorCode,
  },
  returns: v.object({ attempts: v.number(), parked: v.boolean() }),
  handler: async (ctx, args) => {
    const lead = await loadLeadForAgent(ctx, args.agentId, args.prospectId);
    if (lead === null) {
      return { attempts: 0, parked: false };
    }
    return await failOutreachStep(ctx, lead, args.code);
  },
});

/**
 * Put a claimed lead back without burning an attempt — the refusal was about
 * the account, not this lead (PLAN §9.1 "a step that never began").
 */
export const releaseOutreachWrite = internalMutation({
  args: {
    agentId: v.id("agents"),
    prospectId: v.id("prospects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const lead = await loadLeadForAgent(ctx, args.agentId, args.prospectId);
    if (lead !== null) {
      await releaseLeadClaim(ctx, lead);
    }
    return null;
  },
});

