/**
 * Onboarding dot 1 — the company we are selling FOR (references 01 and 02).
 *
 * The container for this step: it owns every Convex call on the screen, holds
 * the editable values, and hands presentational pieces what they need. The
 * profile and the credit balance are live queries, so the form fills itself in
 * while the analysis runs without this component polling anything.
 *
 * Four paths, all real (PLAN §5): analyze a website, skip it and type the
 * profile, retry a failure, or regenerate an existing profile for credits.
 */
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../../../convex/_generated/api"
import { ACTION_PRICES } from "../../../../../convex/lib/limits"
import { AiGeneratedBadge } from "@/components/kit/AiGeneratedBadge"
import { OnboardingShell } from "@/components/kit/OnboardingShell"
import Logo from "@/components/layout/Logo"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { AnalysisFailurePanel } from "@/components/onboarding/steps/company/AnalysisFailurePanel"
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
import { CompanyProfileForm } from "@/components/onboarding/steps/company/CompanyProfileForm"
import { WebsiteAnalyzeField } from "@/components/onboarding/steps/company/WebsiteAnalyzeField"
import { FormError } from "@/components/states/states"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage, isConflictError } from "@/lib/convex-error"

const ANALYSIS_CREDITS = ACTION_PRICES.analyze_website.credits

export function CompanyStep({
  orgId,
  progress,
  goNext,
  moving,
  moveError,
}: OnboardingStepProps) {
  const profile = useQuery(api.company.queries.get, { orgId })
  const balance = useQuery(api.billing.credits.balance, { orgId })
  const startAnalysis = useMutation(api.company.mutations.startAnalysis)
  const updateProfile = useMutation(api.company.mutations.update)

  const [form, setForm] = useState<CompanyForm>(EMPTY_COMPANY_FORM)
  const [website, setWebsite] = useState("")
  const [baseVersion, setBaseVersion] = useState(0)
  const [syncedAt, setSyncedAt] = useState(-1)
  const [formDirty, setFormDirty] = useState(false)
  const [websiteTyped, setWebsiteTyped] = useState(false)
  const [manual, setManual] = useState(false)
  const [saving, setSaving] = useState(false)
  const [startError, setStartError] = useState<AnalysisMessage | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Adopt the authoritative record whenever it changes underneath us — which
  // is how the analysis lands in the form — without overwriting whatever the
  // user is in the middle of typing.
  const recordAt = profile === undefined ? -1 : (profile?.updatedAt ?? 0)
  if (profile !== undefined && recordAt !== syncedAt) {
    setSyncedAt(recordAt)
    if (!formDirty) {
      setForm(profileToCompanyForm(profile))
      // The version moves with the values. A form the user is editing keeps
      // the version it STARTED from, so saving over a record that changed
      // underneath it is refused rather than silently winning.
      setBaseVersion(profile?.version ?? 0)
    }
    if (!websiteTyped) {
      setWebsite(profile?.websiteUrl ?? "")
    }
  }

  const status = profile?.analysisStatus ?? { state: "idle" as const }
  const analyzing = status.state === "analyzing"
  const analyzed = status.state === "ready"
  const hasProfile = profile !== null && profile !== undefined
  const showForm =
    manual || analyzed || (hasProfile && profile.companyName.trim() !== "")

  // Only a SUCCESSFUL analysis spends the free run, so the price the button
  // shows is read from that fact and not from how many times it was pressed.
  const price = profile?.firstRunUsed === true ? ANALYSIS_CREDITS : 0
  const blockedReason =
    balance === undefined || price === 0
      ? null
      : balance === null
        ? "This organization has no credit allowance, so website analysis can't run. You can still fill your profile in yourself."
        : balance.remaining < price
          ? `Another analysis costs ${price} credits and you have ${balance.remaining} left. Fill your profile in yourself to carry on.`
          : null

  const runAnalysis = async () => {
    setStartError(null)
    setWebsiteTyped(false)
    try {
      await startAnalysis({ orgId, websiteUrl: website })
    } catch (cause) {
      setStartError(startAnalysisCopy(cause))
    }
  }

  const saveProfile = async (): Promise<boolean> => {
    setSaving(true)
    setSaveError(null)
    try {
      await updateProfile({
        orgId,
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
      setFormDirty(false)
      return true
    } catch (cause) {
      if (isConflictError(cause)) {
        // The analysis (or another session) wrote while this form was open.
        // Drop the local edit AND force a resync, so the next render adopts
        // the authoritative record instead of re-submitting a stale version
        // forever.
        setFormDirty(false)
        setSyncedAt(-1)
        setSaveError(
          "Your profile changed while you were editing. The latest version is shown — check it and continue.",
        )
      } else {
        setSaveError(errorMessage(cause, "Could not save your company profile."))
      }
      return false
    } finally {
      setSaving(false)
    }
  }

  const complete = companyFormIsComplete(form)

  return (
    <OnboardingShell
      badge={
        analyzed ? (
          <AiGeneratedBadge label="Written from your website" />
        ) : null
      }
      currentDot={progress.dot}
      description="We read your website and write the profile your agent sells from. Every line stays yours to edit."
      dotCount={progress.dotCount}
      logo={<Logo markClassName="size-8" />}
      nextDisabled={!complete || analyzing || moving || saving}
      nextLoading={saving || moving}
      onNext={() => {
        void (async () => {
          if (await saveProfile()) {
            goNext()
          }
        })()
      }}
      step={progress.step}
      stepCount={progress.stepCount}
      stepperLabel="Setup progress"
      title="Create your first outreach agent"
    >
      <div className="flex flex-col gap-6">
        <WebsiteAnalyzeField
          analyzing={analyzing}
          blockedReason={blockedReason}
          intent={
            analyzed && sameWebsite(website, profile?.websiteUrl)
              ? "regenerate"
              : "analyze"
          }
          onAnalyze={() => void runAnalysis()}
          onChange={(next) => {
            setWebsiteTyped(true)
            setWebsite(next)
          }}
          price={price}
          value={website}
          {...(showForm || analyzing
            ? {}
            : { onSkip: () => setManual(true) })}
        />

        {startError !== null ? (
          <AnalysisFailurePanel
            message={startError}
            onRetry={() => void runAnalysis()}
            {...(showForm ? {} : { onFillManually: () => setManual(true) })}
          />
        ) : null}

        {status.state === "failed" ? (
          <AnalysisFailurePanel
            message={analysisFailureCopy(status.code)}
            onRetry={() => void runAnalysis()}
            retryDisabled={blockedReason !== null}
            {...(showForm ? {} : { onFillManually: () => setManual(true) })}
          />
        ) : null}

        {analyzing && !showForm ? <AnalyzingSkeleton /> : null}

        {showForm ? (
          <CompanyProfileForm
            disabled={analyzing}
            onChange={(patch) => {
              setFormDirty(true)
              setForm({ ...form, ...patch })
            }}
            value={form}
          />
        ) : null}

        <FormError message={saveError ?? moveError} />
        {showForm && !complete ? (
          <p className="text-sm text-muted-foreground">
            Add a company name, an industry, a description and at least one key
            feature to continue.
          </p>
        ) : null}
      </div>
    </OnboardingShell>
  )
}

/** The shape of the profile, while it is being written. Never a blank form
 *  presented as a result (PLAN §2 "no placeholders"). */
function AnalyzingSkeleton() {
  return (
    <div
      aria-live="polite"
      className="flex flex-col gap-5"
      role="status"
    >
      <span className="sr-only">Reading your website</span>
      <div className="grid gap-5 sm:grid-cols-2">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-28 rounded-2xl" />
    </div>
  )
}
