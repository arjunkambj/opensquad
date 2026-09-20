/**
 * Autopilot's lead approval — "yes, contact this person", decided by the agent
 * instead of by a human (PLAN §9.3 matrix, row Autopilot).
 *
 * `leads/approval.ts` holds the same decision when a PERSON makes it, and the
 * two are deliberately separate functions rather than one with a flag:
 *
 *   `decideOne` requires an authenticated `identityKey`, records
 *   `approvedBy: "user"` and a `human` actor, and may also REJECT — which
 *   retires queued outreach. Autopilot has no identity, only ever approves,
 *   and records `approvedBy: "autopilot"` with a `workflow` actor, so the
 *   Contacts drawer can say who said yes rather than inferring it from the
 *   agent's mode at read time.
 *
 * What it will never do:
 *   TURN ITSELF ON. This mutation refuses unless the agent is already in
 *   `autopilot` mode AND carries the consent record `agents.settingsMode.setMode`
 *   writes. Nothing here writes `agents.mode` or `agents.autopilot`.
 *   OVERRULE A HUMAN. Only a `pending` lead is touched; a rejected lead — or
 *   one a person already approved — is left exactly as it is.
 *   SPEND ANYTHING. Approving is free (PLAN §6). It only makes the lead
 *   eligible for the outreach loop's next step, which is where the money is.
 */
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import {
  boundedInt,
  LEAD_SCORE_MAX,
  LEAD_SCORE_MIN,
} from "../lib/validators";
import { appendLeadEvent } from "./events";
import { v } from "convex/values";

/** Pending leads one pass looks at. A bounded read, not a page size. */
const PENDING_SCAN_MAX = 100;

/** Leads one pass may approve, so a tick stays inside one transaction. */
const APPROVE_PER_PASS_MAX = 25;

/**
 * Approve the leads this agent's Autopilot is allowed to contact.
 *
 * Called by the outreach tick, once per agent per pass. Idempotent: the
 * decision is keyed per lead in `leadEvents`, and a lead that already carries
 * a decision is skipped before anything is written.
 */
export const autoApproveForAgent = internalMutation({
  args: {
    agentId: v.id("agents"),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    approved: v.number(),
  }),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (agent === null) {
      return { scanned: 0, approved: 0 };
    }
    // The consent gate, re-read at the moment of effect: a mode that moved
    // back to review — or an authorisation that was cleared — stops the next
    // pass dead, whatever the tick believed when it scheduled this.
    if (agent.mode !== "autopilot" || agent.autopilot === undefined) {
      return { scanned: 0, approved: 0 };
    }
    const limit =
      args.limit === undefined
        ? APPROVE_PER_PASS_MAX
        : boundedInt(args.limit, "limit", { min: 1, max: APPROVE_PER_PASS_MAX });
    const minScore = boundedInt(
      agent.autoApproveMinScore,
      "autoApproveMinScore",
      { min: LEAD_SCORE_MIN, max: LEAD_SCORE_MAX },
    );

    const pending = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_approval", (q) =>
        q.eq("workspaceId", agent.workspaceId).eq("approval", "pending"),
      )
      .order("desc")
      .take(PENDING_SCAN_MAX);

    let approved = 0;
    for (const lead of pending) {
      if (approved >= limit) {
        break;
      }
      if (!eligibleForAutoApproval(lead, agent, minScore)) {
        continue;
      }
      const now = Date.now();
      await ctx.db.patch("prospects", lead._id, {
        approval: "approved",
        approvedBy: "autopilot",
        updatedAt: now,
      });
      await appendLeadEvent(ctx, {
        workspaceId: lead.workspaceId,
        prospectId: lead._id,
        kind: "approval_changed",
        summary: `Autopilot approved this lead for outreach (score at or above ${minScore})`,
        // One key per lead, forever: a lead approved by Autopilot and then
        // rejected by a person must never be silently re-approved under a
        // new key, and the `pending`-only guard above is what enforces it.
        operationKey: `lead:${lead._id}:approval:autopilot`,
        details: {
          fromApproval: lead.approval,
          toApproval: "approved",
          approvalActor: "autopilot",
        },
      });
      approved += 1;
    }
    return { scanned: pending.length, approved };
  },
});

/**
 * Whether Autopilot may say yes to this lead.
 *
 * A score exists only on a RESEARCHED lead (PLAN §7), so an unresearched or
 * failed one is never approved — Autopilot approving a person nobody has
 * looked at is exactly what `autoApproveMinScore` exists to prevent. A lead
 * outside the ordered pipeline (rejected, closed, parked for attention) is
 * left alone: those three states are a person's decision or a failure that
 * needs one.
 */
function eligibleForAutoApproval(
  lead: Doc<"prospects">,
  agent: Doc<"agents">,
  minScore: number,
): boolean {
  return (
    lead.agentId === agent._id &&
    lead.approval === "pending" &&
    lead.research.status === "researched" &&
    lead.research.aiScore >= minScore &&
    lead.stage !== "rejected" &&
    lead.stage !== "closed_lost" &&
    lead.stage !== "needs_attention"
  );
}
