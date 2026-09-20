/**
 * Bookings — the §4.3/§5.5/§8 meeting lifecycle (P19).
 *
 * States: `proposed | confirmed | cancelled | completed | no_show`. A
 * proposal NEVER confirms a meeting — a booking link, a suggested slot list,
 * an ambiguous reply and a model classification all stay `proposed` until a
 * human records the actual agreement: the agreed start/end, the IANA
 * timezone the prospect stated them in, and a short basis for how the time
 * was confirmed. There is no calendar connector: `confirmationSource` is
 * `manual` — an honest human assertion — and `externalEventRef` stays empty
 * until a verified provider flow exists (§4.3, §9).
 *
 * INVARIANTS enforced here, inside the writing transaction:
 *
 *   One active booking per lead — at most one `proposed` or `confirmed` row,
 *   read through `by_prospectId_and_state` in the same transaction that
 *   creates or moves one.
 *
 *   Optimistic concurrency — every mutation takes `expectedVersion` against
 *   the booking row (`propose` takes the LEAD's version), and every one is
 *   idempotent through the `leadEvents` (workspaceId, operationKey) index:
 *   a replayed `requestId` returns the row it produced, while the same key
 *   carrying different content is a CONFLICT.
 *
 *   Lead + history stay in sync — every booking transition updates the lead's
 *   stage/next action and appends its `leadEvents` row in one transaction.
 *   `booked` is reached ONLY through `confirm`; cancel/outcome fall the lead
 *   back to the last stage its facts still support (reply → `replied`,
 *   accepted send → `contacted`, else the last non-booking stage recorded)
 *   and set an EXPLICIT next action — never `won`/`lost`, which stay human
 *   decisions.
 *
 *   Proposals go out through the mail path — a booking-linked draft is made
 *   by `draftProposal` → `internal.outreach.draftRevisions.createRevision`, approved via
 *   `approvals.approve`, and dispatched by `sending.sendApprovedDraft`. There
 *   is no booking-specific send. The draft's `bookingId`/`bookingVersion`
 *   link is re-validated at approval AND at dispatch, and only the send's
 *   acceptance advances the lead to `booking_proposed` (markSendAccepted).
 *   Rescheduling or cancelling retires every unsent draft still offering the
 *   old agreement.
 */
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  requireWorkspaceEditor,
  requireWorkspaceMember,
} from "./lib/auth";
import {
  assertBookingProposal,
  assertConfirmationSourceEnabled,
  assertExpectedVersion,
  assertRequiredBookingTimes,
  boundedLimit,
  boundedString,
  domainError,
  invalid,
  vBookingProposal,
  vBookingState,
  BOOKING_CANCELLATION_REASON_MAX_LENGTH,
  BOOKING_CONFIRMATION_NOTE_MAX_LENGTH,
  DEFAULT_LIST_LIMIT,
  LEAD_EVENT_REASON_MAX_LENGTH,
  PROSPECT_STAGE_REASON_MAX_LENGTH,
  TERMINAL_LEAD_STAGES,
} from "./lib/validators";
import type { LeadStage } from "./lib/validators";
import {
  appendLeadEvent,
  findLeadEventByOperationKey,
} from "./leads/events";
import { resolveOutboundRecipient } from "./conversations";
import { vDraftDoc } from "./outreach/draftsModel";
import { bookingFields } from "./schema";

export const vBookingDoc = v.object({
  _id: v.id("bookings"),
  _creationTime: v.number(),
  ...bookingFields,
});

