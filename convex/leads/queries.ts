/**
 * The lead read surface: the Contacts table, the due counter, search and the
 * lead drawer. Member-guarded, indexed and cursor-paginated.
 */
import { query } from "../_generated/server";
import { vBookingDoc } from "../bookings/model";
import { requireWorkspaceMember } from "../lib/auth";
import {
  boundedLimit,
  boundedString,
  DEFAULT_LIST_LIMIT,
  domainError,
  MAX_LIST_LIMIT,
  PROSPECT_COMPANY_NAME_MAX_LENGTH,
  vLeadApproval,
  vLeadStage,
} from "../lib/validators";
import { vLeadEventDoc } from "./events";
import { vEvidenceDoc } from "./evidence";
import { listPage, vListPage, vProspectDoc } from "./model";
import { v } from "convex/values";

/** Leads in one workspace — see `listPage` for the supported index modes. */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    stage: v.optional(vLeadStage),
    approval: v.optional(vLeadApproval),
    /** Due mode: a bounded `nextActionAt` range (either bound may be
     *  omitted; `{}` lists every lead that HAS a due date). */
    dueRange: v.optional(
      v.object({
        from: v.optional(v.number()),
        to: v.optional(v.number()),
      }),
    ),
    /** The complementary due slice: leads with NO `nextActionAt`. */
    unscheduled: v.optional(v.boolean()),
    /** Best score first; unresearched leads sort last. */
    topScoreFirst: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: vListPage,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await listPage(ctx, args);
  },
});

/**
 * How many leads the state machine owes work to right now — the attention
 * count the app header renders. Bounded at `MAX_LIST_LIMIT` like every
 * workspace count: `hasMore` means the number is the bound, not the total, so
 * the UI renders "50+". Leads with no due time can never satisfy the range,
 * so they can never inflate it either.
 */
export const countDue = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({
    count: v.number(),
    hasMore: v.boolean(),
    bound: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const now = Date.now();
    const rows = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_nextActionAt", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .gte("nextActionAt", 0)
          .lte("nextActionAt", now),
      )
      .take(MAX_LIST_LIMIT + 1);
    return {
      count: Math.min(rows.length, MAX_LIST_LIMIT),
      hasMore: rows.length > MAX_LIST_LIMIT,
      bound: MAX_LIST_LIMIT,
    };
  },
});

/**
 * Company-name search through the declared `search_company_name` index.
 * Equality filters (`stage`, `approval`) are applied INSIDE `withSearchIndex`
 * — the only fields the index declares — and pagination follows the engine's
 * relevance order. Empty text falls back to the ordinary list, so the table
 * never has to switch calls.
 */
export const search = query({
  args: {
    workspaceId: v.id("workspaces"),
    text: v.string(),
    stage: v.optional(vLeadStage),
    approval: v.optional(vLeadApproval),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: vListPage,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const text = boundedString(args.text, "text", {
      max: PROSPECT_COMPANY_NAME_MAX_LENGTH,
    }).trim();
    if (text === "") {
      return await listPage(ctx, args);
    }
    const result = await ctx.db
      .query("prospects")
      .withSearchIndex("search_company_name", (q) => {
        let scoped = q
          .search("companyName", text)
          .eq("workspaceId", args.workspaceId);
        if (args.stage !== undefined) {
          scoped = scoped.eq("stage", args.stage);
        }
        if (args.approval !== undefined) {
          scoped = scoped.eq("approval", args.approval);
        }
        return scoped;
      })
      .paginate({
        numItems: boundedLimit(args.limit),
        cursor: args.cursor ?? null,
      });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});

/**
 * One lead with the evidence behind it, its bookings and the history that
 * produced it. A row in another workspace is NOT_FOUND, never FORBIDDEN.
 */
export const getDetail = query({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
  },
  returns: v.object({
    prospect: vProspectDoc,
    evidence: v.array(vEvidenceDoc),
    events: v.array(vLeadEventDoc),
    bookings: v.array(vBookingDoc),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const prospect = await ctx.db.get("prospects", args.prospectId);
    if (prospect === null || prospect.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "prospect not found");
    }
    const evidence = await ctx.db
      .query("evidence")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", args.prospectId),
      )
      .order("desc")
      .take(DEFAULT_LIST_LIMIT);
    const events = await ctx.db
      .query("leadEvents")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", args.prospectId),
      )
      .order("desc")
      .take(DEFAULT_LIST_LIMIT);
    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", args.prospectId),
      )
      .order("desc")
      .take(DEFAULT_LIST_LIMIT);
    return { prospect, evidence, events, bookings };
  },
});
