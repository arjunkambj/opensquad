/**
 * The steps behind "Get email": submit the paid request, then ask the job
 * what it found and write it on the lead.
 *
 * Two pollers watch one job on purpose. The reveal's own belt
 * (`integrations/enrich/revealPoll.ts`) settles the MONEY and must run whether
 * or not anyone is still interested; this one settles the LEAD. Both go
 * through the same free, idempotent poll, and a settled operation replays its
 * recorded outcome rather than moving a counter, so they cannot double-settle
 * each other.
 *
 * Nothing here decides who may spend: `leads/emailReveal.ts#requestEmails`
 * authenticated the caller, checked both money layers and claimed the leads
 * before scheduling any of this.
 */
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { composeOperationKey } from "../billing/paidCall";
import { REVEAL_POLL_INTERVAL_MS } from "../integrations/enrich/reveal";
import type { RevealPollResult } from "../integrations/enrich/revealPoll";
import { v } from "convex/values";

/**
 * How long this belt follows a job before leaving it to the recovery sweep —
 * about two minutes at the interval below. The lead stays `revealing` with
 * its watchdog set, so nothing is lost.
 */
const LEAD_POLL_MAX_ATTEMPTS = 40;

/** Slower than the money belt's 2 s: both ask the same free endpoint, and one
 *  of them does not need to be first. */
const LEAD_POLL_INTERVAL_MS = REVEAL_POLL_INTERVAL_MS + 1_000;

/**
 * Ask for the claimed leads' addresses — one paid call per lead, keyed on the
 * prospect id so a retry replays instead of buying twice.
 */
export const submitReveals = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    prospectIds: v.array(v.id("prospects")),
  },
  returns: v.object({ submitted: v.number(), released: v.number() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ submitted: number; released: number }> => {
    const targets = await ctx.runQuery(internal.leads.emailRevealState.revealTargets, {
      workspaceId: args.workspaceId,
      prospectIds: args.prospectIds,
    });
    if (targets.length === 0) {
      return { submitted: 0, released: 0 };
    }
    const prospectOf = new Map(
      targets.map((target) => [target.sourceLeadId, target.prospectId]),
    );

    const outcome = await ctx.runAction(
      internal.integrations.enrich.reveal.revealLeadEmails,
      {
        workspaceId: args.workspaceId,
        leads: targets.map((target) => ({
          sourceLeadId: target.sourceLeadId,
          // The caller's half of the ledger key. Derived from the lead, so
          // the same lead is never bought twice (PLAN §6 "operationKey makes
          // retries free").
          operationKey: target.prospectId,
        })),
      },
    );
    if (outcome.status === "failed") {
      return {
        submitted: 0,
        released: await release(
          ctx,
          args.workspaceId,
          targets.map((target) => target.prospectId),
        ),
      };
    }

    let submitted = 0;
    const releasing: Id<"prospects">[] = [];
    for (const result of outcome.results) {
      const prospectId = prospectOf.get(result.sourceLeadId);
      if (prospectId === undefined) {
        continue;
      }
      if (result.status === "submitted") {
        await schedulePoll(ctx, {
          workspaceId: args.workspaceId,
          prospectId,
          operationKey: result.operationKey,
          jobId: result.jobId,
          attempt: 1,
        });
        submitted += 1;
        continue;
      }
      if (result.status === "replayed") {
        // Already paid for on an earlier request: recover the job reference
        // and read the address back rather than buying it again.
        await ctx.runAction(internal.leads.emailRevealRun.recoverLeadReveal, {
          workspaceId: args.workspaceId,
          prospectId,
        });
        submitted += 1;
        continue;
      }
      // Refused before the request left us, or the submit failed outright —
      // nothing was learned, so the lead goes back to `locked`.
      releasing.push(prospectId);
    }
    for (const sourceLeadId of outcome.deferred) {
      const prospectId = prospectOf.get(sourceLeadId);
      if (prospectId !== undefined) {
        releasing.push(prospectId);
      }
    }
    return {
      submitted,
      released: await release(ctx, args.workspaceId, releasing),
    };
  },
});

