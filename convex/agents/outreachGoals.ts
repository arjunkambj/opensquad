/**
 * Onboarding dot 3, sub-step 2 — what the outreach is for and how it reads
 * (PLAN §11 M1, reference 05).
 *
 * One mutation saves the whole screen, because the three answers belong to
 * one decision: the goal and the tone live on the agent, the audience's pain
 * points on the business profile the model writes from. Nothing here is paid
 * and nothing schedules work.
 *
 * REVISION FENCING (PLAN §9.1). Goal and tone are part of what the outreach
 * model is told to say, so a real change to either bumps `agents.revision`
 * and supersedes drafts written under the old wording. Re-saving the same
 * answers — which the stepper does whenever the user walks back and forward —
 * changes nothing and must not invalidate queued work, so the bump is
 * conditional on an actual difference, never on the write happening.
 *
 * The pain-points write reaches into `businessProfiles`, which the company
 * domain otherwise owns: it is the same screen's third answer, and splitting
 * it across two mutations would let the agent and the profile disagree if one
 * failed. It goes through the profile's own `version` counter so the company
 * editor's optimistic concurrency still sees the change.
 */
import { mutation } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import {
  boundedString,
  COMPANY_PAIN_POINTS_MAX_LENGTH,
  domainError,
  vAgentGoal,
  vAgentTone,
} from "../lib/validators";
import { getOrgAgent, vAgentDoc } from "./model";
import { v } from "convex/values";

/**
 * Save the goals sub-step. Returns the agent so the caller renders the
 * authoritative record rather than the values it sent.
 */
export const save = mutation({
  args: {
    orgId: v.id("orgs"),
    goal: vAgentGoal,
    tone: vAgentTone,
    painPoints: v.string(),
  },
  returns: vAgentDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(ctx, args.orgId);

    const painPoints = boundedString(args.painPoints, "painPoints", {
      max: COMPANY_PAIN_POINTS_MAX_LENGTH,
    });

    const agent = await getOrgAgent(ctx, args.orgId);
    if (agent === null) {
      throw domainError("NOT_FOUND", "this organization has no agent yet");
    }
    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .unique();
    if (profile === null) {
      // The company step creates the profile, and the model writes from it —
      // there is nowhere to put pain points before it exists.
      throw domainError(
        "NOT_FOUND",
        "this organization has no business profile yet",
      );
    }

    const now = Date.now();
    const fenced = agent.goal !== args.goal || agent.tone !== args.tone;
    await ctx.db.patch("agents", agent._id, {
      goal: args.goal,
      tone: args.tone,
      ...(fenced ? { revision: agent.revision + 1 } : {}),
      updatedAt: now,
    });

    if (profile.painPoints !== painPoints) {
      await ctx.db.patch("businessProfiles", profile._id, {
        painPoints,
        version: profile.version + 1,
        updatedAt: now,
        updatedBy: identityKey,
      });
    }

    const updated = await ctx.db.get("agents", agent._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "agent not found after update");
    }
    return updated;
  },
});
