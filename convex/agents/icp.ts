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
 * The paid half lives in `icpGeneration.ts` and the write that ends it in
 * `icpResult.ts`; the vocabulary is `icpVocabulary.ts` and the checks against
 * it are `icpModel.ts`.
 */
import { internal } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { getOrgProfile, profileIsComplete } from "../company/model";
import { requireOrgMember } from "../lib/auth";
import { requireRateLimit } from "../lib/rateLimits";
import { domainError, invalid, vAgentIcp } from "../lib/validators";
import {
  ICP_GENERATION_STALE_AFTER_MS,
  icpIsEmpty,
  icpOperationKey,
  normalizeIcp,
  sameIcp,
} from "./icpModel";
import { EMPTY_ICP_OPTION_LISTS, readIcpOptionLists } from "./icpVocabulary";
import { getOrgAgent, vAgentDoc } from "./model";
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
  args: { orgId: v.id("orgs") },
  returns: vIcpOptions,
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
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
    orgId: v.id("orgs"),
    reason: vGenerationReason,
  },
  returns: vStartGenerationResult,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(ctx, args.orgId);
    const agent = await getOrgAgent(ctx, args.orgId);
    if (agent === null) {
      throw domainError("NOT_FOUND", "this organization has no agent yet");
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
    if (
      args.reason === "initial" &&
      (status !== undefined || !icpIsEmpty(agent.icp))
    ) {
      // The screen asks on every entry; only the very first one runs, and only
      // when there is nothing there to overwrite.
      return { status: "skipped", reason: "already_generated" } as const;
    }
    if (args.reason === "retry" && status?.state !== "failed") {
      return { status: "skipped", reason: "nothing_to_retry" } as const;
    }

    // Everything downstream reads the profile, and dot 1 is what fills it.
    const profile = await getOrgProfile(ctx, args.orgId);
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
      orgId: args.orgId,
      agentId: agent._id,
      startedAt: now,
      operationKey: await icpOperationKey({
        orgId: args.orgId,
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
    orgId: v.id("orgs"),
    icp: vAgentIcp,
  },
  returns: vAgentDoc,
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const agent = await getOrgAgent(ctx, args.orgId);
    if (agent === null) {
      throw domainError("NOT_FOUND", "this organization has no agent yet");
    }

    // With no cached catalogue there is nothing to check an industry against,
    // and an unchecked value silently matches nobody — so the closed groups
    // fall back to EMPTY and `strict` refuses any value for them. The
    // free-text groups are unaffected, which is what keeps the job-titles
    // screen saving on a deployment whose catalogue has not been fetched yet.
    const lists = (await readIcpOptionLists(ctx)) ?? EMPTY_ICP_OPTION_LISTS;
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
