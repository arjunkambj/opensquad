/**
 * The words the Contacts screen puts on a lead's state — one place, so a new
 * stage, refusal or skip reason fails the build until it has copy.
 *
 * Two of these maps carry rules rather than labels:
 *
 *   `refusalCopy` is PLAN §6's distinction, made once: an org can hold
 *   credits it is no longer allowed to spend, so the hidden trial cap says
 *   "Trial limit for emails reached" and an empty balance says "out of
 *   credits". Every paid button on this screen reports through it.
 *
 *   `LEAD_ERROR_COPY` turns the backend's error CODE into a sentence. The
 *   code is the contract (`convex/lib/errors.ts`); the message beside it is
 *   for operators and logs, and never reaches a user.
 */
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

/** One table row, as the backend projects it (`convex/leads/rows.ts`). */
export type ContactRowData = FunctionReturnType<
  typeof api.leads.queries.list
>["items"][number]

/** The drawer's lead, with the prose the row leaves out. */
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

/** What we know about the address, in the user's words. */
export const EMAIL_STATE_LABEL: Record<LeadEmailStatus, string> = {
  locked: "Not found yet",
  revealing: "Finding…",
  found: "Found",
  not_found: "None on file",
}

/** Why a lead stopped, as the Retry button explains it. */
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

/** The one mapping from a backend refusal to what the screen says. */
export function refusalCopy(error: unknown, fallback: string): string {
  const code = domainErrorCode(error)
  return code === undefined ? fallback : REFUSAL_COPY[code]
}

/** Why a lead in a selection was left out of a paid action. */
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

/**
 * One sentence for what a bulk action actually did. Honest about the leads it
 * left out: a button that silently does less than it was asked to is the
 * failure this exists to prevent.
 */
export function outcomeSummary(
  verb: string,
  result: {
    started: number
    skipped: readonly { reason: string }[]
    /**
     * Leads that were only un-parked — already researched, so they cost
     * nothing and start no new work. Counted separately because "started for
     * 0 leads" would read as a no-op on a button that did something.
     */
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

/** What the screen knows about the caller's ability to spend. */
export type SpendContext = {
  /** Credits left, or `null` while the balance is still being read. */
  remaining: number | null
}

/**
 * Why Get email cannot run for this lead, or `null` when it can.
 *
 * The visible balance is the only money fact a client may know: the hidden
 * per-org provider allowance is server-side (PLAN §6), so a trial that
 * has used its emails up is reported by the refusal, not predicted here.
 */
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

/** The research state both the row and the drawer's lead carry. */
type ResearchState = {
  research: {
    status: "not_researched" | "researching" | "researched" | "failed"
  }
}

/** Why Research cannot run for this lead, or `null` when it can. */
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

/**
 * What Retry costs for a parked lead, and why it cannot run.
 *
 * Retry on a parked lead means two different things depending on whether the
 * research it is retrying already happened. A lead that was scored and then
 * parked by a LATER step only needs un-parking — the server does that for
 * free — so charging for it, or greying the button out because
 * `researchDisabledReason` says it is "already researched", both lie about
 * what the button does. A parked lead with no research yet is the paid case.
 */
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

/** Why a decision cannot be recorded for this lead, or `null` when it can. */
export function decisionDisabledReason(
  lead: Pick<ContactRowData, "approval">,
  approval: LeadApproval,
): string | null {
  return lead.approval === approval
    ? `Already ${APPROVAL_LABEL[approval].toLowerCase()}.`
    : null
}

/** The person's name as the source gave it — a masked surname stays masked. */
export function personName(lead: {
  firstName?: string
  lastName?: string
}): string {
  const parts = [lead.firstName, lead.lastName].filter(
    (part): part is string => part !== undefined && part.length > 0,
  )
  return parts.length > 0 ? parts.join(" ") : "Name locked"
}

/**
 * A filter change: drop the cursor AND the page it counted, because page two
 * of one query is not page two of another.
 */
export function withContactFilters(
  current: ContactsSearch,
  patch: Partial<ContactsSearch>,
): ContactsSearch {
  return withFilters(current, { ...patch, page: undefined })
}

/** The one list mode the table is in — the three filters are exclusive. */
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
