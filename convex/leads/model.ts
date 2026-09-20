/**
 * Leads — the person-level lead the agent works (`prospects` is the backend
 * table; the UI says Contacts). PLAN §7.
 *
 * This domain owns the lead record and everything written alongside it: its
 * stage machine, approval, notes, research evidence and append-only event
 * history. It owns neither the agent that sources leads nor the outreach
 * that contacts them — nothing here spends money or schedules work.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { SourcedLead } from "../integrations/enrich/rows";
import {
  assertEpochMs,
  boundedLimit,
  domainError,
  EPOCH_MS_MIN,
  invalid,
  leadSourceKey,
} from "../lib/validators";
import type {
  AgentIcp,
  LeadApproval,
  LeadOrigin,
  LeadStage,
} from "../lib/validators";
import { preRankLead } from "./preRank";
import type { CompanySizeRange } from "./preRank";
import { prospectFields } from "../schema";
import { v } from "convex/values";

export const vProspectDoc = v.object({
  _id: v.id("prospects"),
  _creationTime: v.number(),
  ...prospectFields,
});

export const vListPage = v.object({
  items: v.array(vProspectDoc),
  cursor: v.union(v.string(), v.null()),
  hasMore: v.boolean(),
});

type ListPageArgs = {
  orgId: Id<"orgs">;
  stage?: LeadStage;
  approval?: LeadApproval;
  dueRange?: { from?: number; to?: number };
  unscheduled?: boolean;
  topScoreFirst?: boolean;
  cursor?: string | null;
  limit?: number;
};

/**
 * Every list mode is an exact index range — never a post-filtered page. The
 * modes and the index behind each:
 *
 *   due (`dueRange`): soonest-due first on `by_orgId_and_nextActionAt`.
 *   A lead with no due time cannot satisfy a range bound, so this mode never
 *   hides one behind a page that looks filtered — it appears in the default
 *   and `unscheduled` modes instead.
 *
 *   unscheduled: the complementary slice — leads with NO `nextActionAt`.
 *
 *   score (`topScoreFirst`): best leads first on
 *   `by_orgId_and_scoreKey`. `scoreKey` is the denormalised mirror of
 *   `research.aiScore`; unresearched leads have none and sort below, which is
 *   exactly the "scored first, the rest one click away" order of PLAN §3.
 *
 *   stage / approval: the Contacts filters, each on its own index.
 *
 *   default: the whole org by next-action time, most recent first.
 *
 * Unsupported combinations REFUSE rather than silently post-filter: the
 * schema declares an index per enabled combination, and a filter pair with no
 * index is added deliberately or not at all.
 */
