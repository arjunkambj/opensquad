/**
 * Why the org could not be prepared, and what to do about it.
 *
 * Each refusal `orgs.ensureOrg` returns is a real condition with a real
 * answer (PLAN §6 "Closing the ways in"), so each gets a designed state here
 * rather than a raw error. The only live read is whether the trial has room
 * again, which decides if the waitlist state may offer Try again at all.
 */
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { OnboardingEntryRefusal } from "@/components/onboarding/onboarding-model"
import { SetupFrame } from "@/components/onboarding/SetupFrame"
import { EmptyState, ErrorState } from "@/components/states/states"
import { Button } from "@/components/ui/button"

export function EntryRefusalState({
  refusal,
  onRetry,
}: {
  refusal: OnboardingEntryRefusal
  onRetry: () => void
}) {
  const trial = useQuery(api.billing.queries.trialOpen, {})

  if (refusal === "ACCOUNT_RESTRICTED") {
    return (
      <SetupFrame>
        <EmptyState
          description="This account can't create an organization. If you think that's wrong, reply to the email you signed up with and we'll take a look."
          title="This account isn't ready yet"
        />
      </SetupFrame>
    )
  }

  if (refusal === "TRIAL_CAPACITY_REACHED") {
    return (
      <SetupFrame>
        <EmptyState
          action={
            trial?.open === true ? (
              <Button onClick={onRetry}>Try again</Button>
            ) : null
          }
          description="We run a fixed number of trials at a time so every agent has the room it needs. You're on the list — we'll email you the moment a place opens up."
          title="The trial is full right now"
        />
      </SetupFrame>
    )
  }

  return (
    <SetupFrame>
      <ErrorState
        description="We couldn't prepare your organization. Nothing was lost — try again."
        onRetry={onRetry}
        title="Setup couldn't start"
      />
    </SetupFrame>
  )
}
