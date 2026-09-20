/**
 * Reads of the org row, resolved from the organization active in the token.
 *
 * There is no "pick a tenant" step and no membership lookup: the auth
 * provider decides which organization the caller is in, and `getCurrent`
 * simply resolves the row that belongs to it (PLAN §4).
 */
import { query } from "../_generated/server";
import {
  activeHexclaveOrgId,
  expectedUsersIssuer,
  getUserIdentity,
  requireOrgMember,
} from "../lib/auth";
import { toOrgView, vOrgView } from "./model";
import { v } from "convex/values";

/**
 * The org row for the caller's ACTIVE organization.
 *
 * Three answers, kept apart on purpose — the client shows a different screen
 * for each: `null` is signed out or anonymous; `{ org }` is the tenant; and
 * `{ reason }` is "no row to read yet", carrying WHY. `no_active_org` means
 * the token names no organization, which the client resolves by selecting
 * one through the auth SDK; `not_initialised` means the organization is
 * active but has never entered the app, which `ensureOrg` fixes.
 */
export const getCurrent = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ org: vOrgView }),
    v.object({
      reason: v.union(v.literal("no_active_org"), v.literal("not_initialised")),
    }),
  ),
  handler: async (ctx) => {
    const identity = await getUserIdentity(ctx);
    if (identity === null || identity.issuer !== expectedUsersIssuer()) {
      return null;
    }
    const hexclaveOrgId = activeHexclaveOrgId(identity);
    if (hexclaveOrgId === null) {
      return { reason: "no_active_org" as const };
    }
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_hexclaveOrgId", (q) => q.eq("hexclaveOrgId", hexclaveOrgId))
      .first();
    if (org === null) {
      return { reason: "not_initialised" as const };
    }
    return { org: toOrgView(org) };
  },
});

/** Org read for a member of the active organization. */
export const get = query({
  args: { orgId: v.id("orgs") },
  returns: vOrgView,
  handler: async (ctx, args) => {
    const { org } = await requireOrgMember(ctx, args.orgId);
    return toOrgView(org);
  },
});
