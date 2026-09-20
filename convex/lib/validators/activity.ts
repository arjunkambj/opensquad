/**
 * Activity validators: the kinds of event the workspace feed records.
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
 * Activity kinds produced by the P11 inbound/reply modules. Same rule as the
 * P10 list: `kind` is a bounded string in storage and producers keep to this
 * list, which is the single definition site.
 */
export const ACTIVITY_KINDS_P11 = ["reply_classified"] as const;

export type ActivityKindP11 = (typeof ACTIVITY_KINDS_P11)[number];
