/**
 * The company form's own model: what the fields hold while they are being
 * edited, and what counts as filled in.
 *
 * Lists stay lists (the reference edits them as rows, not as text), and
 * `painPoints` is carried through untouched — it belongs to onboarding dot 3
 * and must survive a save from dot 1.
 */
import type { Doc } from "../../../../../convex/_generated/dataModel"

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

/**
 * The same rule `company/model.ts#profileIsComplete` enforces on the server,
 * so Next is disabled for the reason the server would refuse rather than
 * letting the user press it and read a refusal.
 */
export function companyFormIsComplete(form: CompanyForm): boolean {
  return (
    form.companyName.trim().length > 0 &&
    form.industry.trim().length > 0 &&
    form.description.trim().length > 0 &&
    form.keyFeatures.some((entry) => entry.trim().length > 0)
  )
}

/** Drop blank rows a user left behind before the values are saved. */
export function cleanedList(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0)
}

/**
 * Are these two addresses the same site, for the purpose of labelling the
 * button "Analyze" or "Regenerate"?
 *
 * A loose comparison on purpose: the stored value is the server's normalised
 * form (`https://acme.com/`) and the field usually holds what the user typed
 * (`acme.com`). It decides a LABEL, never a price — the server prices the run
 * from its own stored state.
 */
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
