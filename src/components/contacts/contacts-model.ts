/** Map domain codes to user copy; provider messages are for operators only.
 * Keep trial-cap refusals distinct from an empty credit balance. */
import type { FunctionReturnType } from "convex/server"
import type { ContactsSearch } from "@/routes/_dashboard/_org/contacts"
import type { api } from "../../../convex/_generated/api"
import { domainErrorCode } from "@/lib/convex-error"
import type { DomainErrorCode } from "../../../convex/lib/errors"
import type {
  LeadApproval,
  LeadEmailStatus,
  LeadStage,
  OperationErrorCode,
} from "../../../convex/lib/validators"
import { withFilters } from "@/lib/search-params"

export type ContactRowData = FunctionReturnType<
  typeof api.leads.queries.list
>["items"][number]

export type ContactDetailData = FunctionReturnType<
  typeof api.leads.queries.getDetail
>

export const STAGE_LABEL: Record<LeadStage, string> = {
  found: "Found",
  researched: "Researched",
  queued: "Queued",
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  meeting_proposed: "Meeting proposed",
  meeting_booked: "Meeting booked",
  closed_lost: "Closed lost",
  rejected: "Rejected",
  needs_attention: "Needs attention",
}

export const APPROVAL_LABEL: Record<LeadApproval, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
}

export const EMAIL_STATE_LABEL: Record<LeadEmailStatus, string> = {
  locked: "Not found yet",
  revealing: "Finding…",
  found: "Found",
  not_found: "None on file",
}

export const LEAD_ERROR_COPY: Record<OperationErrorCode, string> = {
  rate_limited: "Research kept being throttled. Try again in a few minutes.",
  provider_unavailable: "Company research was unavailable. Try again.",
  unreadable_source: "We couldn't read this company's website.",
  not_found: "We found nothing to research for this company.",
  invalid_response: "Research came back unusable.",
  insufficient_credits: "Not enough credits to research this lead.",
  platform_paused: "Research is paused right now.",
  timeout: "Research timed out.",
  unknown: "Research failed.",
}

const REFUSAL_COPY: Record<DomainErrorCode, string> = {
  UNAUTHENTICATED: "Sign in again to continue.",
  FORBIDDEN: "That is not something this account can do.",
  NOT_FOUND: "That lead is no longer here.",
  CONFLICT: "That decision was already recorded.",
  INVALID: "That request could not be made.",
  ACCOUNT_RESTRICTED: "This account is not fully set up.",
  NO_ACTIVE_ORG: "Pick an organization to work in first.",
  TRIAL_CAPACITY_REACHED: "New organizations are at capacity right now.",
  NO_CREDIT_GRANT: "This organization has no credits.",
  INSUFFICIENT_CREDITS: "Not enough credits left for that.",
  // PLAN §6: the hidden provider cap, which is NOT the visible balance.
  TRIAL_LIMIT_REACHED: "Trial limit for emails reached.",
  PLATFORM_PAUSED: "Paid steps are paused right now.",
  PLATFORM_CAPACITY: "Lead work is at capacity today. Try again tomorrow.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
}

export function refusalCopy(error: unknown, fallback: string): string {
  const code = domainErrorCode(error)
  return code === undefined ? fallback : REFUSAL_COPY[code]
}

const SKIP_REASON_COPY: Record<string, string> = {
  already_found: "already has an address",
  in_flight: "already being looked up",
  no_address_on_file: "has no address on file",
  rejected: "was rejected",
  score_below_threshold: "scores below 2 — open the lead to ask for it anyway",
  credits: "is beyond what your credits cover",
  already_researched: "was already researched",
  provider_limit: "is beyond today's research allowance — try again tomorrow",
}

