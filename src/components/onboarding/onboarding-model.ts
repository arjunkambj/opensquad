import type { Doc } from "../../../convex/_generated/dataModel"
import { minutesToTimeString } from "@/lib/workspace-time"

/**
 * Form models for the onboarding wizard. Values stay strings until submit so
 * inputs keep their natural editing behavior; parsing happens in the builders
 * below and the backend validators remain authoritative.
 */

export type BusinessProfileForm = {
  websiteUrl: string
  offer: string
  idealCustomer: string
  tone: string
  /** One exclusion per line; mapped to `exclusions: string[]` on save. */
  exclusionsText: string
}

export type WorkspacePolicyForm = {
  name: string
  timezone: string
  /** IANA weekday integers, 0 = Sunday … 6 = Saturday. */
  weekdays: number[]
  /** input[type=time] values. */
  startTime: string
  endTime: string
  dailySendLimit: string
}

export type CampaignScopeForm = {
  title: string
  brief: string
  /** 1–5 accepted prospects. */
  leadLimit: number
  /** Paid enrichment operations allowed for the campaign lifetime. */
  enrichmentLimit: string
}

export function profileToForm(
  profile: Doc<"businessProfiles"> | null,
): BusinessProfileForm {
  return {
    websiteUrl: profile?.websiteUrl ?? "",
    offer: profile?.offer ?? "",
    idealCustomer: profile?.idealCustomer ?? "",
    tone: profile?.tone ?? "",
    exclusionsText: (profile?.exclusions ?? []).join("\n"),
  }
}

export function workspaceToForm(
  workspace: Doc<"workspaces">,
  detectedTimezone: string,
): WorkspacePolicyForm {
  return {
    name: workspace.name,
    timezone:
      workspace.timezone === "UTC" && detectedTimezone !== ""
        ? detectedTimezone
        : workspace.timezone,
    weekdays: [...workspace.sendWindow.weekdays],
    startTime: minutesToTimeString(workspace.sendWindow.startMinute),
    endTime: minutesToTimeString(workspace.sendWindow.endMinute),
    dailySendLimit: String(workspace.dailySendLimit),
  }
}

export function defaultCampaignForm(): CampaignScopeForm {
  return {
    title: "",
    brief: "",
    leadLimit: 5,
    enrichmentLimit: "2",
  }
}

/** Comma/semicolon-separated input → trimmed nonempty entries. */
export function splitListInput(value: string): string[] {
  return value
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === "") {
    return undefined
  }
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) ? parsed : Number.NaN
}

/** Client-side sanity check mirror of the bounded-int fields. */
export function campaignFormProblems(form: CampaignScopeForm): string[] {
  const problems: string[] = []
  if (form.title.trim() === "") {
    problems.push("Campaign title is required.")
  }
  if (form.brief.trim() === "") {
    problems.push("Campaign brief is required.")
  }
  const enrichment = parseOptionalInt(form.enrichmentLimit)
  if (
    enrichment === undefined ||
    Number.isNaN(enrichment) ||
    enrichment < 0 ||
    enrichment > 10
  ) {
    problems.push("Enrichment allowance must be an integer between 0 and 10.")
  }
  return problems
}
