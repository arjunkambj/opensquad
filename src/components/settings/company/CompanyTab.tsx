/**
 * Settings → Company (reference 26, PLAN §5).
 *
 * The container for the tab: it owns every Convex call on the screen — the
 * profile, the credit balance, the analysis trigger and the save — and hands
 * the two cards below values and callbacks only.
 *
 * The analysis is live rather than awaited: `startAnalysis` schedules the
 * work and returns, and `businessProfiles.analysisStatus` is what the screen
 * reads, so the fields fill themselves in when it lands and a reload mid-run
 * still shows "analyzing".
 */
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { ACTION_PRICES } from "../../../../convex/lib/limits"
import {
  analysisFailureCopy,
  startAnalysisCopy,
} from "@/components/onboarding/steps/company/analysis-copy"
import type { AnalysisMessage } from "@/components/onboarding/steps/company/analysis-copy"
import {
  cleanedList,
  companyFormIsComplete,
  EMPTY_COMPANY_FORM,
  profileToCompanyForm,
  sameWebsite,
} from "@/components/onboarding/steps/company/company-form"
import type { CompanyForm } from "@/components/onboarding/steps/company/company-form"
import { CompanyProfileCard } from "@/components/settings/company/CompanyProfileCard"
import { CompanyWebsiteCard } from "@/components/settings/company/CompanyWebsiteCard"
import { LoadingState } from "@/components/states/states"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"
import { canEdit } from "@/lib/workspace-role"
import type { WorkspaceRole } from "@/lib/workspace-role"

const ANALYSIS_CREDITS = ACTION_PRICES.analyze_website.credits

export function CompanyTab({
  workspaceId,
  role,
}: {
  workspaceId: Id<"workspaces">
  role: WorkspaceRole
}) {
  const profile = useQuery(api.company.queries.get, { workspaceId })
  const balance = useQuery(api.billing.credits.balance, { workspaceId })
  const startAnalysis = useMutation(api.company.mutations.startAnalysis)
  const updateProfile = useMutation(api.company.mutations.update)

  const [form, setForm] = useState<CompanyForm>(EMPTY_COMPANY_FORM)
  const [website, setWebsite] = useState("")
  const [baseVersion, setBaseVersion] = useState(0)
  const [syncedAt, setSyncedAt] = useState(-1)
  const [dirty, setDirty] = useState(false)
  const [websiteTyped, setWebsiteTyped] = useState(false)
  const [saving, setSaving] = useState(false)
  const [startError, setStartError] = useState<AnalysisMessage | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Adopt the authoritative record whenever it changes underneath us — which
  // is how a finished analysis lands in the form — without overwriting what
  // the user is in the middle of typing.
  const recordAt = profile === undefined ? -1 : (profile?.updatedAt ?? 0)
  if (profile !== undefined && recordAt !== syncedAt) {
    setSyncedAt(recordAt)
    if (!dirty) {
      setForm(profileToCompanyForm(profile))
      // The version moves with the values. A form being edited keeps the
      // version it STARTED from, so saving over a record that changed
      // underneath it is refused rather than silently winning.
      setBaseVersion(profile?.version ?? 0)
    }
    if (!websiteTyped) {
      setWebsite(profile?.websiteUrl ?? "")
    }
  }

  if (profile === undefined) {
    return (
      <LoadingState
        title="Loading your company profile"
        description="Reading what your agent currently sells from."
      />
    )
  }

  const editable = canEdit(role)
  const status = profile?.analysisStatus ?? { state: "idle" as const }
  const analyzing = status.state === "analyzing"

  // Only a SUCCESSFUL analysis spends the free run, so the price the button
  // shows is read from that fact and not from how often it was pressed.
  const price = profile?.firstRunUsed === true ? ANALYSIS_CREDITS : 0
  const blockedReason = !editable
    ? "Re-analysing the website rewrites the company profile, which needs an owner or operator role."
    : balance === undefined || price === 0
      ? null
      : balance === null
        ? "This workspace has no credit allowance, so website analysis can't run. You can still edit the profile below."
        : balance.remaining < price
          ? `Another analysis costs ${price} credits and you have ${balance.remaining} left. You can still edit the profile below.`
          : null

  const runAnalysis = () => {
    setStartError(null)
    setWebsiteTyped(false)
    void startAnalysis({ workspaceId, websiteUrl: website }).catch((cause) => {
      setStartError(startAnalysisCopy(cause))
    })
  }

  const saveProfile = () => {
    setSaving(true)
    setSaveError(null)
    void updateProfile({
      workspaceId,
      expectedVersion: baseVersion,
      ...(profile?.websiteUrl !== undefined
        ? { websiteUrl: profile.websiteUrl }
        : {}),
      companyName: form.companyName,
      industry: form.industry,
      description: form.description,
      keyFeatures: cleanedList(form.keyFeatures),
      socialProof: cleanedList(form.socialProof),
      painPoints: form.painPoints,
    })
      .then(() => {
        setDirty(false)
        toast.add({ title: "Company profile saved", type: "success" })
      })
      .catch((cause) => {
        if (isConflictError(cause)) {
          // An analysis (or another session) wrote while this form was open.
          // Drop the local edit AND force a resync, so the next render adopts
          // the authoritative record instead of re-submitting a stale version
          // forever.
          setDirty(false)
          setSyncedAt(-1)
          setSaveError(
            "Your profile changed while you were editing. The latest version is shown — check it and save again.",
          )
        } else {
          setSaveError(
            errorMessage(cause, "Could not save your company profile."),
          )
        }
      })
      .finally(() => setSaving(false))
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <CompanyWebsiteCard
        analyzing={analyzing}
        blockedReason={blockedReason}
        failure={
          startError ??
          (status.state === "failed" ? analysisFailureCopy(status.code) : null)
        }
        intent={
          status.state === "ready" && sameWebsite(website, profile?.websiteUrl)
            ? "regenerate"
            : "analyze"
        }
        onAnalyze={runAnalysis}
        onWebsiteChange={(next) => {
          setWebsiteTyped(true)
          setWebsite(next)
        }}
        price={price}
        website={website}
      />
      <CompanyProfileCard
        analyzing={analyzing}
        canEdit={editable}
        complete={companyFormIsComplete(form)}
        dirty={dirty}
        error={saveError}
        onChange={(patch) => {
          setDirty(true)
          setForm({ ...form, ...patch })
        }}
        onSave={saveProfile}
        role={role}
        saving={saving}
        value={form}
      />
    </div>
  )
}
