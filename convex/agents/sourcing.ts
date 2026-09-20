/**
 * Sourcing — one page of one strategy, bought once and stored once
 * (PLAN §3 step 6, §9.2 steps 1–2).
 *
 * The step is deliberately small: read what this page needs, make ONE paid
 * search, write the rows and advance the strategy's cursor, hand back to the
 * run loop. Nothing loops over strategies and nothing loops over pages.
 *
 * The accounting rule this file exists to respect: a replayed search carries
 * NO rows. The page was already bought and its rows were stored by the call
 * that bought them, so a replay advances the cursor and stores nothing — and
 * that is why storing the rows and advancing `nextPage` happen in ONE
 * transaction. A refusal never advances the cursor: the page has not been
 * bought, so the next run asks for it again.
 *
 * A refused, failed or unknown search ENDS the run rather than handing back
 * to the planner, which cannot see a provider cap it did not take and would
 * schedule the identical step forever.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { MAX_SEARCH_PAGE } from "../integrations/enrich/search";
import { vSourcedLead } from "../integrations/enrich/rows";
import type { SourcedLead } from "../integrations/enrich/rows";
import { companySizeRange } from "../leads/preRank";
import { upsertSourcedLead } from "../leads/model";
import { vLeadFilters } from "../lib/validators";
import { finishRun, leasedAgent, renewRunLease } from "./run";
import { v } from "convex/values";

const vSourcingContext = v.union(
  /** End the run: the lease moved on while this step was being scheduled. */
  v.object({ status: v.literal("stop") }),
  /** The signal was switched off or deleted; the run continues elsewhere. */
  v.object({ status: v.literal("skip") }),
  v.object({
    status: v.literal("ready"),
    orgId: v.id("orgs"),
    /** The agent revision this page is planned under; part of its key. */
    revision: v.number(),
    filters: vLeadFilters,
    excludeFilters: vLeadFilters,
  }),
);

/** What the page needs, read under the lease it is running on. */
export const sourcingContext = internalQuery({
  args: {
    agentId: v.id("agents"),
    leaseId: v.string(),
    strategyId: v.id("strategies"),
  },
  returns: vSourcingContext,
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (agent === null || agent.run?.leaseId !== args.leaseId) {
      return { status: "stop" as const };
    }
    const strategy = await ctx.db.get("strategies", args.strategyId);
    if (
      strategy === null ||
      strategy.agentId !== agent._id ||
      !strategy.enabled
    ) {
      // The user turned the signal off between the plan and the step. That is
      // not a failure and it is not the end of the run.
      return { status: "skip" as const };
    }
    return {
      status: "ready" as const,
      orgId: agent.orgId,
      revision: agent.revision,
      filters: strategy.filters,
      excludeFilters: strategy.excludeFilters,
    };
  },
});

/**
 * Store one page and advance the strategy, atomically.
 *
 * `rows` is empty on a replay — the page was bought and stored before, so the
 * cursor moves and nothing is written. `exhausted` marks a strategy whose
 * results have run out, so no later run pays for a page that cannot exist.
 */
export const recordSourcedPage = internalMutation({
  args: {
    agentId: v.id("agents"),
    leaseId: v.string(),
    strategyId: v.id("strategies"),
    page: v.number(),
    rows: v.array(vSourcedLead),
    exhausted: v.boolean(),
    /** `false` ends the run here: whatever refused this page refuses the
     *  next step too, so there is nothing to gain from carrying on. */
    resume: v.boolean(),
  },
  returns: v.object({
    inserted: v.number(),
    merged: v.number(),
  }),
  handler: async (ctx, args) => {
    const agent = await leasedAgent(ctx, args.agentId, args.leaseId);
    if (agent === null) {
      // Another run owns the agent now; it is driving, not this step.
      return { inserted: 0, merged: 0 };
    }
    const strategy = await ctx.db.get("strategies", args.strategyId);
    if (strategy === null || strategy.agentId !== agent._id) {
      await handOff(ctx, agent, args.leaseId, true);
      return { inserted: 0, merged: 0 };
    }

    const now = Date.now();
    const sizeRange = companySizeRange(agent.icp, strategy.filters);
    let inserted = 0;
    let merged = 0;
    for (const lead of args.rows) {
      const outcome = await upsertSourcedLead(ctx, {
        orgId: agent.orgId,
        agentId: agent._id,
        strategyId: strategy._id,
        lead,
        icp: agent.icp,
        sizeRange,
        now,
      });
      if (outcome === "inserted") {
        inserted += 1;
      } else if (outcome === "merged") {
        merged += 1;
      }
    }

    await ctx.db.patch("strategies", strategy._id, {
      // Only NEW people count as leads this signal generated; a person a
      // second signal also matched is already in the first signal's total.
      leadsFound: strategy.leadsFound + inserted,
      nextPage: args.exhausted ? MAX_SEARCH_PAGE + 1 : args.page + 1,
      lastRunAt: now,
      updatedAt: now,
    });
    await handOff(ctx, agent, args.leaseId, args.resume);
    return { inserted, merged };
  },
});

