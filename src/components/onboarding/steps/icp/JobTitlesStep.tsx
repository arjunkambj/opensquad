/** Job titles support free-text matching; other ICP fields require catalogue values. */
import { ICP_GROUP_MAX_ITEMS } from "../../../../../convex/agents/icpVocabulary"
import { ChipInput } from "@/components/kit/ChipInput"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { IcpStepShell } from "@/components/onboarding/steps/icp/IcpStepShell"
import { useIcpDraft } from "@/components/onboarding/steps/icp/use-icp-draft"

export function JobTitlesStep(props: OnboardingStepProps) {
  const draft = useIcpDraft(props.orgId, props.agent)
  const jobTitles = draft.draft.jobTitles

  return (
    <IcpStepShell
      {...props}
      description={
        <>
          We pre-filled this from your website — adjust or add as you like. We
          match similar titles automatically, so there is no need to be
          exhaustive.
        </>
      }
      draft={draft}
      hint="Add at least one job title so your agent knows who to look for."
      nextDisabled={jobTitles.length === 0}
      title="Who's your ideal customer?"
    >
      <ChipInput
        addLabel="Add"
        inputAriaLabel="Add a job title"
        maxCount={ICP_GROUP_MAX_ITEMS.jobTitles}
        onChange={(next) => {
          draft.change({ jobTitles: next })
        }}
        placeholder="e.g. Head of Growth"
        removeLabel={(value) => `Remove ${value}`}
        values={jobTitles}
      />
    </IcpStepShell>
  )
}
