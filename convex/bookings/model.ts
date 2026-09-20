/**
 * Bookings — the §4.3/§5.5/§8 meeting lifecycle (P19).
 *
 * This domain owns the meeting a lead agrees to: its state machine
 * (`proposed | confirmed | cancelled | completed | no_show`), the one active
 * booking per lead, and the lead-stage and history writes each transition
 * makes. It owns no send of its own — a proposal goes out through outreach
 * like any other draft.
 *
 * INVARIANTS enforced inside the writing transaction:
 *
 *   One active booking per lead — at most one `proposed` or `confirmed` row,
 *   read through `by_prospectId_and_state` in the same transaction that
 *   creates or moves one.
 *
 *   Optimistic concurrency — every mutation takes `expectedVersion` against
 *   the booking row (`propose` takes the LEAD's version), and every one is
 *   idempotent through the `leadEvents` (orgId, operationKey) index.
 *
 *   Lead + history stay in sync — every booking transition updates the lead's
 *   stage/next action and appends its `leadEvents` row in one transaction.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  assertRequiredBookingTimes,
  DEFAULT_LIST_LIMIT,
  domainError,
  invalid,
} from "../lib/validators";
import type { LeadStage } from "../lib/validators";
import { bookingFields } from "../schema";
import { v } from "convex/values";

export const vBookingDoc = v.object({
  _id: v.id("bookings"),
  _creationTime: v.number(),
  ...bookingFields,
});

export const vListPage = v.object({
  items: v.array(vBookingDoc),
  cursor: v.union(v.string(), v.null()),
  hasMore: v.boolean(),
});

export async function loadBookingForWrite(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"orgs">,
  bookingId: Id<"bookings">,
): Promise<Doc<"bookings">> {
  const booking = await ctx.db.get("bookings", bookingId);
  if (booking === null || booking.orgId !== orgId) {
    throw domainError("NOT_FOUND", "booking not found");
  }
  return booking;
}

/** A lead's display label — a sourced row may carry no company name. */
export function leadLabel(prospect: Doc<"prospects">): string {
  return prospect.companyName ?? "this lead";
}

export async function loadProspect(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  prospectId: Id<"prospects">,
): Promise<Doc<"prospects">> {
  const prospect = await ctx.db.get("prospects", prospectId);
  if (prospect === null || prospect.orgId !== orgId) {
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
export async function fallbackLeadStage(
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
export async function retireLinkedDrafts(
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
      orgId: booking.orgId,
      draftId: draft._id,
      reason,
    });
  }
}

/** Validate the agreed-meeting triple every timed write shares (§5.5). */
export function assertAgreedTimes(
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
