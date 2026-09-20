/** Member-guarded reads of the workspace and its memberships. */
import { query } from "../_generated/server";
import {
  expectedUsersIssuer,
  getUserIdentity,
  requireWorkspaceMember,
} from "../lib/auth";
import { vRole } from "../lib/validators";
import { toWorkspaceView, vMembershipDoc, vWorkspaceView } from "./model";
import { v } from "convex/values";

/**
 * The caller's current workspace (first active membership, preferring owned)
 * plus their role, or `null` when signed out / anonymous / no membership.
 */
export const getCurrent = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      workspace: vWorkspaceView,
      role: vRole,
      membershipId: v.id("memberships"),
    }),
  ),
  handler: async (ctx) => {
    const identity = await getUserIdentity(ctx);
    if (identity === null || identity.issuer !== expectedUsersIssuer()) {
      return null;
    }
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_identityKey_and_status", (q) =>
        q.eq("identityKey", identity.tokenIdentifier).eq("status", "active"),
      )
      .collect();
    if (memberships.length === 0) {
      return null;
    }
    // Prefer a workspace the caller OWNS; there is at most one (PLAN §6),
    // and an invited membership must not shadow it.
    for (const entry of memberships) {
      if (entry.role !== "owner") {
        continue;
      }
      const candidate = await ctx.db.get("workspaces", entry.workspaceId);
      if (candidate !== null) {
        return {
          workspace: toWorkspaceView(candidate),
          role: entry.role,
          membershipId: entry._id,
        };
      }
    }
    const membership =
      memberships.find((entry) => entry.role === "owner") ?? memberships[0];
    const workspace = await ctx.db.get("workspaces", membership.workspaceId);
    if (workspace === null) {
      return null;
    }
    return {
      workspace: toWorkspaceView(workspace),
      role: membership.role,
      membershipId: membership._id,
    };
  },
});

/** Workspace read for an active member. */
export const get = query({
  args: { workspaceId: v.id("workspaces") },
  returns: vWorkspaceView,
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceMember(ctx, args.workspaceId);
    return toWorkspaceView(workspace);
  },
});

/** Active and revoked memberships of the caller's workspace. */
export const listMembers = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(vMembershipDoc),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await ctx.db
      .query("memberships")
      .withIndex("by_workspaceId_and_identityKey", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .collect();
  },
});
