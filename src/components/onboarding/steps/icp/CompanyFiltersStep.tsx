/**
 * Onboarding dot 2, screen 2 — the companies those people work at
 * (reference 07).
 *
 * Four groups, each with its own "All …" chip. Three of them draw on the lead
 * catalogue's allowed values and one on our own headcount bands; either way
 * every chip carries a value a search can use, which is why nothing on this
 * screen is typed (PLAN §3 step 2).
 *
 * Locations come back as the broad regions first and then the countries. The
 * regions are few and useful, so they are always on screen; a country is
 * reached through Add, and stays as a chip once it is picked.
 */
import { useQuery } from "convex/react"
import { api } from "../../../../../convex/_generated/api"
import { ICP_GROUP_MAX_ITEMS } from "../../../../../convex/agents/icpVocabulary"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { IcpChipGroup } from "@/components/onboarding/steps/icp/IcpChipGroup"
import { IcpStepShell } from "@/components/onboarding/steps/icp/IcpStepShell"
import { useIcpDraft } from "@/components/onboarding/steps/icp/use-icp-draft"
import { InfoBanner } from "@/components/kit/InfoBanner"
import { Skeleton } from "@/components/ui/skeleton"

/** A catalogue value is its own label: these are already plain words. */
function chips(values: readonly string[]) {
  return values.map((value) => ({ value, label: value }))
}

export function CompanyFiltersStep(props: OnboardingStepProps) {
  const draft = useIcpDraft(props.workspaceId, props.agent)
  const options = useQuery(api.agents.icp.options, {
    workspaceId: props.workspaceId,
  })
  const icp = draft.draft

  return (
    <IcpStepShell
      {...props}
      description="We pre-filled this from your website — adjust or add as you like. Leaving a group on “All” means we don't narrow by it."
      draft={draft}
      title="What kind of companies are you targeting?"
    >
      {options === undefined ? (
        <FiltersSkeleton />
      ) : (
        <div className="flex flex-col gap-6">
          {options.ready ? null : (
            <InfoBanner title="We can't offer industries, locations or company types yet.">
              The list we match them against hasn&rsquo;t loaded. Carry on — you
              can set these on your agent once it has.
            </InfoBanner>
          )}

          <IcpChipGroup
            addLabel="Add"
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
            addLabel="Add a country"
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

/** The shape of the four groups while the allowed values load. */
function FiltersSkeleton() {
  return (
    <div aria-live="polite" className="flex flex-col gap-6" role="status">
      <span className="sr-only">Loading the filters you can choose from</span>
      {[0, 1, 2, 3].map((group) => (
        <div className="flex flex-col gap-3" key={group}>
          <Skeleton className="h-3 w-24 rounded-full" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-32 rounded-xl" />
            <Skeleton className="h-9 w-28 rounded-xl" />
            <Skeleton className="h-9 w-40 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  )
}
