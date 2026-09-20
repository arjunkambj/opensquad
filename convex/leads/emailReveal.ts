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
import { internalMutation, internalQuery, mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { bucketRemaining, dailyPeriodKey, findBucket } from "../billing/model";
import { vRevealedContact } from "../integrations/enrich/revealContact";
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
import { appendLeadEvent } from "./events";
import { loadProspectForWrite } from "./model";
import { v } from "convex/values";

/**
 * How long a lead may sit in `revealing` before the recovery sweep calls its
 * job lost. A Convex action cannot outlive ~10 minutes, so past this nothing
 * is still working on it.
 *
 * Belongs in `convex/lib/limits.ts` with the other recovery windows; local
 * only because that file is integrator-only (EXECUTION §0).
 */
export const REVEAL_STALL_MS = 15 * 60 * 1000;

/** PLAN §12: bulk buys addresses for leads worth contacting, not for every
 *  row on the page. */
const BULK_MIN_SCORE = 2;

/** Leads one recovery pass looks at per workspace. */
const RECOVERY_SCAN_MAX = 25;

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
      "this workspace has no credit grant; no paid step can run",
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
    "this workspace's email allowance for the trial is used up",
  );
}

/* ------------------------------------------------------------------ */
/* What the paid step reads and writes back                            */
/* ------------------------------------------------------------------ */

/**
 * The leads a submitted batch should actually ask for, with the provider
 * reference the request needs. Internal: `sourceLeadId` never reaches a
 * client (PLAN §4).
 */
export const revealTargets = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    prospectIds: v.array(v.id("prospects")),
  },
  returns: v.array(
    v.object({
      prospectId: v.id("prospects"),
      sourceLeadId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const targets: { prospectId: Id<"prospects">; sourceLeadId: string }[] = [];
    for (const prospectId of args.prospectIds) {
      const lead = await ctx.db.get("prospects", prospectId);
      if (
        lead === null ||
        lead.workspaceId !== args.workspaceId ||
        lead.emailStatus !== "revealing" ||
        lead.origin.kind !== "sourced"
      ) {
        continue;
      }
      targets.push({ prospectId, sourceLeadId: lead.origin.sourceLeadId });
    }
    return targets;
  },
});

/**
 * The address arrived. Stored with the now-unmasked surname the preview row
 * only hinted at, and with the other facts the reveal filled in where the
 * lead had none — a reveal never overwrites what sourcing already knew.
 *
 * Deliberately blind to approval: a rejected lead's address was paid for and
 * is stored rather than thrown away (PLAN §9.1).
 */
export const applyRevealedEmail = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    contact: vRevealedContact,
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get("prospects", args.prospectId);
    if (lead === null || lead.workspaceId !== args.workspaceId) {
      return { applied: false };
    }
    if (lead.emailStatus === "found") {
      return { applied: true };
    }
    const contact = args.contact;
    const now = Date.now();
    await ctx.db.patch("prospects", args.prospectId, {
      email: contact.email,
      emailStatus: "found",
      nextActionAt: undefined,
      updatedAt: now,
      ...(contact.lastName !== undefined ? { lastName: contact.lastName } : {}),
      ...(lead.firstName === undefined && contact.firstName !== undefined
        ? { firstName: contact.firstName }
        : {}),
      ...(lead.jobTitle === undefined && contact.jobTitle !== undefined
        ? { jobTitle: contact.jobTitle }
        : {}),
      ...(lead.companyName === undefined && contact.companyName !== undefined
        ? { companyName: contact.companyName }
        : {}),
      ...(lead.linkedinUrl === undefined && contact.linkedinUrl !== undefined
        ? { linkedinUrl: contact.linkedinUrl }
        : {}),
      ...(lead.canonicalDomain === undefined &&
      contact.canonicalDomain !== undefined
        ? { canonicalDomain: contact.canonicalDomain }
        : {}),
    });
    await appendLeadEvent(ctx, {
      workspaceId: lead.workspaceId,
      prospectId: lead._id,
      kind: "email_revealed",
      summary: "Work email found for this lead",
      operationKey: `lead:${lead._id}:email:found`,
      details: {
        fromEmailStatus: lead.emailStatus,
        toEmailStatus: "found",
      },
    });
    return { applied: true };
  },
});

/** The provider looked and had none. Never an invented address (PLAN §7). */
export const applyNoEmail = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get("prospects", args.prospectId);
    if (
      lead === null ||
      lead.workspaceId !== args.workspaceId ||
      lead.emailStatus !== "revealing"
    ) {
      return { applied: false };
    }
    await ctx.db.patch("prospects", args.prospectId, {
      emailStatus: "not_found",
      nextActionAt: undefined,
      updatedAt: Date.now(),
    });
    await appendLeadEvent(ctx, {
      workspaceId: lead.workspaceId,
      prospectId: lead._id,
      kind: "email_revealed",
      summary: "No work email on file for this lead",
      operationKey: `lead:${lead._id}:email:not-found`,
      details: {
        fromEmailStatus: "revealing",
        toEmailStatus: "not_found",
      },
    });
    return { applied: true };
  },
});

/**
 * Put a claimed lead back without a verdict: the request was refused before
 * it left us, or nothing could be learned. `locked` is the honest state — we
 * know no more than before — and the user may ask again.
 */
export const releaseReveal = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    prospectIds: v.array(v.id("prospects")),
  },
  returns: v.object({ released: v.number() }),
  handler: async (ctx, args) => {
    let released = 0;
    for (const prospectId of args.prospectIds) {
      const lead = await ctx.db.get("prospects", prospectId);
      if (
        lead === null ||
        lead.workspaceId !== args.workspaceId ||
        lead.emailStatus !== "revealing"
      ) {
        continue;
      }
      await ctx.db.patch("prospects", prospectId, {
        emailStatus: "locked",
        nextActionAt: undefined,
        updatedAt: Date.now(),
      });
      released += 1;
    }
    return { released };
  },
});

/**
 * THE lead half of PLAN §9.1's reveal recovery, for the ten-minute sweep to
 * call per workspace. The money half — asking the job what it charged — is
 * `integrations/enrich/revealPoll.ts#reconcileRevealOperation`, which the
 * sweep already drives; this one asks the same job what it FOUND, so a lead
 * whose poller died does not sit in `revealing` forever.
 */
export const recoverStalledReveals = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({ recovered: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const due = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_nextActionAt", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .gte("nextActionAt", 0)
          .lte("nextActionAt", now),
      )
      .take(RECOVERY_SCAN_MAX);
    let recovered = 0;
    for (const lead of due) {
      if (lead.emailStatus !== "revealing") {
        // A lead due for any other step is the planner's business.
        continue;
      }
      await ctx.scheduler.runAfter(
        0,
        internal.leads.emailRevealRun.recoverLeadReveal,
        { workspaceId: args.workspaceId, prospectId: lead._id },
      );
      recovered += 1;
    }
    return { recovered };
  },
});
