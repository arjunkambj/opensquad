/**
 * Setup — the full-screen four-dot flow (PLAN §5, §11 M1, references 01–11).
 *
 * This is the container for every dot. It does three things and delegates the
 * rest: it makes sure the org record exists, it reads how far the user
 * got, and it renders the screen that belongs to that step.
 *
 * THERE IS NO ORGANIZATION SCREEN. The identity provider already gives every
 * account its own organization when it signs up, and it owns who belongs to
 * one; our org row is only what app data hangs off, so it is created silently
 * for whichever organization is active and the user is never asked to name,
 * choose or create one. What CAN stop that creation is a real condition with
 * a real answer — an unverified email, a restricted account, a full trial —
 * and each of those gets a designed state here rather than a raw error.
 *
 * Progress lives on the agent row, so a refresh resumes on the same screen and
 * the browser holds nothing that could disagree with the server.
 */
import { useUser } from "@hexclave/react"
import type { CurrentUser } from "@hexclave/react"
import { Navigate } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { Suspense, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import type { OnboardingStep } from "../../../convex/lib/validators"
import { OrgBoundary } from "@/components/auth/OrgBoundary"
import { OnboardingShell } from "@/components/kit/OnboardingShell"
import Logo from "@/components/layout/Logo"
import {
  entryRefusalOf,
  nextOnboardingStep,
  ONBOARDING_DOT_COUNT,
  ONBOARDING_STEP_REGISTRY,
  previousOnboardingStep,
} from "@/components/onboarding/onboarding-model"
import type { OnboardingEntryRefusal } from "@/components/onboarding/onboarding-model"
import { EmptyState, ErrorState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useCurrentOrg } from "@/hooks/use-current-org"
import { domainErrorCode } from "@/lib/convex-error"
import { detectLocalTimezone } from "@/lib/org-time"

export function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <SetupFrame>
          <LoadingState
            description="One moment while we check your account."
            title="Opening setup"
          />
        </SetupFrame>
      }
    >
      <SetupFlow />
    </Suspense>
  )
}

/** The provider's organization name, as `ensureOrg` will accept it. */
function boundedOrgName(displayName: string | null | undefined): string | null {
  const trimmed = (displayName ?? "").trim().slice(0, 100)
  return trimmed.length === 0 ? null : trimmed
}

/** The frame every pre-step state sits in, so setup never changes shape. */
function SetupFrame({ children }: { children: ReactNode }) {
  return (
    <OnboardingShell
      currentDot={1}
      description="Four short steps, and your agent starts finding leads."
      dotCount={ONBOARDING_DOT_COUNT}
      logo={<Logo markClassName="size-8" />}
      stepperLabel="Setup progress"
      title="Set up your agent"
    >
      {children}
    </OnboardingShell>
  )
}

function SetupFlow() {
  // Suspends until the session resolves, and bounces a signed-out visitor to
  // sign-in — setup is not a public page.
  const user = useUser({ or: "redirect" })

  return (
    <OrgBoundary
      user={user}
      fallback={
        <SetupFrame>
          <LoadingState
            description="Opening the organization your agent runs in."
            title="Just a moment"
          />
        </SetupFrame>
      }
    >
      {/* Keyed by the organization: switching one must start setup over
          rather than carry the previous one's "already asked for a row". */}
      <SetupForActiveOrg key={user.selectedTeam?.id} user={user} />
    </OrgBoundary>
  )
}

/** Setup itself, once an organization is active in the auth provider. */
function SetupForActiveOrg({ user }: { user: CurrentUser }) {
  const current = useCurrentOrg()
  const ensureOrg = useMutation(api.orgs.mutations.ensureOrg)
  const [refusal, setRefusal] = useState<OnboardingEntryRefusal | null>(null)
  const [attempt, setAttempt] = useState(0)
  // One creation request per attempt: the mutation is idempotent, but firing
  // it on every render would still be a request per render.
  const requested = useRef(-1)
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
    let live = true
    void (async () => {
      try {
        await ensureOrg({
          timezone: detectLocalTimezone(),
          ...(orgName === null ? {} : { name: orgName }),
        })
      } catch (cause) {
        if (live) {
          setRefusal(entryRefusalOf(cause))
        }
      }
    })()
    return () => {
      live = false
    }
  }, [attempt, current, ensureOrg, orgName])

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
          user={user}
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

  return <AgentFlow orgId={current.org._id} />
}

