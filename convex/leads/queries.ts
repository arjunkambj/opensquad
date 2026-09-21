/**
 * The lead read surface: the Contacts table, its bounded total and the lead
 * drawer. Member-guarded, index-backed and paginated.
 *
 * ONE LIST MODE AT A TIME. Convex ranges an index, so every filter this screen
 * offers is a range over an index the schema declares — company search, one
 * flame score, the approval queue, one stage, or the whole org best
 * score first. A pair with no index REFUSES rather than silently
 * post-filtering a page, because a page that looks filtered and is not is the
 * one failure the user cannot see.
 *
 * Payloads are the projections in `leads/rows.ts`: the stored document carries
 * the provider's own row id, and PLAN §4 keeps that server-side.
 */
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireOrgMember } from "../lib/auth";
import {
  boundedLimit,
  boundedString,
  DEFAULT_LIST_LIMIT,
  domainError,
  invalid,
  PROSPECT_COMPANY_NAME_MAX_LENGTH,
  vLeadApproval,
  vLeadStage,
} from "../lib/validators";
import type { LeadApproval, LeadStage } from "../lib/validators";
import { paged } from "../lib/pagination";
import { vLeadEventDoc } from "./events";
import { vEvidenceDoc } from "./evidence";
import {
  CONTACTS_TOTAL_BOUND,
  signalTitles,
  toLeadDetail,
  toLeadRow,
  vLeadDetail,
  vLeadRow,
  vLeadScore,
} from "./rows";
import { v } from "convex/values";

const vLeadPage = v.object({
  items: v.array(vLeadRow),
  cursor: v.union(v.string(), v.null()),
  hasMore: v.boolean(),
  /** Bounded at `CONTACTS_TOTAL_BOUND`; `hasMore` means "and more". */
  total: v.object({ count: v.number(), hasMore: v.boolean() }),
});

type LeadScore = 1 | 2 | 3;

/**
 * The five ways this table is ordered, each an exact index range:
 *   search   — `search_company_name`, relevance order, with `stage` or
 *              `approval` applied INSIDE the index (its declared filter
 *              fields), never on top of the page.
 *   score    — `by_orgId_and_scoreKey` at one score, newest first.
 *   approval — `by_orgId_and_approval`, newest first.
 *   stage    — `by_orgId_and_stage_and_updatedAt`, last change first.
 *   ranked   — `by_orgId_and_scoreKey` over every lead. Unresearched
 *              leads carry no `scoreKey` and therefore sort last, which is
 *              exactly PLAN §3's "scored first, the rest one click away".
 */
type ListMode =
  | { kind: "search"; text: string; stage?: LeadStage; approval?: LeadApproval }
  | { kind: "score"; score: LeadScore }
  | { kind: "approval"; approval: LeadApproval }
  | { kind: "stage"; stage: LeadStage }
  | { kind: "ranked"; lowestScoreFirst: boolean };

type ListArgs = {
  text?: string;
  stage?: LeadStage;
  approval?: LeadApproval;
  score?: LeadScore;
  lowestScoreFirst?: boolean;
};

function modeOf(args: ListArgs): ListMode {
  const narrowed = [args.stage, args.approval, args.score].filter(
    (value) => value !== undefined,
  ).length;
  if (narrowed > 1) {
    throw invalid(
      "stage, approval and score are separate list modes — no index supports combining them",
    );
  }
  const text =
    args.text === undefined
      ? ""
      : boundedString(args.text, "text", {
          max: PROSPECT_COMPANY_NAME_MAX_LENGTH,
        }).trim();
  if (text !== "") {
    if (args.score !== undefined) {
      throw invalid(
        "company search cannot be narrowed by score — the search index filters on stage and approval only",
      );
    }
    return {
      kind: "search",
      text,
      ...(args.stage !== undefined ? { stage: args.stage } : {}),
      ...(args.approval !== undefined ? { approval: args.approval } : {}),
    };
  }
  if (args.score !== undefined) {
    return { kind: "score", score: args.score };
  }
  if (args.approval !== undefined) {
    return { kind: "approval", approval: args.approval };
  }
  if (args.stage !== undefined) {
    return { kind: "stage", stage: args.stage };
  }
  return { kind: "ranked", lowestScoreFirst: args.lowestScoreFirst === true };
}

