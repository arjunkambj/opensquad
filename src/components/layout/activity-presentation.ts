/**
 * Activity kinds in words and icons, for the notification feed.
 *
 * The map is a TOTAL `Record` over the backend's kind union, so adding a kind
 * to `convex/lib/validators/activity.ts` fails this build until someone
 * decides how it should read. Storage keeps `kind` as a bounded string, so an
 * event written by an older or newer deployment still renders — through the
 * neutral fallback, never dropped and never mislabelled.
 *
 * Wording is white-label (PLAN §4): the user reads what happened, never which
 * company we bought it from.
 */
import {
  Alert02Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  InformationCircleIcon,
  Mail01Icon,
  MailSend01Icon,
  Message01Icon,
  PencilEdit02Icon,
  Unlink01Icon,
  UserBlock01Icon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import type {
  ActivityKindP10,
  ActivityKindP11,
} from "../../../convex/lib/validators"

export type ActivityKind = ActivityKindP10 | ActivityKindP11

export type ActivityPresentation = {
  label: string
  icon: IconSvgElement
}

const KIND_PRESENTATION: Record<ActivityKind, ActivityPresentation> = {
  draft_created: { label: "Email drafted", icon: PencilEdit02Icon },
  draft_revised: { label: "Draft rewritten", icon: PencilEdit02Icon },
  approval_recorded: { label: "Email approved", icon: CheckmarkCircle02Icon },
  send_attempt_reserved: { label: "Send queued", icon: Clock01Icon },
  send_attempt_dispatched: { label: "Email sent", icon: MailSend01Icon },
  send_attempt_acknowledged: {
    label: "Send confirmed",
    icon: CheckmarkCircle02Icon,
  },
  send_attempt_failed: { label: "Send failed", icon: Alert02Icon },
  send_attempt_uncertain: { label: "Send unconfirmed", icon: Alert02Icon },
  send_attempt_cancelled: { label: "Send cancelled", icon: CancelCircleIcon },
  send_attempt_reconciled: { label: "Send reconciled", icon: Mail01Icon },
  suppression_added: { label: "Address blocked", icon: UserBlock01Icon },
  suppression_removed: { label: "Address unblocked", icon: UserCircleIcon },
  delivery_receipt_applied: { label: "Delivery update", icon: Mail01Icon },
  delivery_receipt_parked: {
    label: "Delivery update held",
    icon: Clock01Icon,
  },
  conversation_thread_link_missed: {
    label: "Unmatched message",
    icon: Unlink01Icon,
  },
  reply_classified: { label: "New reply", icon: Message01Icon },
}

const UNKNOWN_KIND: ActivityPresentation = {
  label: "Activity",
  icon: InformationCircleIcon,
}

/** The stored kind is a bounded string; anything unmapped reads neutrally. */
export function activityPresentation(kind: string): ActivityPresentation {
  return KIND_PRESENTATION[kind as ActivityKind] ?? UNKNOWN_KIND
}
