/**
 * Company — the business we are selling FOR (PLAN §7): one current business
 * profile per workspace, plus the website analysis that fills it in.
 *
 * This domain owns the profile record and its `analysisStatus`; it owns
 * nothing about the leads we sell TO. Reads require any active member.
 */
import { query } from "../_generated/server";
import { requireWorkspaceMember } from "../lib/auth";
import { businessProfileFields } from "../schema";
import { v } from "convex/values";

export const vBusinessProfileDoc = v.object({
  _id: v.id("businessProfiles"),
  _creationTime: v.number(),
  ...businessProfileFields,
});

/** The workspace's current profile, or `null` before onboarding saves one. */
export const get = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(vBusinessProfileDoc, v.null()),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await ctx.db
      .query("businessProfiles")
      .withIndex("by_workspaceId", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .unique();
  },
});