/** The mode's range, as a query the caller pages or bounds-counts. */
function rangeOf(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  mode: ListMode,
) {
  if (mode.kind === "search") {
    return ctx.db.query("prospects").withSearchIndex("search_company_name", (q) => {
      let scoped = q.search("companyName", mode.text).eq("orgId", orgId);
      if (mode.stage !== undefined) {
        scoped = scoped.eq("stage", mode.stage);
      }
      if (mode.approval !== undefined) {
        scoped = scoped.eq("approval", mode.approval);
      }
      return scoped;
    });
  }
  if (mode.kind === "score") {
    return ctx.db
      .query("prospects")
      .withIndex("by_orgId_and_scoreKey", (q) =>
        q.eq("orgId", orgId).eq("scoreKey", mode.score),
      )
      .order("desc");
  }
  if (mode.kind === "approval") {
    return ctx.db
      .query("prospects")
      .withIndex("by_orgId_and_approval", (q) =>
        q.eq("orgId", orgId).eq("approval", mode.approval),
      )
      .order("desc");
  }
  if (mode.kind === "stage") {
    return ctx.db
      .query("prospects")
      .withIndex("by_orgId_and_stage_and_updatedAt", (q) =>
        q.eq("orgId", orgId).eq("stage", mode.stage),
      )
      .order("desc");
  }
  return ctx.db
    .query("prospects")
    .withIndex("by_orgId_and_scoreKey", (q) =>
      q.eq("orgId", orgId),
    )
    .order(mode.lowestScoreFirst ? "asc" : "desc");
}

/**
 * The Contacts table: one page of leads, the signals that found each of them,
 * and the bounded total the footer's "Showing x to y of z" reads.
 */
export const list = query({
  args: {
    orgId: v.id("orgs"),
    /** Company-name search; empty text is the ordinary list. */
    text: v.optional(v.string()),
    stage: v.optional(vLeadStage),
    approval: v.optional(vLeadApproval),
    score: v.optional(vLeadScore),
    /** Flips the default best-score-first order. */
    lowestScoreFirst: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: vLeadPage,
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const mode = modeOf(args);
    const result = await rangeOf(ctx, args.orgId, mode).paginate({
      numItems: boundedLimit(args.limit),
      cursor: args.cursor ?? null,
    });
    const counted = await rangeOf(ctx, args.orgId, mode).take(
      CONTACTS_TOTAL_BOUND + 1,
    );
    const titles = await signalTitles(ctx, args.orgId);
    return {
      ...paged(result, result.page.map((lead) => toLeadRow(lead, titles))),
      total: {
        count: Math.min(counted.length, CONTACTS_TOTAL_BOUND),
        hasMore: counted.length > CONTACTS_TOTAL_BOUND,
      },
    };
  },
});

/**
 * The lead drawer (`/contacts?lead=…`): what research learned, the evidence
 * behind it, the signals that found the person and the history that produced
 * the row. The thread itself is `inbox.conversations.listForProspect` — the
 * drawer asks the domain that owns conversations rather than copying it.
 *
 * A row in another org is NOT_FOUND, never FORBIDDEN.
 */
export const getDetail = query({
  args: {
    orgId: v.id("orgs"),
    prospectId: v.id("prospects"),
  },
  returns: v.object({
    lead: vLeadDetail,
    /** Personalisation hooks, as the observations research stored. */
    evidence: v.array(vEvidenceDoc),
    events: v.array(vLeadEventDoc),
  }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const lead: Doc<"prospects"> | null = await ctx.db.get(
      "prospects",
      args.prospectId,
    );
    if (lead === null || lead.orgId !== args.orgId) {
      throw domainError("NOT_FOUND", "prospect not found");
    }
    const titles = await signalTitles(ctx, args.orgId);
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
    return { lead: toLeadDetail(lead, titles), evidence, events };
  },
});