const vListPage = v.object({
  items: v.array(vBookingDoc),
  cursor: v.union(v.string(), v.null()),
  hasMore: v.boolean(),
});

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Bookings, sliced exactly the way the declared indexes allow:
 *
 *   `prospectId` — one lead's booking history, newest first
 *   (`by_prospectId_and_createdAt`; `state` narrows it on
 *   `by_prospectId_and_state`).
 *
 *   `state` — the workspace's bookings in one state, ordered by `startsAt`
 *   (`by_workspaceId_and_state_and_startsAt`): soonest-first for `confirmed`
 *   — the upcoming-meetings view — and `proposed` rows, which have no
 *   `startsAt`, sort together at the front; terminal states newest-first.
 *
 *   `owner` — one member's bookings by `startsAt`
 *   (`by_workspaceId_and_ownerIdentityKey_and_startsAt`), soonest first: the
 *   operator's worklist, where undated proposals lead.
 *
 * Combinations with no index — owner+state, everything together — REFUSE
 * rather than silently post-filter a truncated page (§5).
 */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.optional(v.id("prospects")),
    state: v.optional(vBookingState),
    owner: v.optional(v.string()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: vListPage,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const paginate = {
      numItems: boundedLimit(args.limit),
      cursor: args.cursor ?? null,
    };
    if (args.prospectId !== undefined) {
      if (args.owner !== undefined) {
        throw invalid(
          "owner cannot combine with prospectId — no index supports that combination",
        );
      }
      const prospectId = args.prospectId;
      const prospect = await ctx.db.get("prospects", prospectId);
      if (prospect === null || prospect.workspaceId !== args.workspaceId) {
        throw domainError("NOT_FOUND", "prospect not found");
      }
      const state = args.state;
      const result =
        state !== undefined
          ? await ctx.db
              .query("bookings")
              .withIndex("by_prospectId_and_state", (q) =>
                q.eq("prospectId", prospectId).eq("state", state),
              )
              .order("desc")
              .paginate(paginate)
          : await ctx.db
              .query("bookings")
              .withIndex("by_prospectId_and_createdAt", (q) =>
                q.eq("prospectId", prospectId),
              )
              .order("desc")
              .paginate(paginate);
      return {
        items: result.page,
        cursor: result.isDone ? null : result.continueCursor,
        hasMore: !result.isDone,
      };
    }
    if (args.state !== undefined && args.owner !== undefined) {
      throw invalid(
        "owner cannot combine with state — no index supports that combination",
      );
    }
    if (args.state !== undefined) {
      const state = args.state;
      const result = await ctx.db
        .query("bookings")
        .withIndex("by_workspaceId_and_state_and_startsAt", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("state", state),
        )
        .order(state === "confirmed" || state === "proposed" ? "asc" : "desc")
        .paginate(paginate);
      return {
        items: result.page,
        cursor: result.isDone ? null : result.continueCursor,
        hasMore: !result.isDone,
      };
    }
    if (args.owner !== undefined) {
      const owner = args.owner;
      const result = await ctx.db
        .query("bookings")
        .withIndex("by_workspaceId_and_ownerIdentityKey_and_startsAt", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("ownerIdentityKey", owner),
        )
        .order("asc")
        .paginate(paginate);
      return {
        items: result.page,
        cursor: result.isDone ? null : result.continueCursor,
        hasMore: !result.isDone,
      };
    }
    throw invalid(
      "list requires one of prospectId, state or owner — the schema declares an index per supported slice and no workspace-wide range exists",
    );
  },
});

/** One booking; a foreign or missing row is NOT_FOUND, never FORBIDDEN. */
export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    bookingId: v.id("bookings"),
  },
  returns: vBookingDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await loadBookingForWrite(ctx, args.workspaceId, args.bookingId);
  },
});

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

async function loadBookingForWrite(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  bookingId: Id<"bookings">,
): Promise<Doc<"bookings">> {
  const booking = await ctx.db.get("bookings", bookingId);
  if (booking === null || booking.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "booking not found");
  }
  return booking;
}

/** A lead's display label — a sourced row may carry no company name. */
function leadLabel(prospect: Doc<"prospects">): string {
  return prospect.companyName ?? "this lead";
}

async function loadProspect(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  prospectId: Id<"prospects">,
): Promise<Doc<"prospects">> {
  const prospect = await ctx.db.get("prospects", prospectId);
  if (prospect === null || prospect.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "prospect not found");
  }
  return prospect;
}

