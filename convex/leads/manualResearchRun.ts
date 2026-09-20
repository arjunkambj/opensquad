/**
 * The manual research step: read the company's page, score the fit, write it.
 *
 * The agent's own step (`leads/research.ts`) runs INSIDE a run lease and hands
 * the lease back to the planner between steps, so it cannot be called for a
 * lead the user picked. This is the same work without the lease, and it buys
 * the page under the SAME operation key, so a page the agent already paid for
 * is replayed rather than scraped again. The result goes through
 * `leads/researchState.ts` — still the only writer of `prospects.research`.
 *
 * The model call is keyed on the claim instant instead of an attempt number:
 * a completed generation is billed whatever it answered (PLAN §6), so every
 * new attempt has to be a new key rather than a replay of a settled one.
 */
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import {
  boundResearchResult,
  RESEARCH_LEAD_SYSTEM,
  RESEARCH_MAX_OUTPUT_TOKENS,
  researchLeadInput,
  vResearchLeadResult,
} from "../ai/researchLead";
import { runStructured } from "../ai/run";
import type { RefundReason } from "../billing/paidCall";
import { scrapeSite } from "../integrations/firecrawl";
import { EVIDENCE_EXCERPT_MAX_LENGTH } from "../lib/validators";
import type { OperationErrorCode } from "../lib/validators";
import { v } from "convex/values";

/**
 * The lease a manual step passes to the shared writers. It matches no live
 * run, which is exactly the point: those writers hand the run back to the
 * planner only when the lease still holds, so a manual step writes the lead
 * and disturbs no run.
 */
const NO_LEASE = "manual";

/** Refusals about the ACCOUNT, not this lead — the lead is put back without
 *  burning a rung of its retry ladder (PLAN §9.1). */
const ACCOUNT_REFUSALS: readonly RefundReason[] = [
  "kill_switch",
  "platform_capacity",
  "no_credit_grant",
  "insufficient_credits",
  "trial_limit_reached",
  "rate_limited",
  "throttled",
  "unauthorized",
];

const vManualContext = v.union(
  v.object({ status: v.literal("skip") }),
  v.object({
    status: v.literal("ready"),
    agentId: v.id("agents"),
    revision: v.number(),
    signalCount: v.number(),
    canonicalDomain: v.optional(v.string()),
    seller: v.object({
      companyName: v.string(),
      industry: v.string(),
      description: v.string(),
      keyFeatures: v.array(v.string()),
      painPoints: v.string(),
    }),
    lead: v.object({
      jobTitle: v.optional(v.string()),
      jobLevel: v.optional(v.string()),
      headline: v.optional(v.string()),
      companyName: v.optional(v.string()),
      canonicalDomain: v.optional(v.string()),
      location: v.optional(v.string()),
      companyIndustry: v.optional(v.string()),
      employeeCount: v.optional(v.number()),
    }),
  }),
);

/** Everything the step needs, read once. The agent's run lease is irrelevant
 *  here — this lead was picked by a person, not by the planner. */
export const manualResearchContext = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
  },
  returns: vManualContext,
  handler: async (ctx, args) => {
    const lead = await ctx.db.get("prospects", args.prospectId);
    if (
      lead === null ||
      lead.workspaceId !== args.workspaceId ||
      lead.research.status !== "researching"
    ) {
      return { status: "skip" as const };
    }
    const agent = await ctx.db.get("agents", lead.agentId);
    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (agent === null || profile === null) {
      // Nothing to judge fit against; onboarding writes both long before a
      // lead exists, so this is a broken workspace rather than a bad lead.
      return { status: "skip" as const };
    }
    const location = [
      lead.location?.city,
      lead.location?.state,
      lead.location?.country,
    ]
      .filter((part): part is string => part !== undefined)
      .join(", ");
    return {
      status: "ready" as const,
      agentId: agent._id,
      revision: agent.revision,
      signalCount:
        lead.origin.kind === "sourced" ? lead.origin.strategyIds.length : 1,
      ...(lead.canonicalDomain !== undefined
        ? { canonicalDomain: lead.canonicalDomain }
        : {}),
      seller: {
        companyName: profile.companyName,
        industry: profile.industry,
        description: profile.description,
        keyFeatures: profile.keyFeatures,
        painPoints: profile.painPoints,
      },
      lead: {
        ...(lead.jobTitle !== undefined ? { jobTitle: lead.jobTitle } : {}),
        ...(lead.jobLevel !== undefined ? { jobLevel: lead.jobLevel } : {}),
        ...(lead.headline !== undefined ? { headline: lead.headline } : {}),
        ...(lead.companyName !== undefined
          ? { companyName: lead.companyName }
          : {}),
        ...(lead.canonicalDomain !== undefined
          ? { canonicalDomain: lead.canonicalDomain }
          : {}),
        ...(location !== "" ? { location } : {}),
        ...(lead.company?.industry !== undefined
          ? { companyIndustry: lead.company.industry }
          : {}),
        ...(lead.company?.employeeCount !== undefined
          ? { employeeCount: lead.company.employeeCount }
          : {}),
      },
    };
  },
});

