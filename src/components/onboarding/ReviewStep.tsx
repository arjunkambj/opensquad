import { useMutation } from "convex/react"
import { useRef, useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc } from "../../../convex/_generated/dataModel"
import type { SourceConfig } from "../../../convex/lib/validators"
import { FormError } from "@/components/states/states"
import {
  type CampaignScopeForm,
  buildSourceConfigs,
} from "@/components/onboarding/onboarding-model"
import { SourcePlanSummary } from "@/components/onboarding/SourcePlanSummary"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"
import { formatSendWindow } from "@/lib/workspace-time"

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  )
}

function stringArraysEqual(a: string[] | undefined, b: string[] | undefined) {
  const left = a ?? []
  const right = b ?? []
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  )
}

/**
 * True when a previously created campaign still matches what the form asks
 * for. `campaigns.create` dedupes on `requestId`, so a retry can return an
 * older draft; if the scope was edited in between we must NOT confirm the
 * stale draft — a fresh requestId creates the corrected campaign instead.
 * Compared semantically (not JSON.stringify) so key order can't lie.
 */
function campaignMatchesForm(
  campaign: Doc<"campaigns">,
  form: CampaignScopeForm,
  sources: SourceConfig[],
): boolean {
  if (
    campaign.title !== form.title.trim() ||
    campaign.brief !== form.brief.trim() ||
    campaign.sourcePlan.instruction !== form.instruction.trim() ||
    campaign.leadLimit !== form.leadLimit ||
    campaign.enrichmentLimit !== Number(form.enrichmentLimit) ||
    campaign.sourcePlan.sources.length !== sources.length
  ) {
    return false
  }
  return campaign.sourcePlan.sources.every((stored) => {
    const expected = sources.find((s) => s.source === stored.source)
    if (expected === undefined) {
      return false
    }
    if (stored.source === "apollo" && expected.source === "apollo") {
      return (
        stringArraysEqual(
          stored.filters.locations,
          expected.filters.locations,
        ) &&
        stringArraysEqual(
          stored.filters.categories,
          expected.filters.categories,
        ) &&
        (stored.filters.employeeCount?.min ?? undefined) ===
          (expected.filters.employeeCount?.min ?? undefined) &&
        (stored.filters.employeeCount?.max ?? undefined) ===
          (expected.filters.employeeCount?.max ?? undefined) &&
        (stored.maxResults ?? undefined) === (expected.maxResults ?? undefined)
      )
    }
    // yc/trustmrr are not offered by the form; a stored one never matches.
    return false
  })
}

/**
 * Step 4 — review and explicit confirmation. Renders the interpreted source
 * plan, prospect cap, enrichment allowance and send policy exactly as stored,
 * then on confirmation: create the draft campaign (idempotent requestId),
 * stamp `confirmSourcePlan`, and only then activate workspace automation
 * (which clears `pauseReason: "onboarding_pending"`).
 */
