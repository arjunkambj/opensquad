/**
 * The ideal customer profile — the public half of onboarding dot 2 (PLAN §3,
 * §5, references 06–08).
 *
 * Three functions, and the boundary each one guards:
 *
 *   `options`      what the three screens may offer. Membership-guarded, and
 *                  deliberately narrow: the neutral value lists the chips need
 *                  and nothing about where they come from (PLAN §4).
 *   `startGeneration`  the only authenticated part of a paid run. It checks
 *                  the role, spends a rate-limit token, records `generating`
 *                  so the screen shows live status from its own reactive
 *                  query, and schedules the internal action that may spend
 *                  money. No provider is contacted from here.
 *   `updateIcp`    every manual edit. Each of the seven lists is normalised
 *                  and the three closed ones are re-checked against the cached
 *                  catalogue, so a value the screens never offered cannot get
 *                  in through a hand-made call.
 *
 * The paid half lives in `icpGeneration.ts`; the vocabulary and the checks
 * live in `icpModel.ts`.
 */
import { internal } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { getWorkspaceProfile, profileIsComplete } from "../company/model";
import { requireWorkspaceEditor, requireWorkspaceMember } from "../lib/auth";
import { requireRateLimit } from "../lib/rateLimits";
import { domainError, invalid, vAgentIcp } from "../lib/validators";
import {
  EMPTY_ICP_OPTION_LISTS,
  ICP_GENERATION_STALE_AFTER_MS,
  icpOperationKey,
  normalizeIcp,
  readIcpOptionLists,
  sameIcp,
} from "./icpModel";
import { getWorkspaceAgent, vAgentDoc } from "./model";
import { v } from "convex/values";

/* ------------------------------------------------------------------ */
/* What the three screens may offer                                     */
/* ------------------------------------------------------------------ */

const vIcpOptions = v.object({
  industries: v.array(v.string()),
  /** Broad regions first, then countries. */
  locations: v.array(v.string()),
  /** How many of `locations` are the broad regions, so the screen can group
   *  them without knowing what a region is. */
  locationRegionCount: v.number(),
  companyTypes: v.array(v.string()),
  /** Our own headcount bands; the catalogue has no size filter. */
  companySizes: v.array(v.object({ value: v.string(), label: v.string() })),
  /** Our own "leave these out" options (reference 08). */
  excludeProfiles: v.array(v.object({ value: v.string(), label: v.string() })),
  /**
   * `false` when the allowed values have never been fetched. The screen says
   * so and keeps the free-text steps working, rather than offering chips that
   * would match nobody.
   */
  ready: v.boolean(),
});

/**
 * The values a chip may carry on references 06–08.
 *
 * Membership rather than editor: a viewer may look at the ICP, and this
 * returns nothing that is not already a public vocabulary (industry names,
 * country names, kinds of organisation). Company sizes are our own bands.
 */
export const options = query({
  args: { workspaceId: v.id("workspaces") },
  returns: vIcpOptions,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const lists = await readIcpOptionLists(ctx);
    return lists === null
      ? { ...EMPTY_ICP_OPTION_LISTS, ready: false }
      : { ...lists, ready: true };
  },
});

/* ------------------------------------------------------------------ */
/* Generating one                                                       */
/* ------------------------------------------------------------------ */

/**
 * Why a run is being asked for. It decides which rate-limit bucket pays for
 * it and, more importantly, when the request is a no-op: the first screen of
 * dot 2 asks for `initial` on entry, so that call has to be safe to make on
 * every mount, on every device, forever.
 */
const vGenerationReason = v.union(
  v.literal("initial"),
  v.literal("retry"),
  v.literal("regenerate"),
);

const vStartGenerationResult = v.union(
  v.object({ status: v.literal("started"), startedAt: v.number() }),
  v.object({
    status: v.literal("skipped"),
    reason: v.union(
      v.literal("already_running"),
      v.literal("already_generated"),
      v.literal("nothing_to_retry"),
    ),
  }),
);

/**
 * Start an ICP generation.
 *
 * The free first run is the automatic one: nothing here prices the call — the
 * credit wrapper does, from the ledger (`billing/reserve.ts`), so pressing
 * Regenerate is what costs three credits and the screen only has to say so.
 */
export const startGeneration = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    reason: vGenerationReason,
  },
  returns: vStartGenerationResult,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const agent = await getWorkspaceAgent(ctx, args.workspaceId);
    if (agent === null) {
      throw domainError("NOT_FOUND", "this workspace has no agent yet");
    }

    const now = Date.now();
    const status = agent.icpGeneration;

    // A run that is still going owns the row. The staleness window is only
    // for a deployment that lost the scheduled call.
    if (
      status?.state === "generating" &&
      now - status.startedAt < ICP_GENERATION_STALE_AFTER_MS
    ) {
      return { status: "skipped", reason: "already_running" } as const;
    }
    if (args.reason === "initial" && status !== undefined) {
      // The screen asks on every entry; only the very first one runs.
      return { status: "skipped", reason: "already_generated" } as const;
    }
    if (args.reason === "retry" && status?.state !== "failed") {
      return { status: "skipped", reason: "nothing_to_retry" } as const;
    }

    // Everything downstream reads the profile, and dot 1 is what fills it.
    const profile = await getWorkspaceProfile(ctx, args.workspaceId);
    if (!profileIsComplete(profile)) {
      throw invalid(
        "the company profile needs a name, industry, description and at least one key feature",
      );
    }

    // After the no-ops, so a repeated automatic trigger never spends a token.
    await requireRateLimit(
      ctx,
      args.reason === "regenerate" ? "regenerate" : "generateIcp",
      identityKey,
    );

    await ctx.db.patch("agents", agent._id, {
      icpGeneration: { state: "generating", startedAt: now },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.agents.icpGeneration.generate, {
      workspaceId: args.workspaceId,
      agentId: agent._id,
      startedAt: now,
      operationKey: await icpOperationKey({
        workspaceId: args.workspaceId,
        startedAt: now,
      }),
    });
    return { status: "started", startedAt: now } as const;
  },
});

/* ------------------------------------------------------------------ */
/* Editing one                                                          */
/* ------------------------------------------------------------------ */

/**
 * Save the ICP as the user has it on screen.
 *
 * Whole-value rather than per-field: the three screens hold one draft between
 * them, and a debounced save of the whole ICP is what makes Previous, Next and
 * a refresh all show the same thing.
 *
 * `revision` moves only on a REAL change (PLAN §9.1). A debounce that fires
 * with nothing new must not invalidate work queued under the current revision.
 */
export const updateIcp = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    icp: vAgentIcp,
  },
  returns: vAgentDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const agent = await getWorkspaceAgent(ctx, args.workspaceId);
    if (agent === null) {
      throw domainError("NOT_FOUND", "this workspace has no agent yet");
    }

    const lists = await readIcpOptionLists(ctx);
    if (lists === null) {
      // With no cached catalogue there is nothing to check an industry
      // against, and an unchecked value silently matches nobody.
      throw domainError(
        "CONFLICT",
        "the lead filter catalogue has not been cached yet",
      );
    }
    const icp = normalizeIcp({ icp: args.icp, options: lists, strict: true });

    const changed = !sameIcp(agent.icp, icp);
    await ctx.db.patch("agents", agent._id, {
      icp,
      ...(changed ? { revision: agent.revision + 1 } : {}),
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get("agents", agent._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "agent not found after update");
    }
    return updated;
  },
});
