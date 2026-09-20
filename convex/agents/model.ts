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
import { domainError } from "../lib/validators";
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
