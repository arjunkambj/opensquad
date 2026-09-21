/**
 * Research one lead: read the company's home page, score the fit, hand the
 * result to `leads/researchState.ts` to write (PLAN §9.2 step 3).
 *
 * One lead per step, built around one money rule: the page is bought under a
 * key that does NOT change between attempts, and the model is asked under a
 * key that DOES. A lead whose page was fetched and whose scoring then failed
 * is billed the page once, retried from the stored markdown and never
 * scraped twice (PLAN §6 "billed … even if a later step failed").
 *
 * A lead with no company domain is still researched: it is scored from the
 * preview alone, under the same zero-credit model action, with no page — and
 * therefore no page charge and no evidence rows. Refusing to look at someone
 * because their row carried no website would leave the user with rows that
 * can never be scored at all.
 *
 * Two kinds of failure, kept apart on purpose. A refusal about the ACCOUNT —
 * the kill switch, a spent budget, an empty balance — releases the lead
 * untouched and ends the run, because burning a lead's retry ladder on a
 * condition that clears by itself would park perfectly good leads. Everything
 * else is this lead's problem and goes to the ladder.
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
 * Refusals that are about the account rather than the lead. The run stops and
 * the lead stays exactly as due as it was.
 */
const RUN_STOPPING_REFUSALS: readonly RefundReason[] = [
  "kill_switch",
  "platform_capacity",
  "no_credit_grant",
  "insufficient_credits",
  "trial_limit_reached",
  "rate_limited",
  "throttled",
  "unauthorized",
];

function stopsTheRun(reason: RefundReason): boolean {
  return RUN_STOPPING_REFUSALS.includes(reason);
}

