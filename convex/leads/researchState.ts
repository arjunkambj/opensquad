/**
 * What research WRITES on the lead: the claim, the result, and the retry
 * ladder (PLAN §9.1 "Retries", §9.2 step 3).
 *
 * The step that fetches and scores is `leads/research.ts`; every change it
 * makes to the row goes through one of the mutations here, so the lead's
 * state machine has a single set of writers and the sweep can reuse them.
 *
 * The ladder is written on the LEAD, not on the run: `lastError { code, at,
 * attempts }` plus `nextActionAt` out 5 min, then 30 min, then 4 h
 * (`lib/limits.ts`), and the attempt with no rung left parks the lead in
 * `needs_attention` with a reason code the client maps to copy. The attempts
 * are counted per STEP (`prospects.stepAttempts.research`), because PLAN §9.1
 * gives each step its own three tries. Convex does not re-run a failed
 * action, so the next run — or the recovery sweep — is the retry.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { dailyPeriodKey } from "../billing/model";
import { STEP_MAX_ATTEMPTS, STEP_RETRY_DELAYS_MS } from "../lib/limits";
import {
  advancedLeadStage,
  assertEvidenceExcerpt,
  assertEvidenceObservation,
  boundedString,
  LEAD_SCORE_MAX,
  LEAD_SCORE_REASON_MAX_LENGTH,
  leadScoreKey,
  PROSPECT_STAGE_REASON_MAX_LENGTH,
  RESEARCH_OBSERVATIONS_MAX,
  vOperationErrorCode,
} from "../lib/validators";
import type { LeadResearch, OperationErrorCode } from "../lib/validators";
import { appendLeadEvent, findLeadEventByOperationKey } from "./events";
import { v } from "convex/values";

/* ------------------------------------------------------------------ */
/* The ladder                                                          */
/*                                                                     */
/* The delays and the attempt ceiling are PLAN §9.1 policy and live in  */
/* `convex/lib/limits.ts` with every other number; the stall window is  */
/* this step's own watchdog and stays here.                             */
/* ------------------------------------------------------------------ */

/** How long a lead may sit in `researching` before the sweep calls its step
 *  lost. A Convex action cannot outlive ~10 minutes, so past this nothing is
 *  still working on it. */
export const RESEARCH_STALL_MS = 15 * 60 * 1000;

/** How a parked lead explains itself. The CODE is what the client maps to
 *  copy; this sentence is what the lead's history shows — and it does not
 *  count the attempts out loud, because the ladder's length is policy. */
const PARK_REASONS: Record<OperationErrorCode, string> = {
  rate_limited: "Research kept being throttled — try again later.",
  provider_unavailable: "Company research is unavailable right now.",
  unreadable_source: "We couldn't read this company's website.",
  not_found: "We couldn't find anything to research for this company.",
  invalid_response: "Research kept coming back unusable.",
  insufficient_credits: "Not enough credits to research this lead.",
  platform_paused: "Research is paused right now.",
  timeout: "Research kept timing out.",
  unknown: "Research failed every time we tried.",
};

/* ------------------------------------------------------------------ */
/* Claiming, applying, failing                                         */
/* ------------------------------------------------------------------ */

/**
 * Claim the lead for this step. The `researching` marker is also its
 * watchdog: `nextActionAt` is set a stall window out, so a step that dies
 * mid-flight shows up as an overdue lead rather than as a row nobody will
 * ever look at again.
 */
export const beginResearch = internalMutation({
  args: {
    agentId: v.id("agents"),
    leaseId: v.string(),
    prospectId: v.id("prospects"),
  },
  returns: v.object({ started: v.boolean() }),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (agent === null || agent.run?.leaseId !== args.leaseId) {
      return { started: false };
    }
    const lead = await ctx.db.get("prospects", args.prospectId);
    if (
      lead === null ||
      lead.agentId !== agent._id ||
      lead.research.status === "researching" ||
      lead.research.status === "researched"
    ) {
      return { started: false };
    }
    const now = Date.now();
    const research: LeadResearch = { status: "researching", startedAt: now };
    await ctx.db.patch("prospects", args.prospectId, {
      research,
      // Written in the same patch as `research`, never alone (PLAN §7).
      scoreKey: leadScoreKey(research),
      nextActionAt: now + RESEARCH_STALL_MS,
      updatedAt: now,
    });
    return { started: true };
  },
});

/**
 * Store what research learned and move the lead to `researched`.
 *
 * The multi-signal boost is applied HERE, in plain code, from the lead's own
 * `strategyIds`: PLAN §3 gives a person two signals found a higher score, and
 * deriving it from the stored row rather than asking the model for it keeps
 * it explainable and impossible to invent.
 *
 * The run lease is re-checked, like every other write in the loop — but what
 * a lost lease decides here is narrower than elsewhere, because this result
 * has already been PAID for (the page, then the generation). So:
 *   holding the lease — write, count the day's research, hand the run back;
 *   lost or manual   — write anyway, unless a newer step has already scored
 *                      this lead, in which case that answer is the current
 *                      one and this older one is dropped rather than
 *                      overwriting it; the run is not touched either way.
 */