/**
 * The stage a lead falls back to when its booking leaves the active states —
 * the last stage its facts still support: a verified reply, an accepted send,
 * else the newest recorded non-meeting stage, else whether it has been
 * researched at all. Terminal stages are never re-entered from here either —
 * if a human closed the lead while a booking was still active, the fallback
 * leaves the call standing (the check happens before this is consulted).
 */
async function fallbackLeadStage(
  ctx: MutationCtx,
  prospect: Doc<"prospects">,
): Promise<LeadStage> {
  if (prospect.lastReplyAt !== undefined) {
    return "replied";
  }
  if (prospect.lastContactedAt !== undefined) {
    return "contacted";
  }
  const events = await ctx.db
    .query("leadEvents")
    .withIndex("by_prospectId_and_createdAt", (q) =>
      q.eq("prospectId", prospect._id),
    )
    .order("desc")
    .take(DEFAULT_LIST_LIMIT);
  for (const event of events) {
    if (
      event.toStage !== undefined &&
      event.toStage !== "meeting_proposed" &&
      event.toStage !== "meeting_booked"
    ) {
      return event.toStage;
    }
  }
  return prospect.research.status === "researched" ? "researched" : "found";
}

/**
 * Retire every still-live draft that proposes this booking — a rescheduled or
 * cancelled agreement makes the mailed copy a lie. A revision that already
 * reached the provider stays (it is history, not a proposal that can still
 * act); everything else is superseded, its open approval ask retired and its
 * parked send intent cancelled — each through the OWNING internal path, in
 * this same transaction.
 */
async function retireLinkedDrafts(
  ctx: MutationCtx,
  booking: Doc<"bookings">,
  reason: string,
): Promise<void> {
  const linked = await ctx.db
    .query("drafts")
    .withIndex("by_bookingId", (q) => q.eq("bookingId", booking._id))
    .collect();
  for (const draft of linked) {
    const attempts = await ctx.db
      .query("sendAttempts")
      .withIndex("by_draftId", (q) => q.eq("draftId", draft._id))
      .collect();
    if (attempts.some((attempt) => attempt.state === "acknowledged")) {
      continue;
    }
    if (draft.supersededAt === undefined) {
      await ctx.db.patch("drafts", draft._id, { supersededAt: Date.now() });
    }
    await ctx.runMutation(internal.outreach.sendControls.cancelDraftParkedAttempts, {
      workspaceId: booking.workspaceId,
      draftId: draft._id,
      reason,
    });
  }
}

/** Validate the agreed-meeting triple every timed write shares (§5.5). */
function assertAgreedTimes(
  state: "confirmed" | "completed" | "no_show",
  times: { startsAt: number; endsAt: number; timezone: string },
  now: number,
): { startsAt: number; endsAt: number; timezone: string } {
  // `state` is always a timed state here, so the triple is always required —
  // the `undefined` arm of `assertRequiredBookingTimes` is unreachable.
  const checked = assertRequiredBookingTimes(state, times);
  if (checked === undefined) {
    throw invalid(`${state} requires agreed meeting times`);
  }
  if (checked.endsAt <= now) {
    throw invalid(
      "the agreed meeting must still be upcoming — a past meeting is an outcome to record, not a confirmation",
    );
  }
  return checked;
}

