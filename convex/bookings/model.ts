/**
 * Bookings — the §4.3/§5.5/§8 meeting lifecycle (P19).
 *
 * This domain owns the meeting a lead agrees to: its state machine
 * (`proposed | confirmed`), the one active
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
 *   Optimistic concurrency — confirmation takes `expectedVersion` against
 *   the booking row. Writes dedupe through the `leadEvents`
 *   (orgId, operationKey) index.
 *
 *   Lead + history stay in sync — every booking transition updates the lead's
 *   stage/next action and appends its `leadEvents` row in one transaction.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { domainError } from "../lib/validators";
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
