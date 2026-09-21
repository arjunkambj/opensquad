/**
 * Proposing a meeting — the auditable proposal record and the booking-linked
 * draft that offers it.
 *
 * A proposal NEVER confirms a meeting: a booking link, a suggested slot list,
 * an ambiguous reply and a model classification all stay `proposed`.
 * Proposals go out through the mail path — `draftProposal` creates a draft
 * revision, approval and dispatch happen in outreach, and only the send's
 * acceptance advances the lead to `booking_proposed`.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, mutation } from "../_generated/server";
import { resolveOutboundRecipient } from "../inbox/conversationsModel";
import { appendLeadEvent, findLeadEventByOperationKey } from "../leads/events";
import { requireOrgMember } from "../lib/auth";
import {
  assertBookingProposal,
  assertExpectedVersion,
  boundedString,
  domainError,
  TERMINAL_LEAD_STAGES,
  vBookingProposal,
} from "../lib/validators";
import { vDraftDoc } from "../outreach/draftsModel";
import {
  leadLabel,
  loadBookingForWrite,
  loadProspect,
  vBookingDoc,
} from "./model";
import { v } from "convex/values";

/**
 * Record a booking proposal for a lead: a public booking link, or up to three
 * FUTURE intervals under one IANA timezone (`assertBookingProposal` enforces
 * all of it — a suggested slot can never be a confirmed time). One active
 * proposal per lead, enforced inside this transaction.
 *
 * The proposal is NOT the send: `draftProposal` wraps it in an exact draft,
 * `approvals.approve` is the human gate and the send boundary mails it. This
 * mutation creates the record and appends the `booking_proposed` history —
 * without moving `stage`, which only the provider's send acceptance may
 * advance to `meeting_proposed`.
 */
