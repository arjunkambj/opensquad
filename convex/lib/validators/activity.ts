/**
 * Activity validators: the kinds of event the org feed records.
 */

/**
 * Activity kinds produced by the P10 correspondence/send modules. `kind` is a
 * bounded string in storage; producers keep to this list so P11/P13 can
 * formalize them later without a data migration.
 */
export const ACTIVITY_KINDS_P10 = [
  "draft_created",
  "draft_revised",
  "approval_recorded",
  "send_attempt_reserved",
  "send_attempt_dispatched",
  "send_attempt_acknowledged",
  "send_attempt_failed",
  "send_attempt_uncertain",
  "send_attempt_cancelled",
  "send_attempt_reconciled",
  "suppression_added",
  "suppression_removed",
  "delivery_receipt_applied",
  "delivery_receipt_parked",
  "conversation_thread_link_missed",
] as const;

export type ActivityKindP10 = (typeof ACTIVITY_KINDS_P10)[number];

/**
 * The four events the header bell exists for (PLAN §5: "a feed from
 * `activityEvents` (new reply, meeting booked, run finished, credits low)").
 *
 * They are listed apart from the P10/P11 module lists because they are a
 * PRODUCT promise rather than a module's receipt trail: the bell is specified
 * to show these, so each one has a writer helper in `activity/model.ts` and
 * exactly one call site. Same storage rule as the lists above — `kind` is a
 * bounded string and this is the single definition site.
 *
 *   reply_classified — a reply landed and the handler decided what it was.
 *   meeting_booked   — a proposal was confirmed (PLAN §9.5).
 *   run_finished     — an agent run ended and released its lease.
 *   credits_low      — the org's remaining credits crossed a low-water mark.
 */
export const ACTIVITY_KINDS_BELL = [
  "reply_classified",
  "meeting_booked",
  "run_finished",
  "credits_low",
] as const;

export type ActivityKindBell = (typeof ACTIVITY_KINDS_BELL)[number];