/* ------------------------------------------------------------------ */
/* propose — create the auditable proposal record                       */
/* ------------------------------------------------------------------ */

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
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    /** OCC on the LEAD the caller saw — the proposal changes its row too. */
    proposal: vBookingProposal,
    /** The thread the proposal will go out on, when already known. */
    conversationId: v.optional(v.id("conversations")),
    requestId: v.string(),
  },
  returns: vBookingDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const now = Date.now();
    const proposal = assertBookingProposal(args.proposal, { now });
    const prospect = await loadProspect(
      ctx,
      args.workspaceId,
      args.prospectId,
    );
    const operationKey = `crm:${args.prospectId}:booking-propose:${requestId}`;
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.workspaceId,
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
        conversation.workspaceId !== args.workspaceId
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
    // (one agent, one trial workspace), and a booking must always name
    // someone who can act on it.
    const ownerIdentityKey = identityKey;
    const bookingId = await ctx.db.insert("bookings", {
      workspaceId: args.workspaceId,
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
      workspaceId: args.workspaceId,
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
    workspaceId: v.id("workspaces"),
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
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const booking = await loadBookingForWrite(
      ctx,
      args.workspaceId,
      args.bookingId,
    );
    // Draft-requestId replay runs BEFORE the booking state gate: the draft a
    // retried request already created is its result even if the booking has
    // since moved on.
    const priorDraft = await ctx.db
      .query("drafts")
      .withIndex("by_workspaceId_and_requestId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("requestId", requestId),
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
      args.workspaceId,
      booking.prospectId,
    );
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (
      conversation === null ||
      conversation.workspaceId !== args.workspaceId
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

/* ------------------------------------------------------------------ */
/* The confirmed-agreement writes                                       */
/* ------------------------------------------------------------------ */

/**
 * Record that a human agreed a real meeting — the ONLY path from `proposed`
 * to `confirmed`, and from there the only path that puts the lead at
 * `booked`.
 *
 * What must be supplied is the AGREEMENT, not an interpretation: the actual
 * agreed start and end as instants, the IANA timezone the prospect stated
 * them in, and `confirmationNote` — the short basis of the agreement ("they
 * confirmed Tuesday 3pm ET by email", "agreed on the call"). A clicked link,
 * a suggested slot, an ambiguous reply or a model's read of the thread is
 * none of those, so none of them can call this.
 *
 * There is no calendar connector: `confirmationSource` is always `manual` and
 * a caller-supplied `externalEventRef` is REFUSED — a stored provider event
 * id without a verified sync path would be fabricated evidence (§9).
 */
export const confirm = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    bookingId: v.id("bookings"),
    expectedVersion: v.number(),
    startsAt: v.number(),
    endsAt: v.number(),
    timezone: v.string(),
    /** How the time was actually agreed — the record's stated basis. */
    confirmationNote: v.string(),
    externalEventRef: v.optional(v.string()),
    requestId: v.string(),
  },
  returns: vBookingDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const confirmationNote = boundedString(
      args.confirmationNote,
      "confirmationNote",
      { min: 1, max: BOOKING_CONFIRMATION_NOTE_MAX_LENGTH },
    );
    if (args.externalEventRef !== undefined) {
      throw invalid(
        "externalEventRef needs a verified calendar connector — none exists; manual confirmation is the only enabled source",
      );
    }
    const booking = await loadBookingForWrite(
      ctx,
      args.workspaceId,
      args.bookingId,
    );
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.workspaceId,
      `booking:${args.bookingId}:confirmed:${requestId}`,
    );
    if (prior !== null) {
      const same =
        booking.startsAt === args.startsAt &&
        booking.endsAt === args.endsAt &&
        booking.timezone === args.timezone;
      if (!same) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded a different confirmation`,
        );
      }
      return booking;
    }
    if (booking.state !== "proposed") {
      throw domainError(
        "CONFLICT",
        `booking is ${booking.state}; only a live proposal can be confirmed`,
      );
    }
    assertExpectedVersion(booking.version, args.expectedVersion, "booking");
    assertConfirmationSourceEnabled("manual");
    const now = Date.now();
    const times = assertAgreedTimes(
      "confirmed",
      {
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        timezone: args.timezone,
      },
      now,
    );
    const prospect = await loadProspect(
      ctx,
      args.workspaceId,
      booking.prospectId,
    );
    if (TERMINAL_LEAD_STAGES.includes(prospect.stage)) {
      throw domainError(
        "CONFLICT",
        `lead is ${prospect.stage} — it must be reopened before a booking is confirmed`,
      );
    }
    // PLAN §9.5: this mutation IS the user's "Mark as booked". It is the only
    // writer of `meeting_booked`, and it sets the stage outright rather than
    // advancing it, because the human assertion outranks the pipeline order.
    const nextStage = "meeting_booked" as const;
    const stageReason = boundedString(
      `Meeting confirmed — ${confirmationNote}`,
      "stageReason",
      { min: 1, max: PROSPECT_STAGE_REASON_MAX_LENGTH },
    );
    await ctx.db.patch("bookings", booking._id, {
      state: "confirmed",
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      timezone: times.timezone,
      confirmationSource: "manual",
      confirmedBy: identityKey,
      confirmedAt: now,
      confirmationNote,
      version: booking.version + 1,
      updatedAt: now,
    });
    await ctx.db.patch("prospects", prospect._id, {
      stage: nextStage,
      stageReason,
      // The meeting is the next thing that happens on this lead, so the state
      // machine has nothing to do until it does.
      nextActionAt: undefined,
      updatedAt: now,
    });
    await appendLeadEvent(ctx, {
      workspaceId: args.workspaceId,
      prospectId: prospect._id,
      kind: "booking_confirmed",
      summary: `Meeting confirmed for ${new Date(times.startsAt).toISOString()} ${times.timezone} — ${confirmationNote}`,
      operationKey: `booking:${booking._id}:confirmed:${requestId}`,
      bookingId: booking._id,
      ...(nextStage === prospect.stage
        ? {}
        : { fromStage: prospect.stage, toStage: nextStage }),
      actor: { source: "human", identityKey },
      details: { reason: confirmationNote },
    });
    const updated = await ctx.db.get("bookings", booking._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "booking not found after patch");
    }
    return updated;
  },
});

/**
 * Move a CONFIRMED meeting to a new agreed time. The new agreement needs the
 * same three facts as the first — real start/end, IANA timezone — plus the
 * `reason` the agreement changed. The previous triple and the reason are
 * preserved in the lead history; the booking row holds only the CURRENT
 * agreement, and `confirmedBy`/`confirmedAt` name the human who asserted the
 * new one.
 *
 * Every still-unsent draft proposing this booking is retired: sending the old
 * times under a stale approval is exactly what the `bookingVersion` binding
 * exists to prevent, and the version bump makes any drafted proposal
 * un-sendable even before retirement runs.
 */
export const reschedule = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    bookingId: v.id("bookings"),
    expectedVersion: v.number(),
    startsAt: v.number(),
    endsAt: v.number(),
    timezone: v.string(),
    reason: v.string(),
    requestId: v.string(),
  },
  returns: vBookingDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const reason = boundedString(args.reason, "reason", {
      min: 1,
      max: LEAD_EVENT_REASON_MAX_LENGTH,
    });
    const booking = await loadBookingForWrite(
      ctx,
      args.workspaceId,
      args.bookingId,
    );
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.workspaceId,
      `booking:${args.bookingId}:rescheduled:${requestId}`,
    );
    if (prior !== null) {
      const same =
        booking.startsAt === args.startsAt &&
        booking.endsAt === args.endsAt &&
        booking.timezone === args.timezone;
      if (!same) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded a different reschedule`,
        );
      }
      return booking;
    }
    if (booking.state !== "confirmed") {
      throw domainError(
        "CONFLICT",
        `booking is ${booking.state}; only a confirmed meeting can be rescheduled`,
      );
    }
    assertExpectedVersion(booking.version, args.expectedVersion, "booking");
    const now = Date.now();
    const times = assertAgreedTimes(
      "confirmed",
      {
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        timezone: args.timezone,
      },
      now,
    );
    const prospect = await loadProspect(
      ctx,
      args.workspaceId,
      booking.prospectId,
    );
    await ctx.db.patch("bookings", booking._id, {
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      timezone: times.timezone,
      confirmedBy: identityKey,
      confirmedAt: now,
      version: booking.version + 1,
      updatedAt: now,
    });
    await ctx.db.patch("prospects", prospect._id, { updatedAt: now });
    await retireLinkedDrafts(
      ctx,
      booking,
      `booking rescheduled — the proposed times are no longer the agreement`,
    );
    await appendLeadEvent(ctx, {
      workspaceId: args.workspaceId,
      prospectId: prospect._id,
      kind: "booking_rescheduled",
      summary: `Meeting moved to ${new Date(times.startsAt).toISOString()} ${times.timezone} — ${reason}`,
      operationKey: `booking:${booking._id}:rescheduled:${requestId}`,
      bookingId: booking._id,
      actor: { source: "human", identityKey },
      details: {
        previousStartsAt: booking.startsAt,
        previousEndsAt: booking.endsAt,
        previousTimezone: booking.timezone,
        reason,
      },
    });
    const updated = await ctx.db.get("bookings", booking._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "booking not found after patch");
    }
    return updated;
  },
});

