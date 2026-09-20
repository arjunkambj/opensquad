/**
 * Evidence — one observation with the source it came from (§4.3/§4.5).
 *
 * A row is only ever synthesized from the BACKEND'S OWN retrieval, never from
 * a model field: `sourceUrl`, `retrievedAt` and `excerpt` come from the
 * `providerOperations` receipt Convex wrote when it paid for the page, and
 * `confidence` defaults to `unknown` unless the basis can be stated
 * mechanically. Only reads live here today.
 *
 * // AI research/synthesis: reimplemented via Convex AI Gateway (see plan)
 */
import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspaceMember } from "./lib/auth";
import { boundedLimit, domainError } from "./lib/validators";
import { evidenceFields } from "./schema";

export const vEvidenceDoc = v.object({
  _id: v.id("evidence"),
  _creationTime: v.number(),
  ...evidenceFields,
});

const vEvidenceListPage = v.object({
  items: v.array(vEvidenceDoc),
  cursor: v.union(v.string(), v.null()),
  hasMore: v.boolean(),
});

/**
 * One prospect's evidence, newest first. A prospect in another workspace is
 * NOT_FOUND, never FORBIDDEN — existence never leaks across a workspace
 * boundary (house rule, and the isolation V02/V06 assert).
 */
export const listForProspect = query({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: vEvidenceListPage,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const prospect = await ctx.db.get("prospects", args.prospectId);
    if (prospect === null || prospect.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "prospect not found");
    }
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("evidence")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", args.prospectId),
      )
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});