export const applyResearch = internalMutation({
  args: {
    agentId: v.id("agents"),
    leaseId: v.string(),
    prospectId: v.id("prospects"),
    revision: v.number(),
    attempt: v.number(),
    aiScore: v.union(v.literal(1), v.literal(2), v.literal(3)),
    aiScoreReason: v.string(),
    summary: v.string(),
    hooks: v.array(v.string()),
    /** The page the hooks came from; absent when none could be read. */
    sourceUrl: v.optional(v.string()),
    excerpt: v.optional(v.string()),
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get("prospects", args.prospectId);
    if (lead === null || lead.agentId !== args.agentId) {
      await continueRun(ctx, args.agentId, args.leaseId);
      return { applied: false };
    }
    const agent = await ctx.db.get("agents", args.agentId);
    // The same lease check `beginResearch` and `continueRun` make. A manual
    // step passes a lease no run holds, which is exactly the "not under a
    // run" case below.
    const underLease = agent !== null && agent.run?.leaseId === args.leaseId;
    if (!underLease && lead.research.status === "researched") {
      return { applied: false };
    }
    const operationKey = `lead:${args.prospectId}:research:r${args.revision}:a${args.attempt}`;
    const prior = await findLeadEventByOperationKey(
      ctx,
      lead.orgId,
      operationKey,
    );
    if (prior !== null) {
      // This exact attempt was already applied; a replay writes nothing.
      await continueRun(ctx, args.agentId, args.leaseId);
      return { applied: true };
    }

    const signalCount =
      lead.origin.kind === "sourced" ? lead.origin.strategyIds.length : 1;
    const aiScore = boostedScore(args.aiScore, signalCount);
    const aiScoreReason = boundedString(
      aiScore === args.aiScore
        ? args.aiScoreReason
        : `${args.aiScoreReason} Found by ${signalCount} of the agent's signals.`,
      "aiScoreReason",
      { min: 1, max: LEAD_SCORE_REASON_MAX_LENGTH },
    );
    const now = Date.now();
    const research: LeadResearch = {
      status: "researched",
      aiScore,
      aiScoreReason,
      summary: args.summary,
      researchedAt: now,
    };
    const stage = advancedLeadStage(lead.stage, "researched");
    await ctx.db.patch("prospects", args.prospectId, {
      research,
      scoreKey: leadScoreKey(research),
      stage,
      stageReason: boundedString(
        "Researched and scored by the agent",
        "stageReason",
        { min: 1, max: PROSPECT_STAGE_REASON_MAX_LENGTH },
      ),
      nextActionAt: undefined,
      lastError: undefined,
      // The research ladder is spent: this lead is scored. An outreach ladder
      // it may already have is none of research's business.
      ...(lead.stepAttempts?.research === undefined
        ? {}
        : { stepAttempts: { ...lead.stepAttempts, research: undefined } }),
      updatedAt: now,
    });
    if (underLease && agent !== null) {
      await countResearchedToday(ctx, agent, now);
    }

    // Evidence is only ever synthesized from OUR OWN retrieval: no page, no
    // source to cite, so no rows (`leads/evidence.ts`).
    if (args.sourceUrl !== undefined && args.excerpt !== undefined) {
      for (const hook of args.hooks.slice(0, RESEARCH_OBSERVATIONS_MAX)) {
        await ctx.db.insert("evidence", {
          orgId: lead.orgId,
          prospectId: lead._id,
          sourceUrl: args.sourceUrl,
          retrievedAt: now,
          excerpt: assertEvidenceExcerpt(args.excerpt),
          observation: assertEvidenceObservation("Personalisation hook", hook),
          confidence: "supported",
          createdAt: now,
        });
      }
    }

    await appendLeadEvent(ctx, {
      orgId: lead.orgId,
      prospectId: lead._id,
      kind: "research_applied",
      summary: `Researched and scored ${aiScore} of ${LEAD_SCORE_MAX}`,
      operationKey,
      details: { aiScore },
      ...(stage !== lead.stage ? { fromStage: lead.stage, toStage: stage } : {}),
    });
    await continueRun(ctx, args.agentId, args.leaseId);
    return { applied: true };
  },
});

/**
 * One step-level failure: move the lead out along the ladder, or park it.
 *
 * `research` records the failure too, so the lead drawer can say research
 * failed without reading a stage; `stage` only moves once the ladder is
 * spent, because a lead waiting for its second attempt is not something the
 * user has to act on.
 */
export const failResearch = internalMutation({
  args: {
    agentId: v.id("agents"),
    leaseId: v.string(),
    prospectId: v.id("prospects"),
    code: vOperationErrorCode,
  },
  returns: v.object({ attempts: v.number(), parked: v.boolean() }),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get("prospects", args.prospectId);
    if (lead === null || lead.agentId !== args.agentId) {
      await continueRun(ctx, args.agentId, args.leaseId);
      return { attempts: 0, parked: false };
    }
    const outcome = await recordStepFailure(ctx, lead, args.code);
    await continueRun(ctx, args.agentId, args.leaseId);
    return outcome;
  },
});