export async function listPage(
  ctx: QueryCtx,
  args: ListPageArgs,
): Promise<typeof vListPage.type> {
  const paginate = {
    numItems: boundedLimit(args.limit),
    cursor: args.cursor ?? null,
  };
  const exclusive = [
    args.stage !== undefined,
    args.approval !== undefined,
    args.dueRange !== undefined,
    args.unscheduled === true,
    args.topScoreFirst === true,
  ].filter(Boolean).length;
  if (exclusive > 1) {
    throw invalid(
      "stage, approval, dueRange, unscheduled and topScoreFirst are separate list modes — no index supports combining them",
    );
  }

  if (args.unscheduled === true) {
    // `undefined` sorts below every bound on this index, and every stored
    // `nextActionAt` is ≥ EPOCH_MS_MIN, so `lt(EPOCH_MS_MIN)` names exactly
    // the rows with no due time — the unscheduled state as a first-class
    // slice rather than a sentinel date the reader has to know about.
    const result = await ctx.db
      .query("prospects")
      .withIndex("by_orgId_and_nextActionAt", (q) =>
        q.eq("orgId", args.orgId).lt("nextActionAt", EPOCH_MS_MIN),
      )
      .order("desc")
      .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  if (args.dueRange !== undefined) {
    const from =
      args.dueRange.from === undefined
        ? undefined
        : assertEpochMs(args.dueRange.from, "dueRange.from");
    const to =
      args.dueRange.to === undefined
        ? undefined
        : assertEpochMs(args.dueRange.to, "dueRange.to");
    if (from !== undefined && to !== undefined && from > to) {
      throw invalid("dueRange.from must not be after dueRange.to");
    }
    // A lead with NO `nextActionAt` stores `undefined` in the index, which
    // sorts below every bound — `lte(to)` alone would return undated leads as
    // "due". The lower bound is therefore always present: the caller's
    // `from`, or 0 meaning "has a due date at all".
    const lower = from ?? 0;
    const result = await ctx.db
      .query("prospects")
      .withIndex("by_orgId_and_nextActionAt", (q) => {
        const scoped = q
          .eq("orgId", args.orgId)
          .gte("nextActionAt", lower);
        return to === undefined ? scoped : scoped.lte("nextActionAt", to);
      })
      .order("asc")
      .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  if (args.topScoreFirst === true) {
    const result = await ctx.db
      .query("prospects")
      .withIndex("by_orgId_and_scoreKey", (q) =>
        q.eq("orgId", args.orgId),
      )
      .order("desc")
      .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  const approval = args.approval;
  if (approval !== undefined) {
    const result = await ctx.db
      .query("prospects")
      .withIndex("by_orgId_and_approval", (q) =>
        q.eq("orgId", args.orgId).eq("approval", approval),
      )
      .order("desc")
      .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  const stage = args.stage;
  const result =
    stage !== undefined
      ? await ctx.db
          .query("prospects")
          .withIndex("by_orgId_and_stage_and_updatedAt", (q) =>
            q.eq("orgId", args.orgId).eq("stage", stage),
          )
          .order("desc")
          .paginate(paginate)
      : await ctx.db
          .query("prospects")
          .withIndex("by_orgId_and_nextActionAt", (q) =>
            q.eq("orgId", args.orgId),
          )
          .order("desc")
          .paginate(paginate);
  return {
    items: result.page,
    cursor: result.isDone ? null : result.continueCursor,
    hasMore: !result.isDone,
  };
}

/**
 * Load a lead for a write. A missing row and a row in another org are
 * the same NOT_FOUND — the read must never reveal another org's data.
 */
export async function loadProspectForWrite(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  prospectId: Id<"prospects">,
): Promise<Doc<"prospects">> {
  const prospect = await ctx.db.get("prospects", prospectId);
  if (prospect === null || prospect.orgId !== orgId) {
    throw domainError("NOT_FOUND", "prospect not found");
  }
  return prospect;
}

/* ------------------------------------------------------------------ */
/* Sourcing — where a lead enters the table                            */
/* ------------------------------------------------------------------ */

/** What one upserted row did. `unchanged` is a page that found nobody new. */
export type UpsertOutcome = "inserted" | "merged" | "unchanged";

export type UpsertSourcedLeadArgs = {
  orgId: Id<"orgs">;
  agentId: Id<"agents">;
  /** The strategy whose page this row came back on. */
  strategyId: Id<"strategies">;
  lead: SourcedLead;
  icp: AgentIcp;
  sizeRange: CompanySizeRange;
  now: number;
};

/**
 * THE sourcing write: insert a found person, or merge a second signal into
 * the row that already holds them (PLAN §3 "A lead matched by more than one
 * strategy keeps all of them").
 *
 * Dedupe is on the provider's row id WITHIN THE AGENT, read through
 * `by_agentId_and_sourceLeadKey` in the same transaction as the insert —
 * Convex has no unique index, so that read IS the constraint, exactly as the
 * one-agent-per-org and one-inbox-per-org rules are enforced.
 *
 * A merge only ever ADDS: it appends the strategy, re-ranks with the higher
 * signal count and keeps the better `preRank`. It never rewrites the person's
 * facts, because a later page of a different strategy is not newer knowledge
 * — and it never touches `research`, `stage` or `approval`, so finding an
 * already-contacted lead again cannot pull them back down the pipeline.
 */
export async function upsertSourcedLead(
  ctx: MutationCtx,
  args: UpsertSourcedLeadArgs,
): Promise<UpsertOutcome> {
  const existing = await ctx.db
    .query("prospects")
    .withIndex("by_agentId_and_sourceLeadKey", (q) =>
      q.eq("agentId", args.agentId).eq("sourceLeadKey", args.lead.sourceLeadId),
    )
    .unique();

  // The mail domain is a usable research target when the company row carried
  // no site of its own — the same host, stated by a different field.
  const canonicalDomain =
    args.lead.canonicalDomain ?? args.lead.emailDomain;

  if (existing === null) {
    const origin: LeadOrigin = {
      kind: "sourced",
      sourceLeadId: args.lead.sourceLeadId,
      strategyIds: [args.strategyId],
    };
    const preRank = preRankLead({
      lead: {
        ...(args.lead.jobTitle !== undefined
          ? { jobTitle: args.lead.jobTitle }
          : {}),
        ...(args.lead.jobLevel !== undefined
          ? { jobLevel: args.lead.jobLevel }
          : {}),
        ...(canonicalDomain !== undefined ? { canonicalDomain } : {}),
        ...(args.lead.company?.employeeCount !== undefined
          ? { employeeCount: args.lead.company.employeeCount }
          : {}),
      },
      icp: args.icp,
      sizeRange: args.sizeRange,
      signalCount: 1,
    });
    await ctx.db.insert("prospects", {
      orgId: args.orgId,
      agentId: args.agentId,
      origin,
      // Written in the SAME insert as `origin`, never alone (PLAN §7).
      sourceLeadKey: leadSourceKey(origin),
      research: { status: "not_researched" },
      stage: "found",
      approval: "pending",
      // A sourced row carries no address at all until someone pays for one.
      emailStatus: "locked",
      preRank,
      followUpsSent: 0,
      createdAt: args.now,
      updatedAt: args.now,
      ...(args.lead.firstName !== undefined
        ? { firstName: args.lead.firstName }
        : {}),
      ...(args.lead.lastName !== undefined
        ? { lastName: args.lead.lastName }
        : {}),
      ...(args.lead.jobTitle !== undefined
        ? { jobTitle: args.lead.jobTitle }
        : {}),
      ...(args.lead.jobFunction !== undefined
        ? { jobFunction: args.lead.jobFunction }
        : {}),
      ...(args.lead.jobLevel !== undefined
        ? { jobLevel: args.lead.jobLevel }
        : {}),
      ...(args.lead.headline !== undefined
        ? { headline: args.lead.headline }
        : {}),
      ...(args.lead.linkedinUrl !== undefined
        ? { linkedinUrl: args.lead.linkedinUrl }
        : {}),
      ...(args.lead.location !== undefined
        ? { location: args.lead.location }
        : {}),
      ...(args.lead.skills !== undefined ? { skills: args.lead.skills } : {}),
      ...(args.lead.companyName !== undefined
        ? { companyName: args.lead.companyName }
        : {}),
      ...(canonicalDomain !== undefined ? { canonicalDomain } : {}),
      ...(args.lead.company !== undefined
        ? { company: args.lead.company }
        : {}),
    });
    return "inserted";
  }

  if (
    existing.origin.kind !== "sourced" ||
    existing.origin.strategyIds.includes(args.strategyId)
  ) {
    return "unchanged";
  }

  const origin: LeadOrigin = {
    ...existing.origin,
    strategyIds: [...existing.origin.strategyIds, args.strategyId],
  };
  const preRank = preRankLead({
    lead: {
      ...(existing.jobTitle !== undefined ? { jobTitle: existing.jobTitle } : {}),
      ...(existing.jobLevel !== undefined ? { jobLevel: existing.jobLevel } : {}),
      ...(existing.canonicalDomain !== undefined
        ? { canonicalDomain: existing.canonicalDomain }
        : {}),
      ...(existing.company?.employeeCount !== undefined
        ? { employeeCount: existing.company.employeeCount }
        : {}),
    },
    icp: args.icp,
    sizeRange: args.sizeRange,
    signalCount: origin.strategyIds.length,
  });
  await ctx.db.patch("prospects", existing._id, {
    origin,
    sourceLeadKey: leadSourceKey(origin),
    preRank: Math.max(existing.preRank, preRank),
    updatedAt: args.now,
  });
  return "merged";
}

/** Re-read a patched lead; absence inside the writing transaction is a defect. */
export async function reread(
  ctx: MutationCtx,
  prospectId: Id<"prospects">,
): Promise<Doc<"prospects">> {
  const row = await ctx.db.get("prospects", prospectId);
  if (row === null) {
    throw domainError("NOT_FOUND", "prospect not found after write");
  }
  return row;
}
