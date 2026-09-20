/**
 * Onboarding dot 2, screen 3 — who to leave out (reference 08).
 *
 * Two different kinds of exclusion, and the screen keeps them apart because
 * they behave differently downstream: the profile options are a closed list
 * whose entries carry the words a search excludes, while competitors and
 * keywords really are just words the user knows and we do not.
 */
import { useQuery } from "convex/react"
import { InformationCircleIcon } from "@hugeicons/core-free-icons"
import { api } from "../../../../../convex/_generated/api"
import { ICP_GROUP_MAX_ITEMS } from "../../../../../convex/agents/icpModel"
import { CheckCard } from "@/components/kit/CheckCard"
import { ChipInput } from "@/components/kit/ChipInput"
import { InfoBanner } from "@/components/kit/InfoBanner"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { IcpStepShell } from "@/components/onboarding/steps/icp/IcpStepShell"
import { useIcpDraft } from "@/components/onboarding/steps/icp/use-icp-draft"
import { Skeleton } from "@/components/ui/skeleton"

export function ExclusionsStep(props: OnboardingStepProps) {
  const draft = useIcpDraft(props.workspaceId, props.agent)
  const options = useQuery(api.agents.icp.options, {
    workspaceId: props.workspaceId,
  })
  const icp = draft.draft

  return (
    <IcpStepShell
      {...props}
      description="We pre-filled this from your website — adjust or add as you like. Anyone matching these is left out of every search."
      draft={draft}
      title="Who should we exclude?"
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Exclude these profiles
          </p>
          {options === undefined ? (
            <div aria-live="polite" className="flex flex-col gap-2" role="status">
              <span className="sr-only">Loading the exclusions</span>
              <Skeleton className="h-14 rounded-2xl" />
              <Skeleton className="h-14 rounded-2xl" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {options.excludeProfiles.map((option) => (
                <CheckCard
                  checked={icp.excludeProfiles.includes(option.value)}
                  key={option.value}
                  onCheckedChange={(checked) => {
                    draft.change({
                      excludeProfiles: checked
                        ? [...icp.excludeProfiles, option.value]
                        : icp.excludeProfiles.filter(
                            (value) => value !== option.value,
                          ),
                    })
                  }}
                  title={option.label}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Companies &amp; keywords to avoid
          </p>
          <ChipInput
            addLabel="Add"
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
          <InfoBanner icon={InformationCircleIcon} tone="plain">
            Nobody at these companies, and nobody whose profile mentions these
            words, is ever contacted.
          </InfoBanner>
        </div>
      </div>
    </IcpStepShell>
  )
}