/** Follow one job until it says what it found, then write it on the lead. */
export const driveLeadReveal = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    operationKey: v.string(),
    jobId: v.string(),
    attempt: v.number(),
  },
  returns: v.object({ status: v.string() }),
  handler: async (ctx, args): Promise<{ status: string }> => {
    const polled: RevealPollResult = await ctx.runAction(
      internal.integrations.enrich.revealPoll.pollLeadReveal,
      {
        workspaceId: args.workspaceId,
        operationKey: args.operationKey,
        jobId: args.jobId,
      },
    );
    await applyPoll(ctx, args, polled);
    if (
      (polled.status === "pending" || polled.status === "unknown") &&
      args.attempt < LEAD_POLL_MAX_ATTEMPTS
    ) {
      await schedulePoll(ctx, { ...args, attempt: args.attempt + 1 });
    }
    return { status: polled.status };
  },
});

/**
 * The recovery sweep's lead half (scheduled by
 * `leads/emailRevealState.ts#recoverStalledReveals`): a lead still `revealing`
 * past its watchdog lost whoever was polling for it. Ask the job once more,
 * and if no job reference was ever recorded, put the lead back to `locked`.
 */
export const recoverLeadReveal = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
  },
  returns: v.object({ status: v.string() }),
  handler: async (ctx, args): Promise<{ status: string }> => {
    const operationKey = composeOperationKey("get_email", args.prospectId);
    const recorded = await ctx.runQuery(
      internal.integrations.enrich.revealPoll.revealJobOf,
      { workspaceId: args.workspaceId, operationKey },
    );
    if (recorded === null || recorded.jobId === null) {
      await release(ctx, args.workspaceId, [args.prospectId]);
      return { status: "no_reference" };
    }
    const polled: RevealPollResult = await ctx.runAction(
      internal.integrations.enrich.revealPoll.pollLeadReveal,
      {
        workspaceId: args.workspaceId,
        operationKey,
        jobId: recorded.jobId,
      },
    );
    await applyPoll(
      ctx,
      { workspaceId: args.workspaceId, prospectId: args.prospectId },
      polled,
    );
    if (polled.status === "pending" || polled.status === "unknown") {
      // Still running: follow it again rather than leaving it to the next
      // sweep ten minutes from now.
      await schedulePoll(ctx, {
        workspaceId: args.workspaceId,
        prospectId: args.prospectId,
        operationKey,
        jobId: recorded.jobId,
        attempt: 1,
      });
    }
    return { status: polled.status };
  },
});

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

/** One poll result, written on the lead. Pending and unknown write nothing. */
async function applyPoll(
  ctx: ActionCtx,
  target: { workspaceId: Id<"workspaces">; prospectId: Id<"prospects"> },
  polled: RevealPollResult,
): Promise<void> {
  if (polled.status === "revealed") {
    await ctx.runMutation(internal.leads.emailRevealState.applyRevealedEmail, {
      workspaceId: target.workspaceId,
      prospectId: target.prospectId,
      contact: polled.contact,
    });
    return;
  }
  if (polled.status === "no_email") {
    await ctx.runMutation(internal.leads.emailRevealState.applyNoEmail, {
      workspaceId: target.workspaceId,
      prospectId: target.prospectId,
    });
    return;
  }
  if (polled.status === "failed") {
    await release(ctx, target.workspaceId, [target.prospectId]);
  }
}

async function schedulePoll(
  ctx: ActionCtx,
  args: {
    workspaceId: Id<"workspaces">;
    prospectId: Id<"prospects">;
    operationKey: string;
    jobId: string;
    attempt: number;
  },
): Promise<void> {
  await ctx.scheduler.runAfter(
    LEAD_POLL_INTERVAL_MS,
    internal.leads.emailRevealRun.driveLeadReveal,
    args,
  );
}

async function release(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
  prospectIds: Id<"prospects">[],
): Promise<number> {
  if (prospectIds.length === 0) {
    return 0;
  }
  const result = await ctx.runMutation(
    internal.leads.emailRevealState.releaseReveal,
    { workspaceId, prospectIds },
  );
  return result.released;
}