/** Why the org could not be prepared, and what to do about it. */
function EntryRefusalState({
  refusal,
  user,
  onRetry,
}: {
  refusal: OnboardingEntryRefusal
  user: CurrentUser
  onRetry: () => void
}) {
  const trial = useQuery(api.billing.queries.trialOpen, {})
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  if (refusal === "EMAIL_NOT_VERIFIED") {
    const resend = async () => {
      setSending(true)
      setSendError(null)
      try {
        const channels = await user.listContactChannels()
        const target =
          channels.find((channel) => channel.isPrimary && !channel.isVerified) ??
          channels.find((channel) => !channel.isVerified)
        if (target === undefined) {
          // Nothing left to verify here — the token just has not caught up.
          onRetry()
          return
        }
        await target.sendVerificationEmail({ callbackUrl: window.location.href })
        setSent(true)
      } catch {
        setSendError("We couldn't send that email. Try again in a moment.")
      } finally {
        setSending(false)
      }
    }
    return (
      <SetupFrame>
        <EmptyState
          action={
            <div className="flex flex-col items-center gap-2">
              <div className="flex flex-wrap justify-center gap-2">
                <Button disabled={sending} onClick={() => void resend()}>
                  {sent ? "Send it again" : "Resend the email"}
                </Button>
                <Button onClick={onRetry} variant="outline">
                  I&rsquo;ve verified it
                </Button>
              </div>
              {sent ? (
                <p className="text-sm text-muted-foreground">
                  Sent. Open the link, then come back and continue.
                </p>
              ) : null}
              {sendError !== null ? (
                <p className="text-sm text-destructive" role="alert">
                  {sendError}
                </p>
              ) : null}
            </div>
          }
          description="Your agent sends email on your behalf, so we confirm the address is yours before anything is created. Open the link we sent you, then come back."
          title="Verify your email to continue"
        />
      </SetupFrame>
    )
  }

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

/** The step the agent row says the user is on. */
function AgentFlow({ orgId }: { orgId: Id<"orgs"> }) {
  const agent = useQuery(api.agents.queries.get, { orgId })
  const setStep = useMutation(api.agents.onboarding.setStep)
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

  if (agent === undefined) {
    return (
      <SetupFrame>
        <LoadingState
          description="Picking up where you left off."
          title="Loading your setup"
        />
      </SetupFrame>
    )
  }

  if (agent === null) {
    return (
      <SetupFrame>
        <ErrorState
          description="This organization has no agent to set up, which shouldn't happen. Reload the page and we'll try again."
          onRetry={() => window.location.reload()}
          retryLabel="Reload"
          title="Your agent is missing"
        />
      </SetupFrame>
    )
  }

  if (agent.onboardingStep === "done") {
    return <Navigate replace to="/dashboard" />
  }

  // Every step but `done` has a screen, and the registry's type says so — a
  // step added without one fails the build rather than reaching a user.
  const entry = ONBOARDING_STEP_REGISTRY[agent.onboardingStep]

  const move = async (step: OnboardingStep) => {
    setMoving(true)
    setMoveError(null)
    try {
      await setStep({ orgId, step })
    } catch (cause) {
      setMoveError(
        domainErrorCode(cause) === "INVALID"
          ? "Finish this step before moving on."
          : "We couldn't save your progress. Try that again.",
      )
    } finally {
      setMoving(false)
    }
  }

  const forward = nextOnboardingStep(agent.onboardingStep)
  const backward = previousOnboardingStep(agent.onboardingStep)
  const StepScreen = entry.Component

  return (
    <StepScreen
      agent={agent}
      goNext={() => {
        if (forward !== null) {
          void move(forward)
        }
      }}
      moveError={moveError}
      moving={moving}
      progress={{
        dot: entry.dot,
        dotCount: ONBOARDING_DOT_COUNT,
        step: entry.stepInDot,
        stepCount: entry.stepsInDot,
      }}
      orgId={orgId}
      {...(backward === null
        ? {}
        : { goBack: () => void move(backward) })}
    />
  )
}
