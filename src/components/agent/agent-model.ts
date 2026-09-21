/**
 * The vocabulary of the Agent screen: the words for every mode, signal kind
 * and refusal, and the two derivations the card's figures come from.
 *
 * Data-free — no Convex calls, no React. Every `Record` below is total over a
 * union taken from the backend, so a mode, a signal kind or a refusal added in
 * `convex/` fails this build until someone writes copy for it.
 */
import type { FunctionReturnType } from "convex/server"
import { ConvexError } from "convex/values"
import type { api } from "../../../convex/_generated/api"
import type {
  AgentMode,
  OperationErrorCode,
  SignalKind,
} from "../../../convex/lib/validators"
import { errorMessage } from "@/lib/convex-error"

export type AgentDoc = NonNullable<
  FunctionReturnType<typeof api.agents.queries.get>
>

export type RunState = NonNullable<
  FunctionReturnType<typeof api.leads.counts.runState>
>

export type FunnelCounts = FunctionReturnType<typeof api.leads.counts.funnel>

export type StrategyRow = FunctionReturnType<
  typeof api.leads.counts.byStrategy
>[number]

export type ModeRefusal = Extract<
  FunctionReturnType<typeof api.agents.settingsMode.setMode>,
  { ok: false }
>["reason"]

export type RunNowReason = FunctionReturnType<
  typeof api.agents.settingsRun.runNow
>["reason"]

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

export const MODE_LABEL: Record<AgentMode, string> = {
  sourcing_only: "Sourcing only",
  review: "Review",
  autopilot: "Autopilot",
  paused: "Paused",
}

/** One line per mode, as the dropdown shows it (PLAN §9.3's matrix in words). */
export const MODE_DESCRIPTION: Record<AgentMode, string> = {
  sourcing_only: "Finds and researches people. Sends nothing.",
  review:
    "Finds the address once you approve a lead, writes the email, and waits for you to send it.",
  autopilot:
    "Approves, finds addresses, sends and replies on its own, inside your daily limits.",
  paused: "Starts nothing new. Everything already found stays where it is.",
}

export const SIGNAL_KIND_LABEL: Record<SignalKind, string> = {
  core_icp: "Best-fit roles",
  funded: "Recently funded",
  hiring: "Hiring",
  growth: "Growing fast",
  ad_spend: "Spending on ads",
  tech: "Uses a tool",
  team_shape: "Team shape",
  keyword: "Keyword match",
}

/** Our words for a failed step, mapped from the code the lead carries. */
export const OPERATION_ERROR_COPY: Record<OperationErrorCode, string> = {
  rate_limited: "We were throttled repeatedly while working this lead.",
  provider_unavailable: "The research service did not answer.",
  unreadable_source: "We could not read this company's website.",
  not_found: "There was nothing to research for this company.",
  invalid_response: "The research came back unusable.",
  insufficient_credits: "There were not enough credits to finish this lead.",
  platform_paused: "Automated work was paused while this lead was in flight.",
  timeout: "The step timed out.",
  unknown: "The step failed repeatedly.",
}

export const MODE_REFUSAL_COPY: Record<ModeRefusal, string> = {
  inbox_not_connected:
    "Connect your sending inbox before switching to a mode that sends.",
  consent_required: "Autopilot needs your authorisation first.",
  consent_stale:
    "Your agent changed while the dialog was open. Review what Autopilot will do and accept again.",
}

/** What "Run now" did. `started` is the only one that needs no sentence. */
export const RUN_NOW_COPY: Record<RunNowReason, string> = {
  started: "Run started.",
  already_running: "Already running — this run will finish on its own.",
  not_live: "Finish setup before running the agent.",
  not_found: "This organization has no agent yet.",
}

/**
 * Our words for a THROWN refusal.
 *
 * The backend's own message is written for operators and logs — the rate
 * limiter's, for instance, names the internal bucket — so it is never
 * rendered for a code we recognise. Anything else falls back to the shared
 * reader, which is still better than a blank line.
 */
export function agentErrorCopy(error: unknown, fallback: string): string {
  const code =
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data
      ? (error.data as { code: unknown }).code
      : undefined
  switch (code) {
    case "RATE_LIMITED":
      return "That was a lot of requests in a row. Wait a moment and try again."
    case "FORBIDDEN":
      return "This account can't change the agent."
    case "UNAUTHENTICATED":
      return "Your session expired. Sign in again to change the agent."
    case "NOT_FOUND":
      return "That record is no longer here. Reload the page."
    case "CONFLICT":
      return "Something changed while you were working. Reload the page and try again."
    case "INVALID":
      return errorMessage(error, fallback)
    default:
      return errorMessage(error, fallback)
  }
}

/* ------------------------------------------------------------------ */
/* Figures                                                             */
/* ------------------------------------------------------------------ */

export type AgentFunnel = {
  total: number
  contacted: number
  replied: number
  interested: number
  /** True when any count hit the query's bound, so the figures read "100+". */
  bounded: boolean
}

/**
 * The card's three figures, from the stage counts (PLAN §2, reference 21).
 *
 * A lead's stage moves FORWARD through the pipeline, so everyone sitting past
 * `contacted` was contacted and everyone past `replied` replied — that is what
 * makes a funnel readable from one stage column. `closed_lost` sits outside
 * that order, so it counts towards the total and towards nothing else; we
 * cannot tell from the stage alone how far it got.
 *
 * There is NO "Opened" figure here, and there is no zero or dash standing in
 * for one: PLAN §9.6 says the metric appears only once open events are
 * verified, and this build does not have them.
 */
export function agentFunnel(counts: FunnelCounts): AgentFunnel {
  const { stages } = counts
  const sum = (...parts: { count: number }[]) =>
    parts.reduce((total, part) => total + part.count, 0)
  return {
    // The denominator of "contacted out of total", so it counts the leads
    // the funnel can still act on. Rejected and closed-lost leads have left
    // it — including them made every rate read lower than it is, and got
    // worse the longer the agent ran.
    total: sum(
      stages.queued,
      stages.researched,
      stages.found,
      stages.needs_attention,
      stages.contacted,
      stages.replied,
      stages.interested,
      stages.meeting_proposed,
      stages.meeting_booked,
    ),
    contacted: sum(
      stages.contacted,
      stages.replied,
      stages.interested,
      stages.meeting_proposed,
      stages.meeting_booked,
    ),
    replied: sum(
      stages.replied,
      stages.interested,
      stages.meeting_proposed,
      stages.meeting_booked,
    ),
    interested: sum(
      stages.interested,
      stages.meeting_proposed,
      stages.meeting_booked,
    ),
    // Every stage, including the two the total leaves out: if any count hit
    // its bound the card is reading a partial table, whatever the totals say.
    bounded: Object.values(stages).some((part) => part.hasMore),
  }
}

/**
 * A share of the leads found, or `null` when there is nothing to divide by.
 * A rate over zero leads is not zero percent, it is unknown, and the card
 * renders an em dash for it.
 */
export function ratePercent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100)
}

/**
 * A calendar day in the ORG's timezone — the card's "Created on …".
 * The org zone, not the reader's, because every date this product
 * states is evaluated there.
 */
export function formatDay(at: number, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: timezone,
  }).format(at)
}

/** The follow-up ladder in words. Each step is counted from the mail before
 *  it, which is how the outreach loop schedules them. */
export function followUpSummary(days: readonly number[]): string {
  if (days.length === 0) {
    return "No follow-ups — the agent emails once and stops."
  }
  const parts = days.map((day) => (day === 1 ? "1 day" : `${day} days`))
  return `Follow-up ${parts.join(", then ")} after the previous email.`
}