/**
 * Put a claimed lead back WITHOUT burning an attempt.
 *
 * Used when the step was stopped for a reason that has nothing to do with the
 * lead — out of credits, the kill switch, a spent budget. PLAN §9.1: a step
 * that never began is not charged, and it is not counted against a ladder
 * that ends in `needs_attention` either.
 */
export const releaseResearch = internalMutation({
  args: { prospectId: v.id("prospects") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get("prospects", args.prospectId);
    if (lead === null || lead.research.status !== "researching") {
      return null;
    }
    const research: LeadResearch =
      lead.lastError === undefined
        ? { status: "not_researched" }
        : { status: "failed", lastError: lead.lastError };
    await ctx.db.patch("prospects", args.prospectId, {
      research,
      scoreKey: leadScoreKey(research),
      nextActionAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * The recovery sweep's door: a lead still `researching` past its stall window
 * lost its action. That IS a failed attempt — an action that died without
 * writing is exactly what the ladder exists for — so it burns one and comes
 * back due, or parks.
 */
export const recoverStalledResearch = internalMutation({
  args: { prospectId: v.id("prospects") },
  returns: v.object({ recovered: v.boolean() }),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get("prospects", args.prospectId);
    if (lead === null || lead.research.status !== "researching") {
      return { recovered: false };
    }
    await recordStepFailure(ctx, lead, "timeout");
    return { recovered: true };
  },
});

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

/** The ladder, applied to one lead. Shared by the step and the sweep. */
async function recordStepFailure(
  ctx: MutationCtx,
  lead: Doc<"prospects">,
  code: OperationErrorCode,
): Promise<{ attempts: number; parked: boolean }> {
  const now = Date.now();
  // RESEARCH's own attempts (PLAN §9.1 counts step-level ones): a lead whose
  // outreach write failed twice has a full research ladder, and the other way
  // round. `lastError` still carries the count for the drawer to print.
  const attempts = (lead.stepAttempts?.research ?? 0) + 1;
  const lastError = { code, at: now, attempts };
  const research: LeadResearch = { status: "failed", lastError };
  const delay = STEP_RETRY_DELAYS_MS[attempts - 1];
  const parked = attempts >= STEP_MAX_ATTEMPTS || delay === undefined;
  await ctx.db.patch("prospects", lead._id, {
    research,
    scoreKey: leadScoreKey(research),
    lastError,
    stepAttempts: { ...lead.stepAttempts, research: attempts },
    updatedAt: now,
    ...(parked
      ? {
          // Not `advancedLeadStage`: parking is not progress, and it is the
          // one transition that deliberately leaves the pipeline.
          stage: "needs_attention" as const,
          stageReason: PARK_REASONS[code],
          nextActionAt: undefined,
        }
      : { nextActionAt: now + delay }),
  });
  if (parked) {
    await appendLeadEvent(ctx, {
      orgId: lead.orgId,
      prospectId: lead._id,
      kind: "stage_changed",
      summary: PARK_REASONS[code],
      operationKey: `lead:${lead._id}:needs-attention:${code}:${attempts}`,
      fromStage: lead.stage,
      toStage: "needs_attention",
    });
  }
  return { attempts, parked };
}

/**
 * One more lead researched by the RUN today (`agents.researchDay`).
 *
 * The planner reads this against `dailyResearchCap` instead of the day-keyed
 * page allowance, which the owner's own website re-analysis also spends. Only
 * research the run itself drove is counted: a lead a person paid to research
 * by hand is their choice, not the agent's budget.
 */
async function countResearchedToday(
  ctx: MutationCtx,
  agent: Doc<"agents">,
  now: number,
): Promise<void> {
  const org = await ctx.db.get("orgs", agent.orgId);
  if (org === null) {
    return;
  }
  const periodKey = dailyPeriodKey(org, now);
  const count =
    agent.researchDay?.periodKey === periodKey ? agent.researchDay.count + 1 : 1;
  await ctx.db.patch("agents", agent._id, {
    researchDay: { periodKey, count },
    updatedAt: now,
  });
}

/** Hand the run back to the planner, if this step still holds the lease. */
async function continueRun(
  ctx: MutationCtx,
  agentId: Id<"agents">,
  leaseId: string,
): Promise<void> {
  const agent = await ctx.db.get("agents", agentId);
  if (agent === null || agent.run?.leaseId !== leaseId) {
    return;
  }
  await ctx.scheduler.runAfter(0, internal.agents.run.advanceRun, {
    agentId,
    leaseId,
  });
}

/** The multi-signal boost, capped at the top of the flame scale. */
function boostedScore(score: 1 | 2 | 3, signalCount: number): 1 | 2 | 3 {
  if (signalCount < 2 || score === 3) {
    return score;
  }
  return score === 1 ? 2 : 3;
}
