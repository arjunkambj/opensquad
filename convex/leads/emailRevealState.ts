/**
 * What the paid reveal WRITES on the lead: the claim's result, and the belt
 * that recovers a claim whose job was lost.
 *
 * `leads/emailReveal.ts` decides who may ask and how many can be paid for;
 * `leads/emailRevealRun.ts` does the asking. Everything that touches the
 * lead's own `locked → revealing → found | not_found` state machine lives
 * here, so it has one set of writers and the recovery sweep can reuse them.
 */
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { vRevealedContact } from "../integrations/enrich/revealContact";
import { appendLeadEvent } from "./events";
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

/** Leads one recovery pass looks at per workspace. */
const RECOVERY_SCAN_MAX = 25;

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
