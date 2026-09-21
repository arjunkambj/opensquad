/**
 * Setup itself, once an organization is active in the auth provider.
 *
 * THERE IS NO ORGANIZATION SCREEN. The identity provider already gives every
 * account its own organization when it signs up, and it owns who belongs to
 * one; our org row is only what app data hangs off, so it is created silently
 * for whichever organization is active and the user is never asked to name,
 * choose or create one. What CAN stop that creation is a real condition with
 * a real answer, and `EntryRefusalState` puts words on each of those.
 */
import type { CurrentUser } from "@hexclave/react"
import { useMutation } from "convex/react"
import { useEffect, useRef, useState } from "react"
import { api } from "../../../convex/_generated/api"
import { AgentSetupFlow } from "@/components/onboarding/AgentSetupFlow"
import { EntryRefusalState } from "@/components/onboarding/EntryRefusalState"
import { entryRefusalOf } from "@/components/onboarding/onboarding-model"
import type { OnboardingEntryRefusal } from "@/components/onboarding/onboarding-model"
import { SetupFrame } from "@/components/onboarding/SetupFrame"
import { useMountedRef } from "@/hooks/use-mounted"
import { LoadingState } from "@/components/states/states"
import { useCurrentOrg } from "@/hooks/use-current-org"
import { detectLocalTimezone } from "@/lib/org-time"

/** The provider's organization name, as `ensureOrg` will accept it. */
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
    // The answer belongs to the ATTEMPT, not to this run of the effect: the
    // effect re-runs (its dependencies change identity, and StrictMode runs
    // it twice in development) while the request is still in flight, and the
    // re-run returns early above. A per-run "still live" flag would therefore
    // drop the refusal and leave the screen spinning forever.
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
      <SetupFrame>
        <LoadingState
          description="Checking your account and organization."
          title="Opening setup"
        />
      </SetupFrame>
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
      <SetupFrame>
        <LoadingState
          description="Setting up the organization your agent runs in."
          title="Just a moment"
        />
      </SetupFrame>
    )
  }

  return <AgentSetupFlow orgId={current.org._id} />
}
