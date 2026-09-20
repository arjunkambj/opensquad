/**
 * Get a lead's email — the lead half of PLAN §6's most expensive step
 * (15 credits, and the hidden provider cap that makes it at most ten per
 * trial). The money half is `integrations/enrich/reveal*.ts`; nothing here
 * talks to a provider or moves a credit.
 *
 * The lead's own state machine is `locked → revealing → found | not_found`,
 * and three rules govern it:
 *
 *   IDEMPOTENT PER LEAD. The paid call's operation key is derived from the
 *   prospect id, so a double click, a retry or a second click next week
 *   replays the recorded outcome instead of buying the address twice. The
 *   claim below is the client-visible half of the same guarantee: a lead
 *   already `revealing` is skipped rather than submitted again.
 *
 *   BOUNDED BY WHAT IS ACTUALLY PAYABLE. A bulk request reveals as many leads
 *   as the visible credit balance AND the hidden provider allowance cover, and
 *   says how many it skipped. Both layers are checked here so the refusal is
 *   immediate and honest: an empty visible balance is "out of credits", an
 *   empty hidden allowance is the trial's email limit, and they are different
 *   sentences (PLAN §6).
 *
 *   SPEND GUARD (PLAN §12). Bulk reveals only leads scored 2 or 3. Asking for
 *   ONE lead is the user explicitly asking for that lead, so it is allowed
 *   whatever the score — that is what the row button and the drawer are.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { bucketRemaining, dailyPeriodKey, findBucket } from "../billing/model";
import {
  MAX_LEADS_PER_REVEAL,
  REVEAL_CREDITS_PER_LEAD,
} from "../integrations/enrich/reveal";
import { requireWorkspaceEditor } from "../lib/auth";
import { ACTION_PRICES, TRIAL_METRIC_CAPS } from "../lib/limits";
import { requireRateLimit } from "../lib/rateLimits";
import {
  domainError,
  invalid,
  USAGE_PERIOD_LIFETIME,
} from "../lib/validators";
import { REVEAL_STALL_MS } from "./emailRevealState";
import { loadProspectForWrite } from "./model";
import { v } from "convex/values";

/** PLAN §12: bulk buys addresses for leads worth contacting, not for every
 *  row on the page. */
const BULK_MIN_SCORE = 2;

const vSkipReason = v.union(
  v.literal("already_found"),
  v.literal("in_flight"),
  v.literal("no_address_on_file"),
  v.literal("rejected"),
  v.literal("score_below_threshold"),
  v.literal("not_sourced"),
  v.literal("credits"),
);

/**
 * Start finding the email of one lead, or of a selection.
 *
 * Nothing is bought inside this mutation: it authorises, claims the leads it
 * can pay for, and schedules the internal action that spends. Paid work only
 * ever happens in an `internalAction` an authenticated mutation scheduled
 * (PLAN §6 "Closing the ways in").
 */
