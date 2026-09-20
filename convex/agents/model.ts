/**
 * Agents — the one sales agent a workspace runs (PLAN §7).
 *
 * This domain owns the agent record: its mode and status, the ICP and search
 * strategies it sources from, and the run loop that drives it. It owns
 * neither the leads it produces nor the outreach it sends — it only decides
 * what to look for and when to run.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  AGENT_AUTO_APPROVE_MIN_SCORE_DEFAULT,
  AGENT_AUTO_REVEAL_DAILY_CAP_DEFAULT,
  AGENT_DAILY_LEAD_CAP_DEFAULT,
  AGENT_DAILY_RESEARCH_CAP_DEFAULT,
  AGENT_FOLLOW_UP_DAYS_DEFAULT,
} from "../lib/limits";
import { domainError, EMPTY_AGENT_ICP } from "../lib/validators";
import { agentFields } from "../schema";
import { v } from "convex/values";

export const vAgentDoc = v.object({
  _id: v.id("agents"),
  _creationTime: v.number(),
  ...agentFields,
});

/** The workspace's agent, or `null` before onboarding creates one. */
export async function getWorkspaceAgent(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"agents"> | null> {
  return await ctx.db
    .query("agents")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
    .first();
}

/**
 * Create the workspace's one draft agent — the row onboarding fills in step
 * by step, and the home every onboarding answer is saved to.
 *
 * ONE AGENT PER WORKSPACE, enforced here rather than by an index: the read
 * and the insert sit in one serializable transaction, so a second create —
 * concurrent or later — sees the first and refuses with CONFLICT.
 *
 * The agent starts in `sourcing_only`: until an inbox is connected it finds
 * and researches leads and contacts nobody (PLAN §1).
 */
export async function createDraftAgent(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"agents">> {
  const existing = await getWorkspaceAgent(ctx, workspaceId);
  if (existing !== null) {
    throw domainError("CONFLICT", "this organization already has an agent");
  }
  const now = Date.now();
  const agentId = await ctx.db.insert("agents", {
    workspaceId,
    // Named from the ICP once onboarding knows one; until then the agent is
    // unnamed rather than carrying a fabricated title.
    name: "",
    status: "draft",
    mode: "sourcing_only",
    onboardingStep: "company",
    icp: EMPTY_AGENT_ICP,
    goal: "start_conversations",
    tone: "professional",
    keywords: [],
    dailyLeadCap: AGENT_DAILY_LEAD_CAP_DEFAULT,
    dailyResearchCap: AGENT_DAILY_RESEARCH_CAP_DEFAULT,
    autoRevealDailyCap: AGENT_AUTO_REVEAL_DAILY_CAP_DEFAULT,
    autoApproveMinScore: AGENT_AUTO_APPROVE_MIN_SCORE_DEFAULT,
    followUpDays: [...AGENT_FOLLOW_UP_DAYS_DEFAULT],
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  const created = await ctx.db.get("agents", agentId);
  if (created === null) {
    throw domainError("NOT_FOUND", "agent not found after insert");
  }
  return created;
}

/** Load the agent for a write, or refuse. */
export async function requireWorkspaceAgent(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  agentId: Id<"agents">,
): Promise<Doc<"agents">> {
  const agent = await ctx.db.get("agents", agentId);
  if (agent === null || agent.workspaceId !== workspaceId) {
    // A row in another workspace is the same NOT_FOUND — existence never
    // leaks across a workspace boundary.
    throw domainError("NOT_FOUND", "agent not found");
  }
  return agent;
}