/**
 * Cancel a live booking — proposed or confirmed — with a required stated
 * reason. The agreed times, timezone and confirmation details STAY on the
 * row: a cancellation records that the agreement was called off, it does not
 * erase that it existed.
 *
 * The lead falls back to the last stage its facts still support and gets an
 * explicit next action (caller-supplied, or the derived follow-up). Every
 * unsent draft still offering this booking is retired in the same
 * transaction.
 */
export const cancel = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    bookingId: v.id("bookings"),
    expectedVersion: v.number(),
    reason: v.string(),
    /** Override the derived follow-up action. */
    requestId: v.string(),
  },
  returns: vBookingDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const reason = boundedString(args.reason, "reason", {
      min: 1,
      max: BOOKING_CANCELLATION_REASON_MAX_LENGTH,
    });
    const booking = await loadBookingForWrite(
      ctx,
      args.workspaceId,
      args.bookingId,
    );
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.workspaceId,
      `booking:${args.bookingId}:cancelled:${requestId}`,
    );
    if (prior !== null) {
      if (
        booking.state !== "cancelled" ||
        booking.cancellationReason !== reason
      ) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded a different cancellation`,
        );
      }
      return booking;
    }
    if (booking.state !== "proposed" && booking.state !== "confirmed") {
      throw domainError(
        "CONFLICT",
        `booking is ${booking.state}; only a live booking can be cancelled`,
      );
    }
    assertExpectedVersion(booking.version, args.expectedVersion, "booking");
    const now = Date.now();
    const prospect = await loadProspect(
      ctx,
      args.workspaceId,
      booking.prospectId,
    );
    // Only a lead still sitting on a meeting stage falls back; a stage a
    // human set since stands.
    const inBookingStage =
      prospect.stage === "meeting_proposed" ||
      prospect.stage === "meeting_booked";
    const nextStage = inBookingStage
      ? await fallbackLeadStage(ctx, prospect)
      : prospect.stage;
    const stageReason = boundedString(
      `Booking cancelled — ${reason}`,
      "stageReason",
      { min: 1, max: PROSPECT_STAGE_REASON_MAX_LENGTH },
    );
    await ctx.db.patch("bookings", booking._id, {
      state: "cancelled",
      cancellationReason: reason,
      version: booking.version + 1,
      updatedAt: now,
    });
    await ctx.db.patch("prospects", prospect._id, {
      ...(inBookingStage ? { stage: nextStage, stageReason } : { stageReason }),
      updatedAt: now,
    });
    await retireLinkedDrafts(
      ctx,
      booking,
      `booking cancelled — the proposal is no longer open`,
    );
    await appendLeadEvent(ctx, {
      workspaceId: args.workspaceId,
      prospectId: prospect._id,
      kind: "booking_cancelled",
      summary: `Booking cancelled — ${reason}`,
      operationKey: `booking:${booking._id}:cancelled:${requestId}`,
      bookingId: booking._id,
      ...(inBookingStage && nextStage !== prospect.stage
        ? { fromStage: prospect.stage, toStage: nextStage }
        : {}),
      actor: { source: "human", identityKey },
      details: {
        previousStartsAt: booking.startsAt,
        previousEndsAt: booking.endsAt,
        previousTimezone: booking.timezone,
        reason,
      },
    });
    const updated = await ctx.db.get("bookings", booking._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "booking not found after patch");
    }
    return updated;
  },
});

/**
 * Record what actually happened at a confirmed meeting: `completed` or
 * `no_show`. Callable only after the scheduled start has passed — a future
 * meeting has no outcome yet — and the agreed times stay on the row. The lead
 * falls back to the last stage its facts still support with an explicit next
 * action (follow up, or rebook a miss); `won` is NEVER implied by a completed
 * meeting — that call stays a human's.
 */
export const recordOutcome = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    bookingId: v.id("bookings"),
    expectedVersion: v.number(),
    outcome: v.union(v.literal("completed"), v.literal("no_show")),
    requestId: v.string(),
  },
  returns: vBookingDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const booking = await loadBookingForWrite(
      ctx,
      args.workspaceId,
      args.bookingId,
    );
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.workspaceId,
      `booking:${args.bookingId}:outcome:${requestId}`,
    );
    if (prior !== null) {
      if (booking.state !== args.outcome) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded outcome ${booking.state}`,
        );
      }
      return booking;
    }
    if (booking.state !== "confirmed") {
      throw domainError(
        "CONFLICT",
        `booking is ${booking.state}; only a confirmed meeting can record an outcome`,
      );
    }
    assertExpectedVersion(booking.version, args.expectedVersion, "booking");
    if (
      booking.startsAt === undefined ||
      booking.endsAt === undefined ||
      booking.timezone === undefined
    ) {
      // A confirmed booking carries its agreement — missing fields are a
      // schema violation, not a business case.
      throw invalid("confirmed booking is missing its agreed times");
    }
    const now = Date.now();
    if (now < booking.startsAt) {
      throw domainError(
        "CONFLICT",
        "the meeting has not started yet — an outcome is recorded after the scheduled start",
      );
    }
    const prospect = await loadProspect(
      ctx,
      args.workspaceId,
      booking.prospectId,
    );
    const inBookingStage = prospect.stage === "meeting_booked";
    const nextStage = inBookingStage
      ? await fallbackLeadStage(ctx, prospect)
      : prospect.stage;
    await ctx.db.patch("bookings", booking._id, {
      state: args.outcome,
      version: booking.version + 1,
      updatedAt: now,
    });
    await ctx.db.patch("prospects", prospect._id, {
      ...(inBookingStage
        ? {
            stage: nextStage,
            stageReason: boundedString(
              `Meeting ${args.outcome === "no_show" ? "no-show" : "completed"}`,
              "stageReason",
              { min: 1, max: PROSPECT_STAGE_REASON_MAX_LENGTH },
            ),
          }
        : {}),
      updatedAt: now,
    });
    await appendLeadEvent(ctx, {
      workspaceId: args.workspaceId,
      prospectId: prospect._id,
      kind: "booking_outcome_recorded",
      summary: `Meeting outcome recorded: ${args.outcome}`,
      operationKey: `booking:${booking._id}:outcome:${requestId}`,
      bookingId: booking._id,
      ...(inBookingStage && nextStage !== prospect.stage
        ? { fromStage: prospect.stage, toStage: nextStage }
        : {}),
      actor: { source: "human", identityKey },
      details: {
        reason: args.outcome === "completed" ? "meeting completed" : "no-show",
      },
    });
    const updated = await ctx.db.get("bookings", booking._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "booking not found after patch");
    }
    return updated;
  },
});
