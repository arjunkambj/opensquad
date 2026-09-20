/**
 * Agents — the one sales agent a workspace runs (PLAN §7), successor to the
 * pre-pivot `campaigns` module.
 *
 * What lives here in T01: reading the workspace's agent, creating the draft
 * agent onboarding fills in, and editing the basics the Agent page and
 * Settings expose. ICP and strategy mutations arrive with onboarding
 * (T21/T23); mode, Run now and the strategy toggle with the Agent page (T32);
 * the run loop itself with T30. Nothing here schedules work.
 *
 * Two rules govern every write below:
 *
 *   ONE AGENT PER WORKSPACE. Convex has no unique index, so `createDraft`
 *   reads the workspace's agent range in the SAME transaction it inserts
 *   into. Convex mutations are serializable, so two concurrent creates cannot
 *   both pass that read — the lookup index is what turns into the constraint.
 *
 *   REVISION FENCING (PLAN §9.1). Changing what the agent SAYS — its
 *   instructions — invalidates work already queued under the old wording, so
 *   it bumps `revision`; renaming the agent or recording a deal size does
 *   not. Unsent drafts under an older revision are superseded by the outreach
 *   loop rather than sent.
 */
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspaceEditor, requireWorkspaceMember } from "./lib/auth";
import {
  boundedString,
  domainError,
  invalid,
  normalizeHttpUrl,
  AGENT_AUTO_APPROVE_MIN_SCORE_DEFAULT,
  AGENT_AUTO_REVEAL_DAILY_CAP_DEFAULT,
  AGENT_DAILY_LEAD_CAP_DEFAULT,
  AGENT_DAILY_RESEARCH_CAP_DEFAULT,
  AGENT_FOLLOW_UP_DAYS_DEFAULT,
  AGENT_INSTRUCTIONS_MAX_LENGTH,
  AGENT_NAME_MAX_LENGTH,
  EMPTY_AGENT_ICP,
} from "./lib/validators";
import { agentFields } from "./schema";

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
async function requireWorkspaceAgent(
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

/** The workspace's agent. `null` is the pre-onboarding state, not an error. */
export const get = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(vAgentDoc, v.null()),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await getWorkspaceAgent(ctx, args.workspaceId);
  },
});

/**
 * Create the workspace's draft agent — the row onboarding fills in step by
 * step. Idempotent by construction: a workspace that already has an agent
 * gets that agent back rather than a second one, which is also what makes a
 * double-clicked "Get started" harmless.
 *
 * The agent starts in `sourcing_only`: until an inbox is connected it finds
 * and researches leads and contacts nobody (PLAN §1).
 */
export const createDraft = mutation({
  args: { workspaceId: v.id("workspaces") },
  returns: vAgentDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const existing = await getWorkspaceAgent(ctx, args.workspaceId);
    if (existing !== null) {
      return existing;
    }
    const now = Date.now();
    const agentId = await ctx.db.insert("agents", {
      workspaceId: args.workspaceId,
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
  },
});

/**
 * Edit the agent's basics. Every field is optional: the caller sends what the
 * user changed, and omitting one leaves it alone.
 *
 * `instructions` is the only member that bumps `revision` — it is what the
 * outreach model is told to say, so a queued draft written under the old
 * wording must not go out (PLAN §9.1). A rename or a deal size changes
 * nothing about the mail, so it invalidates nothing.
 */
export const updateBasics = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    name: v.optional(v.string()),
    instructions: v.optional(v.string()),
    bookingUrl: v.optional(v.string()),
    dealSize: v.optional(v.number()),
  },
  returns: vAgentDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const agent = await requireWorkspaceAgent(
      ctx,
      args.workspaceId,
      args.agentId,
    );

    const name =
      args.name === undefined
        ? undefined
        : boundedString(args.name, "name", {
            min: 1,
            max: AGENT_NAME_MAX_LENGTH,
          });
    const instructions =
      args.instructions === undefined
        ? undefined
        : boundedString(args.instructions, "instructions", {
            max: AGENT_INSTRUCTIONS_MAX_LENGTH,
          });
    const bookingUrl =
      args.bookingUrl === undefined
        ? undefined
        : normalizeHttpUrl(args.bookingUrl, "bookingUrl");
    if (
      args.dealSize !== undefined &&
      (!Number.isFinite(args.dealSize) || args.dealSize < 0)
    ) {
      throw invalid("dealSize must be a non-negative number");
    }

    const instructionsChanged =
      instructions !== undefined && instructions !== (agent.instructions ?? "");

    await ctx.db.patch("agents", agent._id, {
      ...(name !== undefined ? { name } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
      ...(bookingUrl !== undefined ? { bookingUrl } : {}),
      ...(args.dealSize !== undefined ? { dealSize: args.dealSize } : {}),
      ...(instructionsChanged ? { revision: agent.revision + 1 } : {}),
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get("agents", agent._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "agent not found after update");
    }
    return updated;
  },
});
