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
import type { MutationCtx } from "../_generated/server";
import type { SourcedLead } from "../integrations/enrich/rows";
import {
  boundedString,
  domainError,
  leadScoreKey,
  PROSPECT_STAGE_REASON_MAX_LENGTH,
} from "../lib/validators";
import type {
  AgentIcp,
  LeadOrigin,
  LeadResearch,
  LeadStage,
} from "../lib/validators";
import { appendLeadEvent } from "./events";
import { preRankLead } from "./preRank";
import type { CompanySizeRange } from "./preRank";

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

/**
 * Put a parked lead back in the queue. THE writer for that transition,
 * whichever button asked for it.
 *
 * `needs_attention` is the end of the retry ladder (PLAN §9.1): the step
 * failed its three tries and the lead now waits for a person. This is that
 * person's answer, so it clears the ladder rather than continuing it — both
 * step counters go, `lastError` goes, and the lead becomes due immediately.
 *
 * It costs NOTHING. Un-parking is not research: a lead that already has a
 * score keeps it and goes back to `researched`, and one that does not goes
 * back to `found`, where the planner picks it up and pays the ordinary
 * research price once — the same 3 credits whichever door the person used
 * (PLAN §6). No automatic transition may do this (`advancedLeadStage` does
 * not leave `needs_attention`), which is what makes the button honest.
 */
export const LEAD_RETRY_REASON = "Put back in the queue by the organization";

export async function unparkLead(
  ctx: MutationCtx,
  lead: Doc<"prospects">,
  args: { reason: string; now: number; identityKey?: string },
): Promise<LeadStage> {
  const researched = lead.research.status === "researched";
  const research: LeadResearch = researched
    ? lead.research
    : { status: "not_researched" };
  const stage: LeadStage = researched ? "researched" : "found";
  await ctx.db.patch("prospects", lead._id, {
    research,
    // Written in the same patch as `research`, never alone (PLAN §7).
    scoreKey: leadScoreKey(research),
    stage,
    stageReason: boundedString(args.reason, "stageReason", {
      min: 1,
      max: PROSPECT_STAGE_REASON_MAX_LENGTH,
    }),
    lastError: undefined,
    stepAttempts: undefined,
    nextActionAt: args.now,
    updatedAt: args.now,
  });
  await appendLeadEvent(ctx, {
    orgId: lead.orgId,
    prospectId: lead._id,
    kind: "stage_changed",
    summary: args.reason,
    operationKey: `lead:${lead._id}:retry:${args.now}`,
    ...(args.identityKey === undefined
      ? {}
      : { actor: { source: "human" as const, identityKey: args.identityKey } }),
    fromStage: lead.stage,
    toStage: stage,
  });
  return stage;
}

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
      sourceLeadKey: origin.sourceLeadId,
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

  if (existing.origin.strategyIds.includes(args.strategyId)) {
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
    sourceLeadKey: origin.sourceLeadId,
    preRank: Math.max(existing.preRank, preRank),
    updatedAt: args.now,
  });
  return "merged";
}
