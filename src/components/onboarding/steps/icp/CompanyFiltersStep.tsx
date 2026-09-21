import { useQuery } from "convex/react"
import { api } from "../../../../../convex/_generated/api"
import { ICP_GROUP_MAX_ITEMS } from "../../../../../convex/agents/icpVocabulary"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { IcpChipGroup } from "@/components/onboarding/steps/icp/IcpChipGroup"
import { IcpStepShell } from "@/components/onboarding/steps/icp/IcpStepShell"
import { useIcpDraft } from "@/components/onboarding/steps/icp/use-icp-draft"
import { InfoBanner } from "@/components/kit/InfoBanner"
import { TextLine } from "@/components/onboarding/OnboardingSkeleton"
import { SkeletonRegion } from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

function chips(values: readonly string[]) {
  return values.map((value) => ({ value, label: value }))
}

export function CompanyFiltersStep(props: OnboardingStepProps) {
  const draft = useIcpDraft(props.orgId, props.agent)
  const options = useQuery(api.agents.icp.options, {
    orgId: props.orgId,
  })
  const icp = draft.draft

  return (
    <IcpStepShell
      {...props}
      description="Leave a group on All to skip it."
      draft={draft}
      skeleton={<FiltersSkeleton label="Suggesting the companies to target" />}
      title="What kind of companies are you targeting?"
    >
      {options === undefined ? (
        <FiltersSkeleton label="Loading the filters you can choose from" />
      ) : (
        <div className="flex flex-col gap-8">
          {options.ready ? null : (
            <InfoBanner title="Filters aren't available yet. You can set them later." />
          )}

          <IcpChipGroup
            addLabel="Add more"
            allLabel="All industries"
            catalogue={chips(options.industries)}
            label="Industry"
            maxCount={ICP_GROUP_MAX_ITEMS.industries}
            onChange={(next) => {
              draft.change({ industries: next })
            }}
            options={[]}
            searchPlaceholder="Search industries"
            selected={icp.industries}
          />

          <IcpChipGroup
            addLabel="Add more"
            allLabel="All locations"
            catalogue={chips(options.locations)}
            label="Location"
            maxCount={ICP_GROUP_MAX_ITEMS.locations}
            onChange={(next) => {
              draft.change({ locations: next })
            }}
            options={chips(
              options.locations.slice(0, options.locationRegionCount),
            )}
            searchPlaceholder="Search countries"
            selected={icp.locations}
          />

          <IcpChipGroup
            allLabel="All company types"
            label="Company types"
            maxCount={ICP_GROUP_MAX_ITEMS.companyTypes}
            onChange={(next) => {
              draft.change({ companyTypes: next })
            }}
            options={chips(options.companyTypes)}
            selected={icp.companyTypes}
          />

          <IcpChipGroup
            allLabel="All company sizes"
            label="Company size"
            maxCount={ICP_GROUP_MAX_ITEMS.companySizes}
            onChange={(next) => {
              draft.change({ companySizes: next })
            }}
            options={options.companySizes}
            selected={icp.companySizes}
          />
        </div>
      )}
    </IcpStepShell>
  )
}

/** Mirrors the four `IcpChipGroup`s: a label over a row of chips. */
function FiltersSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="gap-8">
      {[0, 1, 2, 3].map((group) => (
        <div className="flex flex-col gap-2" key={group}>
          <TextLine className="w-24" />
          <div className="flex flex-wrap gap-2">
            <Skeleton shape="lg" className="h-8 w-32" />
            <Skeleton shape="lg" className="h-8 w-28" />
            <Skeleton shape="lg" className="h-8 w-40" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}
