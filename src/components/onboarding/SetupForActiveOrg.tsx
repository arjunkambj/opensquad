/** Provision app data for the auth provider's active organization; the provider owns organization creation. */
import type { CurrentUser } from "@hexclave/react"
import { useMutation } from "convex/react"
import { useEffect, useRef, useState } from "react"
import { api } from "../../../convex/_generated/api"
import { AgentSetupFlow } from "@/components/onboarding/AgentSetupFlow"
import { EntryRefusalState } from "@/components/onboarding/EntryRefusalState"
import { entryRefusalOf } from "@/components/onboarding/onboarding-model"
import type { OnboardingEntryRefusal } from "@/components/onboarding/onboarding-model"
import { OnboardingSkeleton } from "@/components/onboarding/OnboardingSkeleton"
import { useMountedRef } from "@/hooks/use-mounted"
import { useCurrentOrg } from "@/hooks/use-current-org"
import { detectLocalTimezone } from "@/lib/org-time"

function boundedOrgName(displayName: string | null | undefined): string | null {
  const trimmed = (displayName ?? "").trim().slice(0, 100)
  return trimmed.length === 0 ? null : trimmed
}

export function SetupForActiveOrg({ user }: { user: CurrentUser }) {
  const current = useCurrentOrg()
  const ensureOrg = useMutation(api.orgs.mutations.ensureOrg)
  const [refusal, setRefusal] = useState<OnboardingEntryRefusal | null>(null)
  const [attempt, setAttempt] = useState(0)
  // One creation request per attempt: the mutation is idempotent, but firing
  // it on every render would still be a request per render.
  const requested = useRef(-1)
  const mounted = useMountedRef()
  // The row is named after the organization it belongs to, so the name a
  // member sees here is the one they chose in the auth provider. Trimmed and
  // bounded to what the mutation accepts: a name the provider allows but we
  // do not must not turn setup into an error screen.
  const orgName = boundedOrgName(user.selectedTeam?.displayName)

  useEffect(() => {
    if (current.status !== "not_initialised" || requested.current === attempt) {
      return
    }
    requested.current = attempt
    // Track request attempts across effect reruns; per-effect cleanup would discard in-flight refusals.
    void (async () => {
      try {
        await ensureOrg({
          timezone: detectLocalTimezone(),
          ...(orgName === null ? {} : { name: orgName }),
        })
      } catch (cause) {
        if (mounted.current && requested.current === attempt) {
          setRefusal(entryRefusalOf(cause))
        }
      }
    })()
  }, [attempt, current, ensureOrg, mounted, orgName])

  if (current.status === "loading") {
    return (
      <OnboardingSkeleton label="Checking your account and organization" />
    )
  }

  if (current.status !== "ready") {
    if (refusal !== null) {
      return (
        <EntryRefusalState
          onRetry={() => {
            setRefusal(null)
            setAttempt((value) => value + 1)
          }}
          refusal={refusal}
        />
      )
    }
    return (
      <OnboardingSkeleton label="Setting up the organization your agent runs in" />
    )
  }

  return <AgentSetupFlow orgId={current.org._id} />
}