export const propose = mutation({
  args: {
    orgId: v.id("orgs"),
    prospectId: v.id("prospects"),
    /** OCC on the LEAD the caller saw — the proposal changes its row too. */
    proposal: vBookingProposal,
    /** The thread the proposal will go out on, when already known. */
    conversationId: v.optional(v.id("conversations")),
    requestId: v.string(),
  },
  returns: vBookingDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(ctx, args.orgId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const now = Date.now();
    const proposal = assertBookingProposal(args.proposal, { now });
    const prospect = await loadProspect(
      ctx,
      args.orgId,
      args.prospectId,
    );
    const operationKey = `crm:${args.prospectId}:booking-propose:${requestId}`;
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.orgId,
      operationKey,
    );
    if (prior !== null) {
      const recorded =
        prior.bookingId === undefined
          ? null
          : await ctx.db.get("bookings", prior.bookingId);
      if (
        recorded === null ||
        JSON.stringify(recorded.proposal) !== JSON.stringify(proposal)
      ) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded a different proposal`,
        );
      }
      return recorded;
    }
    if (TERMINAL_LEAD_STAGES.includes(prospect.stage)) {
      throw domainError(
        "CONFLICT",
        `lead is ${prospect.stage} — it must be reopened before a booking is proposed`,
      );
    }
    // At most one ACTIVE booking per lead — read through the state index in
    // this same transaction so a concurrent propose/confirm conflicts under
    // OCC rather than both inserting.
    for (const state of ["proposed", "confirmed"] as const) {
      const active = await ctx.db
        .query("bookings")
        .withIndex("by_prospectId_and_state", (q) =>
          q.eq("prospectId", prospect._id).eq("state", state),
        )
        .first();
      if (active !== null) {
        throw domainError(
          "CONFLICT",
          `lead already has a ${state} booking — cancel or complete it before proposing another`,
        );
      }
    }
    if (args.conversationId !== undefined) {
      const conversation = await ctx.db.get(
        "conversations",
        args.conversationId,
      );
      if (
        conversation === null ||
        conversation.orgId !== args.orgId
      ) {
        throw domainError("NOT_FOUND", "conversation not found");
      }
      if (conversation.prospectId !== prospect._id) {
        throw domainError(
          "CONFLICT",
          "the conversation is bound to a different lead",
        );
      }
    }
    // The acting member owns the booking: leads no longer carry an owner
    // (one agent, one trial org), and a booking must always name
    // someone who can act on it.
    const ownerIdentityKey = identityKey;
    const bookingId = await ctx.db.insert("bookings", {
      orgId: args.orgId,
      prospectId: prospect._id,
      ownerIdentityKey,
      state: "proposed",
      version: 1,
      proposal,
      createdAt: now,
      updatedAt: now,
      ...(args.conversationId !== undefined
        ? { conversationId: args.conversationId }
        : {}),
    });
    await ctx.db.patch("prospects", prospect._id, { updatedAt: now });
    await appendLeadEvent(ctx, {
      orgId: args.orgId,
      prospectId: prospect._id,
      kind: "booking_proposed",
      summary:
        proposal.kind === "booking_link"
          ? `Booking link proposal recorded for ${leadLabel(prospect)}`
          : `Booking proposal recorded for ${leadLabel(prospect)} (${proposal.slots.length} slot option(s))`,
      operationKey,
      bookingId,
      actor: { source: "human", identityKey },
    });
    const booking = await ctx.db.get("bookings", bookingId);
    if (booking === null) {
      throw domainError("NOT_FOUND", "booking not found after insert");
    }
    return booking;
  },
});

/**
 * Record the proposal a REPLY produced, so the meeting the lead asked about
 * exists as a row and not only as a stage.
 *
 * `repliesDecide` moved the lead to `meeting_proposed` when the model read the
 * reply as asking for a call, and wrote a note — but created nothing in
 * `bookings`, so the booking-link gate, the dashboard's proposed/booked split
 * and every proposal linkage had nothing to read. This is the writer for that
 * case, and it is deliberately the narrowest one in the file:
 *
 * - only a `booking_link` proposal, from the AGENT'S OWN configured booking
 *   URL. A `slots` proposal names specific future times, and the only honest
 *   source for those is a person or a calendar — a model must never invent
 *   them, so a thread whose agent has no booking link records no booking at
 *   all rather than a made-up one;
 * - `proposed`, always. `meeting_booked` has exactly one writer and it is the
 *   user's click (PLAN §9.5), and this does not touch `prospects.stage` at
 *   all — `advanceLead` owns that, in the caller's transaction;
 * - one active booking per lead, read in this same transaction, and idempotent
 *   through the `leadEvents` operation key, so a re-driven reply step records
 *   the proposal it already recorded.
 */
export const recordAgentProposal = internalMutation({
  args: {
    orgId: v.id("orgs"),
    prospectId: v.id("prospects"),
    conversationId: v.id("conversations"),
    /** The agent's configured booking link — the only proposal it may make. */
    bookingUrl: v.string(),
    /** The reply step's own key, so a replay records nothing twice. */
    operationKey: v.string(),
  },
  returns: v.object({
    recorded: v.boolean(),
    reason: v.optional(v.string()),
    bookingId: v.optional(v.id("bookings")),
  }),
  handler: async (ctx, args) => {
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.orgId,
      args.operationKey,
    );
    if (prior !== null) {
      return {
        recorded: false as const,
        reason: "replayed",
        ...(prior.bookingId !== undefined ? { bookingId: prior.bookingId } : {}),
      };
    }
    const prospect = await ctx.db.get("prospects", args.prospectId);
    if (prospect === null || prospect.orgId !== args.orgId) {
      return { recorded: false as const, reason: "lead_missing" };
    }
    if (TERMINAL_LEAD_STAGES.includes(prospect.stage)) {
      return { recorded: false as const, reason: "lead_terminal" };
    }
    // At most one ACTIVE booking per lead — the same read the member-facing
    // `propose` does, in the same transaction as the insert. A lead who
    // already has a proposal or a confirmed meeting keeps it: this path is a
    // classification, and it never overwrites a record a person made.
    for (const state of ["proposed", "confirmed"] as const) {
      const active = await ctx.db
        .query("bookings")
        .withIndex("by_prospectId_and_state", (q) =>
          q.eq("prospectId", prospect._id).eq("state", state),
        )
        .first();
      if (active !== null) {
        return {
          recorded: false as const,
          reason: `already_${state}`,
          bookingId: active._id,
        };
      }
    }
    let proposal;
    try {
      // The URL is normalized and refused if it is not a public http(s) link,
      // exactly as it would be from the member-facing path.
      proposal = assertBookingProposal(
        { kind: "booking_link" as const, url: args.bookingUrl },
        { now: Date.now() },
      );
    } catch {
      return { recorded: false as const, reason: "booking_url_invalid" };
    }
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (
      conversation === null ||
      conversation.orgId !== args.orgId ||
      conversation.prospectId !== prospect._id
    ) {
      return { recorded: false as const, reason: "conversation_mismatch" };
    }
    const now = Date.now();
    const bookingId = await ctx.db.insert("bookings", {
      orgId: args.orgId,
      prospectId: prospect._id,
      // No human is acting, so the agent is named the way every other
      // machine actor on a record is (`approvals.approverIdentityKey`'s
      // `autopilot:<agentId>`): a booking must always say who it belongs to,
      // and inventing a member would be worse than saying "the agent".
      ownerIdentityKey:
        conversation.agentId === undefined
          ? "agent"
          : `agent:${conversation.agentId}`,
      state: "proposed",
      version: 1,
      proposal,
      conversationId: conversation._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("prospects", prospect._id, { updatedAt: now });
    await appendLeadEvent(ctx, {
      orgId: args.orgId,
      prospectId: prospect._id,
      kind: "booking_proposed",
      summary: `Booking link proposal recorded for ${leadLabel(prospect)} from their reply`,
      operationKey: args.operationKey,
      bookingId,
      actor: { source: "workflow" },
    });
    return { recorded: true as const, bookingId };
  },
});

/**
 * Create the EXACT draft that carries this proposal out — the ordinary draft
 * path, not a booking-specific send. `internal.outreach.draftRevisions.createRevision` does
 * the revision numbering, payload hash, context-version bump and
 * parked-attempt retirement; this mutation only proves the booking belongs
 * on the draft (`proposed`, this version, this lead's thread) and links the
 * result back.
 *
 * Sending is NEVER implied: the draft waits for a recorded approval, and the
 * dispatch preflight re-validates the booking link one last time.
 */
export const draftProposal = mutation({
  args: {
    orgId: v.id("orgs"),
    bookingId: v.id("bookings"),
    expectedVersion: v.number(),
    conversationId: v.id("conversations"),
    subject: v.string(),
    body: v.string(),
    requestId: v.string(),
  },
  returns: v.object({
    booking: vBookingDoc,
    draft: vDraftDoc,
  }),
  // Explicit return annotation: the inferred cycle draftProposal →
  // internal.outreach.draftRevisions.createRevision → back here would otherwise make the
  // handler `any`.
  handler: async (
    ctx,
    args,
  ): Promise<{
    booking: Doc<"bookings">;
    draft: Doc<"drafts">;
  }> => {
    const { identityKey } = await requireOrgMember(ctx, args.orgId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const booking = await loadBookingForWrite(
      ctx,
      args.orgId,
      args.bookingId,
    );
    // Draft-requestId replay runs BEFORE the booking state gate: the draft a
    // retried request already created is its result even if the booking has
    // since moved on.
    const priorDraft = await ctx.db
      .query("drafts")
      .withIndex("by_orgId_and_requestId", (q) =>
        q.eq("orgId", args.orgId).eq("requestId", requestId),
      )
      .unique();
    if (priorDraft !== null) {
      if (
        priorDraft.bookingId !== booking._id ||
        priorDraft.conversationId !== args.conversationId
      ) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already created a different draft`,
        );
      }
      return { booking, draft: priorDraft };
    }
    if (booking.state !== "proposed") {
      throw domainError(
        "CONFLICT",
        `booking is ${booking.state}; only a live proposal can be drafted`,
      );
    }
    assertExpectedVersion(booking.version, args.expectedVersion, "booking");
    const prospect = await loadProspect(
      ctx,
      args.orgId,
      booking.prospectId,
    );
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (
      conversation === null ||
      conversation.orgId !== args.orgId
    ) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    if (conversation.prospectId !== prospect._id) {
      throw domainError(
        "CONFLICT",
        "the proposal must be drafted on the lead's own thread",
      );
    }
    if (conversation.state !== "open") {
      throw domainError(
        "CONFLICT",
        `conversation is ${conversation.state}; drafts can only be proposed on an open thread`,
      );
    }
    const { recipient } = await resolveOutboundRecipient(ctx, conversation);
    if (recipient === null) {
      throw domainError(
        "CONFLICT",
        "no outbound recipient — the lead needs a contact address or the thread a prior revision",
      );
    }
    const draft: Doc<"drafts"> = await ctx.runMutation(
      internal.outreach.draftRevisions.createRevision,
      {
        conversationId: conversation._id,
        recipient,
        subject: args.subject,
        body: args.body,
        bookingId: booking._id,
        bookingVersion: booking.version,
        createdBy: identityKey,
        requestId,
      },
    );
    await ctx.db.patch("bookings", booking._id, {
      conversationId: conversation._id,
      draftId: draft._id,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get("bookings", booking._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "booking not found after patch");
    }
    return { booking: updated, draft };
  },
});
