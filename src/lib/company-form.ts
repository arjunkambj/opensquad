import { COMPANY_INDUSTRIES } from "../../convex/ai/analyzeWebsite"
import type { Doc } from "../../convex/_generated/dataModel"
import {
  COMPANY_DESCRIPTION_MAX_LENGTH,
  COMPANY_LIST_MAX_ITEMS,
  COMPANY_NAME_MAX_LENGTH,
} from "../../convex/lib/validators"

export type CompanyForm = {
  companyName: string
  industry: string
  description: string
  keyFeatures: string[]
  socialProof: string[]
  /** Not edited here; kept so saving this step cannot erase dot 3's answer. */
  painPoints: string
}

export const EMPTY_COMPANY_FORM: CompanyForm = {
  companyName: "",
  industry: "",
  description: "",
  keyFeatures: [],
  socialProof: [],
  painPoints: "",
}

export function profileToCompanyForm(
  profile: Doc<"businessProfiles"> | null,
): CompanyForm {
  if (profile === null) {
    return EMPTY_COMPANY_FORM
  }
  return {
    companyName: profile.companyName,
    industry: profile.industry,
    description: profile.description,
    keyFeatures: [...profile.keyFeatures],
    socialProof: [...profile.socialProof],
    painPoints: profile.painPoints,
  }
}

/** Keep the client completeness check aligned with company/model.ts#profileIsComplete. */
export function companyFormIsComplete(form: CompanyForm): boolean {
  return (
    form.companyName.trim().length > 0 &&
    form.industry.trim().length > 0 &&
    form.description.trim().length > 0 &&
    form.keyFeatures.some((entry) => entry.trim().length > 0)
  )
}

export function cleanedList(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0)
}

/** Normalize addresses for button labels only. The server determines the actual price. */
export function sameWebsite(typed: string, stored: string | undefined): boolean {
  if (stored === undefined) {
    return false
  }
  const strip = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "")
  const left = strip(typed)
  return left !== "" && left === strip(stored)
}

export const COMPANY_FIELD_LIMITS = {
  name: COMPANY_NAME_MAX_LENGTH,
  description: COMPANY_DESCRIPTION_MAX_LENGTH,
  listItems: COMPANY_LIST_MAX_ITEMS,
} as const

/** Keep saved industries selectable even when they are no longer in the standard list. */
export function industryOptions(current: string): readonly string[] {
  return current !== "" &&
    !(COMPANY_INDUSTRIES as readonly string[]).includes(current)
    ? [current, ...COMPANY_INDUSTRIES]
    : COMPANY_INDUSTRIES
}
