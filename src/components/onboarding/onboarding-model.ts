import type { Doc } from "../../../convex/_generated/dataModel"
import { minutesToTimeString } from "@/lib/workspace-time"

/**
 * Form models for the onboarding wizard. Values stay strings until submit so
 * inputs keep their natural editing behavior; parsing happens in the builders
 * below and the backend validators remain authoritative.
 */

export type BusinessProfileForm = {
  /** Optional: "I don't have a website" is a supported path (PLAN §5). */
  websiteUrl: string
  companyName: string
  industry: string
  description: string
  /** One feature per line; mapped to `keyFeatures: string[]` on save. */
  keyFeaturesText: string
  /** One proof per line; mapped to `socialProof: string[]` on save. */
  socialProofText: string
  painPoints: string
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

export function profileToForm(
  profile: Doc<"businessProfiles"> | null,
): BusinessProfileForm {
  return {
    websiteUrl: profile?.websiteUrl ?? "",
    companyName: profile?.companyName ?? "",
    industry: profile?.industry ?? "",
    description: profile?.description ?? "",
    keyFeaturesText: (profile?.keyFeatures ?? []).join("\n"),
    socialProofText: (profile?.socialProof ?? []).join("\n"),
    painPoints: profile?.painPoints ?? "",
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

/** Comma/semicolon-separated input → trimmed nonempty entries. */
export function splitListInput(value: string): string[] {
  return value
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}
