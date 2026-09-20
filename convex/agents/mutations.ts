/**
 * Agent writes — creating the draft agent onboarding fills in, and editing
 * the basics the Agent page and Settings expose. Nothing here schedules work.
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
import { mutation } from "../_generated/server";
import { requireWorkspaceEditor } from "../lib/auth";
import {
  AGENT_INSTRUCTIONS_MAX_LENGTH,
  AGENT_NAME_MAX_LENGTH,
  boundedString,
  domainError,
  invalid,
  normalizeHttpUrl,
} from "../lib/validators";
import { createDraftAgent, requireWorkspaceAgent, vAgentDoc } from "./model";
import { v } from "convex/values";

/**
 * Create the workspace's draft agent — the row onboarding fills in step by
 * step.
 *
 * ONE AGENT PER WORKSPACE, enforced in `createDraftAgent` rather than by an
 * index: the read and the insert are in one serializable transaction, so a
 * second create — concurrent or later — sees the first and refuses. Callers
 * that only want "the agent" read `agents.get` first; a CONFLICT here means
 * there already is one, never that anything was lost.
 *
 * Workspace creation makes this same draft agent in its own transaction, so
 * onboarding progress always has a home; this mutation stays for the case
 * where a workspace somehow has none.
 */
export const createDraft = mutation({
  args: { workspaceId: v.id("workspaces") },
  returns: vAgentDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    return await createDraftAgent(ctx, args.workspaceId);
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