export const requestEmails = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    prospectIds: v.array(v.id("prospects")),
  },
  returns: v.object({
    /** Leads now `revealing`; each will cost the email price once. */
    started: v.number(),
    /** The credit price the user is about to spend per lead. */
    creditsPerLead: v.number(),
    skipped: v.array(
      v.object({
        prospectId: v.id("prospects"),
        reason: vSkipReason,
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { identityKey, workspace } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    await requireRateLimit(ctx, "revealEmail", identityKey);
    if (args.prospectIds.length === 0) {
      throw invalid("prospectIds must name at least one lead");
    }
    if (args.prospectIds.length > MAX_LEADS_PER_REVEAL) {
      throw invalid(
        `at most ${MAX_LEADS_PER_REVEAL} emails can be requested at once`,
      );
    }
    const price = ACTION_PRICES.get_email.credits;
    const affordable = await affordableReveals(ctx, workspace, price);
    if (affordable === 0) {
      throw await refusal(ctx, workspace, price);
    }

    // One lead asked for BY ITSELF is the user explicitly asking for that
    // lead (PLAN §12); a selection is the guarded bulk path.
    const explicit = args.prospectIds.length === 1;
    const now = Date.now();
    const claimed: Id<"prospects">[] = [];
    const skipped: { prospectId: Id<"prospects">; reason: typeof vSkipReason.type }[] =
      [];

    for (const prospectId of new Set(args.prospectIds)) {
      const lead = await loadProspectForWrite(ctx, args.workspaceId, prospectId);
      const reason = ineligible(lead, explicit);
      if (reason !== null) {
        skipped.push({ prospectId, reason });
        continue;
      }
      if (claimed.length >= affordable) {
        skipped.push({ prospectId, reason: "credits" });
        continue;
      }
      await ctx.db.patch("prospects", prospectId, {
        emailStatus: "revealing",
        // The claim is also its watchdog: a step that dies mid-flight shows
        // up as an overdue lead rather than as a row nobody looks at again.
        nextActionAt: now + REVEAL_STALL_MS,
        updatedAt: now,
      });
      claimed.push(prospectId);
    }

    if (claimed.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.leads.emailRevealRun.submitReveals,
        { workspaceId: args.workspaceId, prospectIds: claimed },
      );
    }
    return { started: claimed.length, creditsPerLead: price, skipped };
  },
});

/** Why this lead is not asked for, or `null` when it is. */
function ineligible(
  lead: Doc<"prospects">,
  explicit: boolean,
): typeof vSkipReason.type | null {
  if (lead.origin.kind !== "sourced") {
    // Only a sourced lead carries the reference the email finder needs.
    return "not_sourced";
  }
  if (lead.emailStatus === "found") {
    return "already_found";
  }
  if (lead.emailStatus === "revealing") {
    return "in_flight";
  }
  if (lead.emailStatus === "not_found") {
    // We already paid and the provider had none. Asking again buys nothing.
    return "no_address_on_file";
  }
  if (lead.approval === "rejected") {
    return "rejected";
  }
  if (
    !explicit &&
    (lead.research.status !== "researched" || lead.research.aiScore < BULK_MIN_SCORE)
  ) {
    return "score_below_threshold";
  }
  return null;
}

/**
 * How many addresses this workspace can actually pay for right now — the
 * smaller of the visible credit balance and the hidden provider allowance,
 * capped by the provider's own batch ceiling.
 */
async function affordableReveals(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  price: number,
): Promise<number> {
  const credits = await findBucket(
    ctx,
    workspace._id,
    "credits",
    USAGE_PERIOD_LIFETIME,
  );
  if (credits === null) {
    throw domainError(
      "NO_CREDIT_GRANT",
      "this organization has no credit grant; no paid step can run",
    );
  }
  const byCredits = Math.floor(bucketRemaining(credits) / price);
  const byProvider = Math.min(
    await providerAllowance(
      ctx,
      workspace,
      USAGE_PERIOD_LIFETIME,
      TRIAL_METRIC_CAPS.enrich_credits.lifetime,
    ),
    await providerAllowance(
      ctx,
      workspace,
      dailyPeriodKey(workspace, Date.now()),
      TRIAL_METRIC_CAPS.enrich_credits.daily,
    ),
  );
  return Math.max(0, Math.min(byCredits, byProvider, MAX_LEADS_PER_REVEAL));
}

/**
 * Addresses the hidden per-workspace allowance still covers in one period.
 *
 * A period with no bucket yet is not "unlimited": the reserve will create it
 * from the trial cap, so the cap is what this workspace can spend today.
 * Reading it as unbounded would submit reveals the reserve then refuses one
 * by one, which costs a round trip each and tells the user nothing.
 */
async function providerAllowance(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  periodKey: string,
  capWhenUnused: number,
): Promise<number> {
  const bucket = await findBucket(
    ctx,
    workspace._id,
    "enrich_credits",
    periodKey,
  );
  const remaining =
    bucket === null ? capWhenUnused : bucketRemaining(bucket);
  return Math.floor(remaining / REVEAL_CREDITS_PER_LEAD);
}

/**
 * WHICH refusal. PLAN §6: a workspace can hold credits it is no longer
 * allowed to spend, and "Trial limit for emails reached" is a different
 * sentence from "out of credits". The code is what the client maps to copy.
 */
async function refusal(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  price: number,
) {
  const credits = await findBucket(
    ctx,
    workspace._id,
    "credits",
    USAGE_PERIOD_LIFETIME,
  );
  if (credits !== null && bucketRemaining(credits) < price) {
    return domainError(
      "INSUFFICIENT_CREDITS",
      "not enough credits to find an email",
    );
  }
  return domainError(
    "TRIAL_LIMIT_REACHED",
    "this organization's email allowance for the trial is used up",
  );
}
