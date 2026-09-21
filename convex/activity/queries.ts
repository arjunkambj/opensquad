/** Member-guarded, indexed, cursor-paginated reads over the activity feed. */
import { query } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import { paged } from "../lib/pagination";
import { boundedLimit } from "../lib/validators";
import { activityEventFields } from "../schema";
import { v } from "convex/values";

export const vActivityEventDoc = v.object({
  _id: v.id("activityEvents"),
  _creationTime: v.number(),
  ...activityEventFields,
});

/**
 * Chronological org activity feed. `from`/`to` bound the `createdAt`
 * range. Newest first, cursor-paginated, `{items, cursor, hasMore}`.
 */
export const list = query({
  args: {
    orgId: v.id("orgs"),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vActivityEventDoc),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("activityEvents")
      .withIndex("by_orgId_and_createdAt", (q) => {
        const bound = q.eq("orgId", args.orgId);
        if (args.from !== undefined && args.to !== undefined) {
          return bound.gte("createdAt", args.from).lte("createdAt", args.to);
        }
        if (args.from !== undefined) {
          return bound.gte("createdAt", args.from);
        }
        if (args.to !== undefined) {
          return bound.lte("createdAt", args.to);
        }
        return bound;
      })
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return paged(result, result.page);
  },
});
