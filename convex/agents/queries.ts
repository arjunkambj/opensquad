/** Member-guarded reads of the workspace's agent. */
import { query } from "../_generated/server";
import { requireWorkspaceMember } from "../lib/auth";
import { getWorkspaceAgent, vAgentDoc } from "./model";
import { v } from "convex/values";

/** The workspace's agent. `null` is the pre-onboarding state, not an error. */
export const get = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(vAgentDoc, v.null()),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await getWorkspaceAgent(ctx, args.workspaceId);
  },
});
