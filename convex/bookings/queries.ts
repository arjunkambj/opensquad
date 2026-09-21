/** Member-guarded, paginated booking lists. */
import { query } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import { paged } from "../lib/pagination";
import {
  boundedLimit,
  domainError,
  invalid,
  vBookingState,
} from "../lib/validators";
import { vListPage } from "./model";
import { v } from "convex/values";

/**
 * Bookings, sliced exactly the way the declared indexes allow:
 *
 *   `prospectId` — one lead's booking history, newest first
 *   (`by_prospectId_and_createdAt`; `state` narrows it on
 *   `by_prospectId_and_state`).
 *
 *   `state` — the org's bookings in one state, ordered by `startsAt`
 *   (`by_orgId_and_state_and_startsAt`): soonest-first for `confirmed`
 *   — the upcoming-meetings view — and `proposed` rows, which have no
 *   `startsAt`, sort together at the front; terminal states newest-first.
 *
 *   `owner` — one member's bookings by `startsAt`
 *   (`by_orgId_and_ownerIdentityKey_and_startsAt`), soonest first: the
 *   operator's worklist, where undated proposals lead.
 *
 * Combinations with no index — owner+state, everything together — REFUSE
 * rather than silently post-filter a truncated page (§5).
 */
export const list = query({
  args: {
    orgId: v.id("orgs"),
    prospectId: v.optional(v.id("prospects")),
    state: v.optional(vBookingState),
    owner: v.optional(v.string()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: vListPage,
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const paginate = {
      numItems: boundedLimit(args.limit),
      cursor: args.cursor ?? null,
    };
    if (args.prospectId !== undefined) {
      if (args.owner !== undefined) {
        throw invalid(
          "owner cannot combine with prospectId — no index supports that combination",
        );
      }
      const prospectId = args.prospectId;
      const prospect = await ctx.db.get("prospects", prospectId);
      if (prospect === null || prospect.orgId !== args.orgId) {
        throw domainError("NOT_FOUND", "prospect not found");
      }
      const state = args.state;
      const result =
        state !== undefined
          ? await ctx.db
              .query("bookings")
              .withIndex("by_prospectId_and_state", (q) =>
                q.eq("prospectId", prospectId).eq("state", state),
              )
              .order("desc")
              .paginate(paginate)
          : await ctx.db
              .query("bookings")
              .withIndex("by_prospectId_and_createdAt", (q) =>
                q.eq("prospectId", prospectId),
              )
              .order("desc")
              .paginate(paginate);
      return paged(result, result.page);
    }
    if (args.state !== undefined && args.owner !== undefined) {
      throw invalid(
        "owner cannot combine with state — no index supports that combination",
      );
    }
    if (args.state !== undefined) {
      const state = args.state;
      const result = await ctx.db
        .query("bookings")
        .withIndex("by_orgId_and_state_and_startsAt", (q) =>
          q
            .eq("orgId", args.orgId)
            .eq("state", state),
        )
        .order("asc")
        .paginate(paginate);
      return paged(result, result.page);
    }
    if (args.owner !== undefined) {
      const owner = args.owner;
      const result = await ctx.db
        .query("bookings")
        .withIndex("by_orgId_and_ownerIdentityKey_and_startsAt", (q) =>
          q.eq("orgId", args.orgId).eq("ownerIdentityKey", owner),
        )
        .order("asc")
        .paginate(paginate);
      return paged(result, result.page);
    }
    throw invalid(
      "list requires one of prospectId, state or owner — the schema declares an index per supported slice and no organization-wide range exists",
    );
  },
});