export function ReviewStep({
  workspace,
  profile,
  form,
  onBack,
  onComplete,
}: {
  workspace: Doc<"workspaces">
  profile: Doc<"businessProfiles"> | null
  form: CampaignScopeForm
  onBack: () => void
  onComplete: () => void
}) {
  const createCampaign = useMutation(api.campaigns.create)
  const confirmSourcePlan = useMutation(api.campaigns.confirmSourcePlan)
  const setAutomationState = useMutation(api.workspaces.setAutomationState)

  const requestIdRef = useRef<string>(crypto.randomUUID())
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sources = buildSourceConfigs(form)

  const confirm = async () => {
    setSaving(true)
    setError(null)
    try {
      let campaign = await createCampaign({
        workspaceId: workspace._id,
        title: form.title,
        brief: form.brief,
        sourcePlan: { instruction: form.instruction, sources },
        leadLimit: form.leadLimit,
        enrichmentLimit: Number(form.enrichmentLimit),
        requestId: requestIdRef.current,
      })

      // A replayed create may return a stale draft if the scope was edited
      // between attempts — never confirm a plan the owner is not looking at.
      if (!campaignMatchesForm(campaign, form, sources)) {
        requestIdRef.current = crypto.randomUUID()
        campaign = await createCampaign({
          workspaceId: workspace._id,
          title: form.title,
          brief: form.brief,
          sourcePlan: { instruction: form.instruction, sources },
          leadLimit: form.leadLimit,
          enrichmentLimit: Number(form.enrichmentLimit),
          requestId: requestIdRef.current,
        })
      }

      if (campaign.sourcePlan.confirmedBy === undefined) {
        try {
          await confirmSourcePlan({
            workspaceId: workspace._id,
            campaignId: campaign._id,
            expectedBriefVersion: campaign.briefVersion,
            sources,
          })
        } catch (cause) {
          // A retried confirm on an already-confirmed plan is idempotent
          // success — everything else propagates.
          const alreadyConfirmed =
            isConflictError(cause) &&
            errorMessage(cause, "").includes("already confirmed")
          if (!alreadyConfirmed) {
            throw cause
          }
        }
      }

      await setAutomationState({
        workspaceId: workspace._id,
        state: "active",
      })

      toast.add({
        title: "Setup complete",
        description: "Campaign scope confirmed and automation activated.",
        type: "success",
      })
      onComplete()
    } catch (cause) {
      if (isConflictError(cause)) {
        setError(
          `${errorMessage(cause, "This record changed in another session.")} Reload the page for the latest state, then confirm again.`,
        )
      } else {
        setError(errorMessage(cause, "Could not confirm the campaign plan."))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review and confirm</CardTitle>
        <CardDescription>
          This is exactly what the squad will work from. Nothing runs until you
          confirm — and confirming freezes this campaign's source scope.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div>
          <p className="pb-1 text-sm font-medium">Business profile</p>
          <SummaryRow
            label="Website"
            value={profile?.websiteUrl ?? "Not set"}
          />
          <SummaryRow label="Offer" value={profile?.offer ?? "Not set"} />
          <SummaryRow
            label="Ideal customer"
            value={profile?.idealCustomer ?? "Not set"}
          />
          <SummaryRow label="Tone" value={profile?.tone ?? "Not set"} />
          <SummaryRow
            label="Exclusions"
            value={
              profile !== null && profile.exclusions.length > 0
                ? profile.exclusions.join("; ")
                : "None"
            }
          />
        </div>
        <div>
          <p className="pb-1 text-sm font-medium">Workspace and send policy</p>
          <SummaryRow label="Workspace" value={workspace.name} />
          <SummaryRow label="Timezone" value={workspace.timezone} />
          <SummaryRow
            label="Send window"
            value={formatSendWindow(workspace.sendWindow)}
          />
          <SummaryRow
            label="Daily send limit"
            value={String(workspace.dailySendLimit)}
          />
        </div>
        <div>
          <p className="pb-1 text-sm font-medium">Campaign</p>
          <SummaryRow label="Title" value={form.title.trim() || "—"} />
          <SummaryRow label="Brief" value={form.brief.trim() || "—"} />
          <SummaryRow
            label="Prospect cap"
            value={`${form.leadLimit} accepted prospects`}
          />
          <SummaryRow
            label="Enrichment"
            value={`${form.enrichmentLimit || "0"} paid operations`}
          />
        </div>
        <div>
          <p className="pb-1 text-sm font-medium">Interpreted source plan</p>
          <p className="pb-2 text-sm text-muted-foreground">
            Instruction: “{form.instruction.trim() || "—"}”
          </p>
          <SourcePlanSummary sources={sources} />
        </div>

        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
            aria-label="Confirm interpreted scope"
          />
          <span>
            I confirm this scope: the squad may discover and research prospects
            within it. Sending still requires my approval per email, inside the
            send window above.
          </span>
        </label>

        <FormError message={error} />
        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack} disabled={saving}>
            Back
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={!confirmed || saving}
          >
            {saving ? <Spinner data-icon="inline-start" /> : null}
            Confirm scope and activate
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