const vResearchContext = v.union(
  /** End the run: the lease moved on, or there is nothing to sell with. */
  v.object({ status: v.literal("stop") }),
  /** This lead is no longer eligible; the run continues with another. */
  v.object({ status: v.literal("skip") }),
  v.object({
    status: v.literal("ready"),
    orgId: v.id("orgs"),
    revision: v.number(),
    /** Failures so far; the attempt about to run is this plus one. */
    attempts: v.number(),
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

/** Everything the step needs, read once, under the lease it runs on. */
export const researchContext = internalQuery({
  args: {
    agentId: v.id("agents"),
    leaseId: v.string(),
    prospectId: v.id("prospects"),
  },
  returns: vResearchContext,
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (agent === null || agent.run?.leaseId !== args.leaseId) {
      return { status: "stop" as const };
    }
    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", agent.orgId))
      .unique();
    if (profile === null) {
      // Nothing to judge fit against. Onboarding writes the profile long
      // before an agent goes live, so this stops the run rather than failing
      // a lead that has done nothing wrong.
      return { status: "stop" as const };
    }
    const lead = await ctx.db.get("prospects", args.prospectId);
    if (
      lead === null ||
      lead.agentId !== agent._id ||
      lead.approval === "rejected" ||
      lead.research.status === "researched" ||
      lead.research.status === "researching"
    ) {
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
      orgId: agent.orgId,
      revision: agent.revision,
      // RESEARCH's own failures (`stepAttempts.research`), not the lead's
      // last failure whatever produced it: the number is this step's ladder
      // position and part of the key the generation is asked under.
      attempts: lead.stepAttempts?.research ?? 0,
      signalCount: lead.origin.strategyIds.length,
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
export const runResearchStep = internalAction({
  args: {
    agentId: v.id("agents"),
    leaseId: v.string(),
    prospectId: v.id("prospects"),
  },
  returns: v.object({ outcome: v.string() }),
  handler: async (ctx, args): Promise<{ outcome: string }> => {
    const context = await ctx.runQuery(internal.leads.research.researchContext, {
      agentId: args.agentId,
      leaseId: args.leaseId,
      prospectId: args.prospectId,
    });
    if (context.status === "stop") {
      await stop(ctx, args);
      return { outcome: "stopped" };
    }
    if (context.status === "skip") {
      await resume(ctx, args);
      return { outcome: "skipped" };
    }
    const claimed = await ctx.runMutation(
      internal.leads.researchState.beginResearch,
      {
        agentId: args.agentId,
        leaseId: args.leaseId,
        prospectId: args.prospectId,
      },
    );
    if (!claimed.started) {
      await resume(ctx, args);
      return { outcome: "skipped" };
    }
    const attempt = context.attempts + 1;

    let pageMarkdown: string | undefined;
    let sourceUrl: string | undefined;
    if (context.canonicalDomain !== undefined) {
      const site = await scrapeSite(ctx, {
        orgId: context.orgId,
        url: `https://${context.canonicalDomain}`,
        pages: 1,
        action: "research_lead",
        // No attempt number: a retry replays the page already paid for.
        operationKey: `${args.agentId}:${args.prospectId}:research:r${context.revision}`,
      });
      if (site.kind === "scraped") {
        pageMarkdown = site.site.combinedMarkdown;
        sourceUrl = site.site.pages[0]?.url;
      } else if (site.kind === "refused") {
        if (stopsTheRun(site.reason)) {
          await release(ctx, args);
          await stop(ctx, args);
          return { outcome: `refused:${site.reason}` };
        }
        await fail(ctx, args, "unreadable_source");
        return { outcome: "failed" };
      } else if (site.kind === "uncertain") {
        await fail(ctx, args, "timeout");
        return { outcome: "uncertain" };
      }
      // `empty` and `unavailable` leave us where a lead with no domain
      // starts: no page, so the preview alone is what gets scored.
    }

    const scored = await runStructured(ctx, {
      orgId: context.orgId,
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
      // The attempt IS part of this key: a completed generation is billed
      // whatever it answered, so a retry must be a new call, not a replay.
      operationKey: `${args.agentId}:${args.prospectId}:score:r${context.revision}:a${attempt}`,
      maxOutputTokens: RESEARCH_MAX_OUTPUT_TOKENS,
    });

    if (scored.kind === "refunded") {
      if (stopsTheRun(scored.reason)) {
        await release(ctx, args);
        await stop(ctx, args);
        return { outcome: `refused:${scored.reason}` };
      }
      await fail(ctx, args, "invalid_response");
      return { outcome: "failed" };
    }
    if (scored.kind === "uncertain") {
      await fail(ctx, args, "timeout");
      return { outcome: "uncertain" };
    }
    if (scored.replayed || scored.result.status !== "object") {
      // A replay of THIS attempt's key carries no object, and a completed
      // generation we could not parse is billed and unusable. Either way the
      // next attempt asks again under a new key.
      await fail(ctx, args, "invalid_response");
      return { outcome: "failed" };
    }

    const result = boundResearchResult(scored.result.object);
    await ctx.runMutation(internal.leads.researchState.applyResearch, {
      agentId: args.agentId,
      leaseId: args.leaseId,
      prospectId: args.prospectId,
      revision: context.revision,
      attempt,
      aiScore: result.aiScore,
      aiScoreReason: result.aiScoreReason,
      summary: result.summary,
      hooks: result.hooks,
      ...(sourceUrl !== undefined && pageMarkdown !== undefined
        ? {
            sourceUrl,
            // The span the evidence rows cite; the writer bounds it again.
            excerpt: pageMarkdown.slice(0, EVIDENCE_EXCERPT_MAX_LENGTH),
          }
        : {}),
    });
    return { outcome: "researched" };
  },
});

/* ------------------------------------------------------------------ */
/* The four ways a step ends                                           */
/* ------------------------------------------------------------------ */

type StepArgs = {
  agentId: Id<"agents">;
  leaseId: string;
  prospectId: Id<"prospects">;
};

/** Hand back to the planner: this lead is done with, the run is not. */
async function resume(ctx: ActionCtx, args: StepArgs): Promise<void> {
  await ctx.runMutation(internal.agents.run.advanceRun, {
    agentId: args.agentId,
    leaseId: args.leaseId,
  });
}

/** End the run; the planner cannot see the cap that refused this step. */
async function stop(ctx: ActionCtx, args: StepArgs): Promise<void> {
  await ctx.runMutation(internal.agents.run.endRun, {
    agentId: args.agentId,
    leaseId: args.leaseId,
  });
}

/** Un-claim the lead without counting an attempt against it. */
async function release(ctx: ActionCtx, args: StepArgs): Promise<void> {
  await ctx.runMutation(internal.leads.researchState.releaseResearch, {
    prospectId: args.prospectId,
  });
}

/** One rung of the ladder, then on with the run. */
async function fail(
  ctx: ActionCtx,
  args: StepArgs,
  code: OperationErrorCode,
): Promise<void> {
  await ctx.runMutation(internal.leads.researchState.failResearch, {
    agentId: args.agentId,
    leaseId: args.leaseId,
    prospectId: args.prospectId,
    code,
  });
}
