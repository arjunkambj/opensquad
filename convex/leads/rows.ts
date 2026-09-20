/**
 * What the Contacts screen is allowed to see of a lead.
 *
 * The stored document is NOT the payload: `origin.sourceLeadId` is the
 * lead-data provider's own row id, and PLAN §4's white-label rule keeps it —
 * like every provider name — server-side. So the table row and the drawer
 * detail are projections declared here, once, and every query in this domain
 * returns one of them rather than `vProspectDoc`.
 *
 * The row is also deliberately LEAN: the research summary and score reason are
 * paragraphs, and a 50-row page does not need fifty of them. The row carries
 * the score and the research STATUS; the drawer carries the prose.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  vApprovalActor,
  vLeadApproval,
  vLeadCompany,
  vLeadEmailStatus,
  vLeadLocation,
  vLeadResearch,
  vLeadStage,
  vOperationError,
  vOperationErrorCode,
} from "../lib/validators";
import { v } from "convex/values";

/**
 * How far the table's "Showing x to y of z" counts before it says "z+".
 * Convex has no count API, so a total is a bounded read: a screen that renders
 * "200+" is telling the truth, and one that renders a silently truncated 200
 * is not.
 *
 * Belongs in `convex/lib/limits.ts` with the other bounds; local only because
 * that file is integrator-only (EXECUTION §0).
 */
export const CONTACTS_TOTAL_BOUND = 200;

/** Strategies one org can hold — PLAN §3 gives an agent 3–5 plus a
 *  keyword one, so this is a guard rather than a page size. */
const STRATEGY_SCAN_MAX = 50;

/** The signal (the user's own saved search) a lead was found by. */
export const vLeadSignal = v.object({
  strategyId: v.id("strategies"),
  title: v.string(),
});

export const vLeadScore = v.union(v.literal(1), v.literal(2), v.literal(3));

/**
 * A lead's research state without its prose — see the file header. A union
 * rather than a status plus an optional score, so "researched with no score"
 * is not a state the table has to render something for: a score exists
 * exactly when the lead is researched (PLAN §7).
 */
export const vLeadRowResearch = v.union(
  v.object({ status: v.literal("researched"), score: vLeadScore }),
  v.object({ status: v.literal("not_researched") }),
  v.object({ status: v.literal("researching") }),
  v.object({ status: v.literal("failed") }),
);

export const vLeadRow = v.object({
  _id: v.id("prospects"),
  /** The agent that found this lead — the association the Inbox binds a
   *  held thread to, so the two can never name different agents. */
  agentId: v.id("agents"),
  createdAt: v.number(),
  updatedAt: v.number(),
  firstName: v.optional(v.string()),
  /** Masked until the reveal is paid for — shown exactly as stored. */
  lastName: v.optional(v.string()),
  jobTitle: v.optional(v.string()),
  companyName: v.optional(v.string()),
  /** The person's public profile link; the row's only outbound link. */
  linkedinUrl: v.optional(v.string()),
  research: vLeadRowResearch,
  stage: vLeadStage,
  stageReason: v.optional(v.string()),
  approval: vLeadApproval,
  approvedBy: v.optional(vApprovalActor),
  emailStatus: vLeadEmailStatus,
  email: v.optional(v.string()),
  /** Every signal that found this person; the cell shows the first and
   *  "+n signals" for the rest (PLAN §3). */
  signals: v.array(vLeadSignal),
  /** Why the last step failed — the code the client maps to copy. */
  lastErrorCode: v.optional(vOperationErrorCode),
});

export type LeadRow = typeof vLeadRow.type;

export const vLeadDetail = v.object({
  ...vLeadRow.fields,
  /** The full research variant: summary, score reason, or the failure. */
  research: vLeadResearch,
  jobFunction: v.optional(v.string()),
  jobLevel: v.optional(v.string()),
  headline: v.optional(v.string()),
  location: v.optional(vLeadLocation),
  skills: v.optional(v.array(v.string())),
  canonicalDomain: v.optional(v.string()),
  company: v.optional(vLeadCompany),
  lastContactedAt: v.optional(v.number()),
  lastReplyAt: v.optional(v.number()),
  followUpsSent: v.number(),
  lastError: v.optional(vOperationError),
});

/** The org's signals by id, read once per query rather than per row. */
export async function signalTitles(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
): Promise<Map<string, string>> {
  const strategies = await ctx.db
    .query("strategies")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(STRATEGY_SCAN_MAX);
  return new Map(strategies.map((strategy) => [strategy._id, strategy.title]));
}

/**
 * One table row. A strategy the lead names but the org no longer holds
 * is dropped rather than rendered as an id — a signal with no title is not a
 * signal the user can act on.
 */
export function toLeadRow(
  lead: Doc<"prospects">,
  titles: Map<string, string>,
): LeadRow {
  const signals =
    lead.origin.kind === "sourced"
      ? lead.origin.strategyIds.flatMap((strategyId) => {
          const title = titles.get(strategyId);
          return title === undefined ? [] : [{ strategyId, title }];
        })
      : [];
  return {
    _id: lead._id,
    agentId: lead.agentId,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    ...optional("firstName", lead.firstName),
    ...optional("lastName", lead.lastName),
    ...optional("jobTitle", lead.jobTitle),
    ...optional("companyName", lead.companyName),
    ...optional("linkedinUrl", lead.linkedinUrl),
    research:
      lead.research.status === "researched"
        ? { status: "researched" as const, score: lead.research.aiScore }
        : { status: lead.research.status },
    stage: lead.stage,
    ...optional("stageReason", lead.stageReason),
    approval: lead.approval,
    ...(lead.approvedBy !== undefined ? { approvedBy: lead.approvedBy } : {}),
    emailStatus: lead.emailStatus,
    ...optional("email", lead.email),
    signals,
    ...(lead.lastError !== undefined
      ? { lastErrorCode: lead.lastError.code }
      : {}),
  };
}

/** The drawer's lead: the row plus the prose and the facts behind it. */
export function toLeadDetail(
  lead: Doc<"prospects">,
  titles: Map<string, string>,
): typeof vLeadDetail.type {
  return {
    ...toLeadRow(lead, titles),
    research: lead.research,
    ...optional("jobFunction", lead.jobFunction),
    ...optional("jobLevel", lead.jobLevel),
    ...optional("headline", lead.headline),
    ...(lead.location !== undefined ? { location: lead.location } : {}),
    ...(lead.skills !== undefined ? { skills: lead.skills } : {}),
    ...optional("canonicalDomain", lead.canonicalDomain),
    ...(lead.company !== undefined ? { company: lead.company } : {}),
    ...(lead.lastContactedAt !== undefined
      ? { lastContactedAt: lead.lastContactedAt }
      : {}),
    ...(lead.lastReplyAt !== undefined ? { lastReplyAt: lead.lastReplyAt } : {}),
    followUpsSent: lead.followUpsSent,
    ...(lead.lastError !== undefined ? { lastError: lead.lastError } : {}),
  };
}

function optional<K extends string>(
  key: K,
  value: string | undefined,
): Record<K, string> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}
