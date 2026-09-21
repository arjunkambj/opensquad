import { useQuery } from "convex/react"
import { api } from "../../../../../convex/_generated/api"
import { ICP_GROUP_MAX_ITEMS } from "../../../../../convex/agents/icpVocabulary"
import { ChipInput } from "@/components/kit/ChipInput"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { IcpStepShell } from "@/components/onboarding/steps/icp/IcpStepShell"
import { useIcpDraft } from "@/components/onboarding/steps/icp/use-icp-draft"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { TextLine } from "@/components/onboarding/OnboardingSkeleton"
import { SkeletonRegion } from "@/components/states/skeletons"

export function ExclusionsStep(props: OnboardingStepProps) {
  const draft = useIcpDraft(props.orgId, props.agent)
  const options = useQuery(api.agents.icp.options, {
    orgId: props.orgId,
  })
  const icp = draft.draft

  return (
    <IcpStepShell
      {...props}
      description="Anyone matching these is never contacted."
      draft={draft}
      skeleton={<ExclusionsSkeleton label="Suggesting who to exclude" />}
      title="Who should we exclude?"
    >
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Profiles</p>
          {options === undefined ? (
            <SkeletonRegion label="Loading the exclusions" className="gap-3">
              <CheckboxRowSkeleton />
              <CheckboxRowSkeleton />
              <CheckboxRowSkeleton />
            </SkeletonRegion>
          ) : (
            <div className="flex flex-col gap-3">
              {options.excludeProfiles.map((option) => {
                const id = `exclude-${option.value}`
                return (
                  <Field key={option.value} orientation="horizontal">
                    <Checkbox
                      checked={icp.excludeProfiles.includes(option.value)}
                      id={id}
                      onCheckedChange={(checked) => {
                        draft.change({
                          excludeProfiles: checked
                            ? [...icp.excludeProfiles, option.value]
                            : icp.excludeProfiles.filter(
                                (value) => value !== option.value,
                              ),
                        })
                      }}
                    />
                    <FieldLabel htmlFor={id}>{option.label}</FieldLabel>
                  </Field>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">
            Companies and keywords
          </p>
          <ChipInput
            addLabel="Add more"
            inputAriaLabel="Add a company or keyword to avoid"
            maxCount={ICP_GROUP_MAX_ITEMS.excludeKeywords}
            onChange={(next) => {
              draft.change({ excludeKeywords: next })
            }}
            placeholder="e.g. a competitor's name"
            removeLabel={(value) => `Stop avoiding ${value}`}
            tone="neutral"
            values={icp.excludeKeywords}
          />
        </div>
      </div>
    </IcpStepShell>
  )
}

/** Mirrors the whole step while a run drafts it: the profile checkboxes, then the chip row. */
function ExclusionsSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="gap-8">
      <div className="flex flex-col gap-2">
        <TextLine className="w-16" />
        <div className="flex flex-col gap-3">
          <CheckboxRowSkeleton />
          <CheckboxRowSkeleton />
          <CheckboxRowSkeleton />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <TextLine className="w-44" />
        <div className="flex flex-wrap gap-2">
          <Skeleton shape="lg" className="h-8 w-32" />
          <Skeleton shape="lg" className="h-8 w-24" />
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** A horizontal `Field`: checkbox, then its label. */
function CheckboxRowSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <Skeleton shape="lg" className="size-4 shrink-0" />
      <TextLine className="w-48" />
    </div>
  )
}
