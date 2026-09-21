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
 *
 * One refusal is different, and it is the reason `strategies.lastError`
 * exists: a filter set the search boundary will not build is this SIGNAL's
 * problem, not the run's. Asking again next hour cannot fix a catalogue value
 * that moved, and the planner prefers fresh first pages, so leaving it in the
 * rotation stopped sourcing AND research for the whole org for good. Such a
 * signal is parked with its reason and the run carries on with the others.
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
import { vLeadFilters, vOperationErrorCode } from "../lib/validators";
import { finishRun, holdsRunLease, renewRunLease } from "./run";
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
 *
 * The page lands whether or not this step still holds the run lease. A lost
 * lease means another run is driving; it does not mean the rows this one
 * PAID FOR may be thrown away, and the replay path downstream records "the
 * call that paid stored them" — which has to be true.
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
    const agent = await ctx.db.get("agents", args.agentId);
    if (agent === null) {
      return { inserted: 0, merged: 0 };
    }
    // The lease decides who DRIVES the run, never whether a page that has
    // already been paid for is kept: dropping the rows here would bill the
    // org for people it never receives, and storing them twice is
    // impossible — `upsertSourcedLead` dedupes on the provider's row id
    // within the agent, and the cursor only ever moves forward.
    const holdsLease = holdsRunLease(agent, args.leaseId);
    const strategy = await ctx.db.get("strategies", args.strategyId);
    if (strategy === null || strategy.agentId !== agent._id) {
      if (holdsLease) {
        await handOff(ctx, agent, args.leaseId, true);
      }
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
      // Every person this signal FOUND, whether the row was new or already
      // held by another signal: a merge is this signal reaching someone too,
      // and counting only inserts made the per-signal table disagree with the
      // leads that carry the signal (PLAN §3 "+n signals").
      leadsFound: strategy.leadsFound + inserted + merged,
      nextPage: args.exhausted ? MAX_SEARCH_PAGE + 1 : args.page + 1,
      lastRunAt: now,
      updatedAt: now,
    });
    if (holdsLease) {
      await handOff(ctx, agent, args.leaseId, args.resume);
    }
    return { inserted, merged };
  },
});

/**
 * Park one signal and carry on with the rest of the run.
 *
 * Called when the search boundary REFUSED to build this strategy's filters:
 * a value the refreshed catalogue no longer holds, or a filter that can no
 * longer be checked. That is a fact about the signal and nothing else, so the
 * signal records it, leaves the planner's rotation, and the run continues —
 * ending the run instead left the planner picking the same broken signal
 * first on every later run, which stopped sourcing and research for the whole
 * organization with nothing on screen to explain it.
 *
 * The user's own switch is untouched: `enabled` still says what they chose,
 * and switching the signal off and on again clears the park.
 */
export const parkStrategy = internalMutation({
  args: {
    agentId: v.id("agents"),
    leaseId: v.string(),
    strategyId: v.id("strategies"),
    code: vOperationErrorCode,
  },
  returns: v.object({ parked: v.boolean() }),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (agent === null) {
      return { parked: false };
    }
    const strategy = await ctx.db.get("strategies", args.strategyId);
    let parked = false;
    if (strategy !== null && strategy.agentId === agent._id) {
      const now = Date.now();
      await ctx.db.patch("strategies", strategy._id, {
        lastError: {
          code: args.code,
          at: now,
          attempts: (strategy.lastError?.attempts ?? 0) + 1,
        },
        updatedAt: now,
      });
      parked = true;
    }
    if (holdsRunLease(agent, args.leaseId)) {
      await handOff(ctx, agent, args.leaseId, true);
    }
    return { parked };
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
      // anything — nothing was bought, so the cursor stays where it is — and
      // it will refuse the same filters next hour just as flatly. The SIGNAL
      // is parked with its reason and the run goes on to the others; a
      // catalogue that has never been cached is not this path (the boundary
      // answers `failed` for that, which stops the run instead).
      await ctx.runMutation(internal.agents.sourcing.parkStrategy, {
        agentId: args.agentId,
        leaseId: args.leaseId,
        strategyId: args.strategyId,
        code: "invalid_response",
      });
      return { outcome: "parked" };
    }

    if (found.status === "found") {
      await record(ctx, args, {
        rows: found.rows,
        // Only the provider SAYING there is no more page ends the signal. A
        // response with no pagination says nothing, and "we do not know" must
        // not retire a signal that still has people in it — the page bound
        // (`MAX_SEARCH_PAGE`) is what stops the paging either way.
        exhausted: found.hasMore === false,
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
        // The provider answered and this page holds nobody. That is the end of
        // the signal only on POSITIVE evidence — the provider saying there is
        // no page behind this one, or that the whole search matches nobody.
        // An empty page with more behind it is a gap, and an empty page whose
        // response carried no pagination at all is an unknown: both move the
        // cursor on rather than killing a signal on one bad page.
        const empty = found.emptyPage;
        const exhausted =
          empty !== undefined &&
          (empty.hasMore === false || empty.totalResults === 0);
        await record(ctx, args, { rows: [], exhausted, resume: true });
        return { outcome: exhausted ? "empty" : "empty_page" };
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