/** ONE lead: read the page (once, ever, per revision), score it, write it. */
export const runManualResearch = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    /** The claim instant; the model call's key, so a retry is never a
     *  replay of a settled generation. */
    claimedAt: v.number(),
  },
  returns: v.object({ outcome: v.string() }),
  handler: async (ctx, args): Promise<{ outcome: string }> => {
    const context = await ctx.runQuery(
      internal.leads.manualResearchRun.manualResearchContext,
      { workspaceId: args.workspaceId, prospectId: args.prospectId },
    );
    if (context.status === "skip") {
      await release(ctx, args.prospectId);
      return { outcome: "skipped" };
    }

    let pageMarkdown: string | undefined;
    let sourceUrl: string | undefined;
    if (context.canonicalDomain !== undefined) {
      const site = await scrapeSite(ctx, {
        workspaceId: args.workspaceId,
        url: `https://${context.canonicalDomain}`,
        pages: 1,
        action: "research_lead",
        // The agent's own key for this lead and revision: a page already
        // bought is replayed, never scraped a second time.
        operationKey: `${context.agentId}:${args.prospectId}:research:r${context.revision}`,
      });
      if (site.kind === "scraped") {
        pageMarkdown = site.site.combinedMarkdown;
        sourceUrl = site.site.pages[0]?.url;
      } else if (site.kind === "refused") {
        if (ACCOUNT_REFUSALS.includes(site.reason)) {
          await release(ctx, args.prospectId);
          return { outcome: `refused:${site.reason}` };
        }
        await fail(ctx, context.agentId, args.prospectId, "unreadable_source");
        return { outcome: "failed" };
      } else if (site.kind === "uncertain") {
        await fail(ctx, context.agentId, args.prospectId, "timeout");
        return { outcome: "uncertain" };
      }
      // `empty` and `unavailable` leave us where a lead with no domain
      // starts: no page, so the preview alone is what gets scored.
    }

    const scored = await runStructured(ctx, {
      workspaceId: args.workspaceId,
      action: "score_lead",
      tier: "fast",
      system: RESEARCH_LEAD_SYSTEM,
      input: researchLeadInput({
        seller: context.seller,
        lead: context.lead,
        signalCount: context.signalCount,
        ...(pageMarkdown !== undefined ? { pageMarkdown } : {}),
      }),
      result: vResearchLeadResult,
      operationKey: `${context.agentId}:${args.prospectId}:score:r${context.revision}:m${args.claimedAt}`,
      maxOutputTokens: RESEARCH_MAX_OUTPUT_TOKENS,
    });

    if (scored.kind === "refunded") {
      if (ACCOUNT_REFUSALS.includes(scored.reason)) {
        await release(ctx, args.prospectId);
        return { outcome: `refused:${scored.reason}` };
      }
      await fail(ctx, context.agentId, args.prospectId, "invalid_response");
      return { outcome: "failed" };
    }
    if (scored.kind === "uncertain") {
      await fail(ctx, context.agentId, args.prospectId, "timeout");
      return { outcome: "uncertain" };
    }
    if (scored.replayed || scored.result.status !== "object") {
      await fail(ctx, context.agentId, args.prospectId, "invalid_response");
      return { outcome: "failed" };
    }

    const result = boundResearchResult(scored.result.object);
    await ctx.runMutation(internal.leads.researchState.applyResearch, {
      agentId: context.agentId,
      leaseId: NO_LEASE,
      prospectId: args.prospectId,
      revision: context.revision,
      // The claim instant, not a rung of the ladder: the history row this
      // writes is keyed on it, so a manual retry is recorded rather than
      // mistaken for a replay of an earlier attempt.
      attempt: args.claimedAt,
      aiScore: result.aiScore,
      aiScoreReason: result.aiScoreReason,
      summary: result.summary,
      hooks: result.hooks,
      ...(sourceUrl !== undefined && pageMarkdown !== undefined
        ? {
            sourceUrl,
            excerpt: pageMarkdown.slice(0, EVIDENCE_EXCERPT_MAX_LENGTH),
          }
        : {}),
    });
    return { outcome: "researched" };
  },
});

/** One rung of the retry ladder — the same writer the agent's step uses. */
async function fail(
  ctx: ActionCtx,
  agentId: Id<"agents">,
  prospectId: Id<"prospects">,
  code: OperationErrorCode,
): Promise<void> {
  await ctx.runMutation(internal.leads.researchState.failResearch, {
    agentId,
    leaseId: NO_LEASE,
    prospectId,
    code,
  });
}

/** Un-claim without burning an attempt: nothing about the lead was wrong. */
async function release(
  ctx: ActionCtx,
  prospectId: Id<"prospects">,
): Promise<void> {
  await ctx.runMutation(internal.leads.researchState.releaseResearch, {
    prospectId,
  });
}