/** Renew the lease and hand back to the planner, or end the run here. */
async function handOff(
  ctx: MutationCtx,
  agent: Doc<"agents">,
  leaseId: string,
  resume: boolean,
): Promise<void> {
  if (!resume) {
    await finishRun(ctx, agent, leaseId);
    return;
  }
  await renewRunLease(ctx, agent, leaseId);
  await ctx.scheduler.runAfter(0, internal.agents.run.advanceRun, {
    agentId: agent._id,
    leaseId,
  });
}

/**
 * ONE page: one paid search, one write, back to the planner.
 *
 * The operation key is the agent, the strategy, the page, the step and the
 * revision, so a retried step replays the purchase instead of repeating it.
 */
export const runSourcingStep = internalAction({
  args: {
    agentId: v.id("agents"),
    leaseId: v.string(),
    strategyId: v.id("strategies"),
    page: v.number(),
  },
  returns: v.object({ outcome: v.string() }),
  handler: async (ctx, args): Promise<{ outcome: string }> => {
    const context = await ctx.runQuery(internal.agents.sourcing.sourcingContext, {
      agentId: args.agentId,
      leaseId: args.leaseId,
      strategyId: args.strategyId,
    });
    if (context.status === "stop") {
      return { outcome: "lease_lost" };
    }
    if (context.status === "skip") {
      await ctx.runMutation(internal.agents.run.advanceRun, {
        agentId: args.agentId,
        leaseId: args.leaseId,
      });
      return { outcome: "skipped" };
    }

    const hasExcludes = Object.keys(context.excludeFilters).length > 0;
    let found;
    try {
      found = await ctx.runAction(internal.integrations.enrich.search.findLeads, {
        orgId: context.orgId,
        operationKey: `${args.agentId}:${args.strategyId}:p${args.page}:search:r${context.revision}`,
        filters: context.filters,
        ...(hasExcludes ? { excludeFilters: context.excludeFilters } : {}),
        page: args.page,
      });
    } catch {
      // The search boundary refuses an unusable filter set before it reserves
      // anything, and an unusable strategy will not become usable by being
      // asked again inside this run.
      await ctx.runMutation(internal.agents.run.endRun, {
        agentId: args.agentId,
        leaseId: args.leaseId,
      });
      return { outcome: "refused" };
    }

    if (found.status === "found") {
      await record(ctx, args, {
        rows: found.rows,
        exhausted: !found.hasMore,
        resume: true,
      });
      return { outcome: "found" };
    }
    if (found.status === "replayed") {
      // Already paid for, and its rows were stored by the call that paid.
      await record(ctx, args, { rows: [], exhausted: false, resume: true });
      return { outcome: "replayed" };
    }
    if (found.status === "refunded") {
      if (found.reason === "provider_charged_nothing") {
        // The provider answered and this page holds nobody: the signal is out
        // of results, and no later run should pay to ask again.
        await record(ctx, args, { rows: [], exhausted: true, resume: true });
        return { outcome: "empty" };
      }
      if (found.operationKey !== undefined) {
        // An operation row exists, so the request reached the boundary and
        // the ledger has SETTLED this key as costing nothing. Asking again
        // under it can only replay that refund, never buy the page — so the
        // cursor moves past a page this revision can no longer obtain. The
        // run still ends here: whatever refused refuses the next page too.
        await record(ctx, args, { rows: [], exhausted: false, resume: false });
        return { outcome: `refunded:${found.reason}` };
      }
      // Refused before any record existed — the kill switch, a spent cap, an
      // empty balance. The key is still unused, so the next run asks again.
      await stop(ctx, args);
      return { outcome: `refunded:${found.reason}` };
    }

    // Failed or unknown. The cursor does not move: an `uncertain` hold that
    // the billing sweeps later settle replays as "already stored" rather than
    // buying the same page twice.
    await stop(ctx, args);
    return { outcome: found.status };
  },
});

type StepArgs = {
  agentId: Id<"agents">;
  leaseId: string;
  strategyId: Id<"strategies">;
  page: number;
};

async function record(
  ctx: ActionCtx,
  args: StepArgs,
  page: { rows: SourcedLead[]; exhausted: boolean; resume: boolean },
): Promise<void> {
  await ctx.runMutation(internal.agents.sourcing.recordSourcedPage, {
    agentId: args.agentId,
    leaseId: args.leaseId,
    strategyId: args.strategyId,
    page: args.page,
    ...page,
  });
}

async function stop(ctx: ActionCtx, args: StepArgs): Promise<void> {
  await ctx.runMutation(internal.agents.run.endRun, {
    agentId: args.agentId,
    leaseId: args.leaseId,
  });
}