export function outcomeSummary(
  verb: string,
  result: {
    started: number
    skipped: readonly { reason: string }[]
    /** Count free un-parking separately from paid research so the result does not imply a no-op. */
    unparked?: number
  },
): string {
  const counts = new Map<string, number>()
  for (const skip of result.skipped) {
    counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1)
  }
  const reasons = [...counts.entries()].map(
    ([reason, count]) =>
      `${count} ${SKIP_REASON_COPY[reason] ?? "could not be included"}`,
  )
  const unparked = result.unparked ?? 0
  const queued =
    unparked === 0
      ? ""
      : ` ${unparked} ${unparked === 1 ? "lead was" : "leads were"} put back in the queue at no cost.`
  const head =
    result.started === 0
      ? unparked === 0
        ? `Nothing to ${verb}.`
        : `Nothing to ${verb}.${queued}`
      : `${verb} started for ${result.started} ${result.started === 1 ? "lead" : "leads"}.${queued}`
  return reasons.length === 0 ? head : `${head} Skipped: ${reasons.join(", ")}.`
}

export type SpendContext = {
  remaining: number | null
}

/** The client knows credit balance, not hidden provider allowances; the server reports those refusals. */
export function emailDisabledReason(
  lead: Pick<ContactRowData, "emailStatus" | "approval">,
  price: number,
  spend: SpendContext,
): string | null {
  if (lead.emailStatus === "found") {
    return "This lead already has an address."
  }
  if (lead.emailStatus === "revealing") {
    return "Already looking for this address."
  }
  if (lead.emailStatus === "not_found") {
    return "We looked and there is no address on file."
  }
  if (lead.approval === "rejected") {
    return "This lead was rejected."
  }
  if (spend.remaining !== null && spend.remaining < price) {
    return `Not enough credits — finding an email costs ${price}.`
  }
  return null
}

type ResearchState = {
  research: {
    status: "not_researched" | "researching" | "researched" | "failed"
  }
}

export function researchDisabledReason(
  lead: ResearchState & Pick<ContactRowData, "approval">,
  price: number,
  spend: SpendContext,
): string | null {
  if (lead.research.status === "researched") {
    return "This lead has already been researched."
  }
  if (lead.research.status === "researching") {
    return "Research is running for this lead."
  }
  if (lead.approval === "rejected") {
    return "This lead was rejected."
  }
  if (spend.remaining !== null && spend.remaining < price) {
    return `Not enough credits — researching a lead costs ${price}.`
  }
  return null
}

/** Retry is free for a researched lead parked by a later step; only unfinished research costs credits. */
export function retryAction(
  lead: ResearchState & Pick<ContactRowData, "approval">,
  price: number,
  spend: SpendContext,
): { price: number; disabled: string | null; label: string } {
  const free = lead.research.status === "researched"
  if (lead.approval === "rejected") {
    return { price: 0, disabled: "This lead was rejected.", label: "Retry" }
  }
  if (lead.research.status === "researching") {
    return {
      price: 0,
      disabled: "Research is running for this lead.",
      label: "Retry",
    }
  }
  if (free) {
    return { price: 0, disabled: null, label: "Put back in the queue" }
  }
  return {
    price,
    disabled:
      spend.remaining !== null && spend.remaining < price
        ? `Not enough credits — researching a lead costs ${price}.`
        : null,
    label: `Retry · ${price} credits`,
  }
}

export function decisionDisabledReason(
  lead: Pick<ContactRowData, "approval">,
  approval: LeadApproval,
): string | null {
  return lead.approval === approval
    ? `Already ${APPROVAL_LABEL[approval].toLowerCase()}.`
    : null
}

export function personName(lead: {
  firstName?: string
  lastName?: string
}): string {
  const parts = [lead.firstName, lead.lastName].filter(
    (part): part is string => part !== undefined && part.length > 0,
  )
  return parts.length > 0 ? parts.join(" ") : "Name locked"
}

/** Reset both cursor and page number whenever the filters change. */
export function withContactFilters(
  current: ContactsSearch,
  patch: Partial<ContactsSearch>,
): ContactsSearch {
  return withFilters(current, { ...patch, page: undefined })
}

export function exclusiveFilters(
  patch: Partial<ContactsSearch>,
): Partial<ContactsSearch> {
  return {
    stage: undefined,
    approval: undefined,
    score: undefined,
    ...patch,
  }
}
