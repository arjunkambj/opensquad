/** Member-guarded reads of the org's agent. */
import { query } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import { getOrgAgent, vAgentDoc } from "./model";
import { v } from "convex/values";

/** The org's agent. `null` is the pre-onboarding state, not an error. */
export const get = query({
  args: { orgId: v.id("orgs") },
  returns: v.union(vAgentDoc, v.null()),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    return await getOrgAgent(ctx, args.orgId);
  },
});
