/**
 * Onboarding dot 2, screen 1 — the people to reach (reference 06).
 *
 * Job titles are the one ICP list that really is free text: the lead search
 * matches titles by contains, not against a closed vocabulary, so a title the
 * user types is as good as one we generated. Hence a plain `ChipInput` here
 * and a searched picker on the next screen.
 */
import { ICP_GROUP_MAX_ITEMS } from "../../../../../convex/agents/icpModel"
import { ChipInput } from "@/components/kit/ChipInput"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { IcpStepShell } from "@/components/onboarding/steps/icp/IcpStepShell"
import { useIcpDraft } from "@/components/onboarding/steps/icp/use-icp-draft"

export function JobTitlesStep(props: OnboardingStepProps) {
  const draft = useIcpDraft(props.workspaceId, props.agent)
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
