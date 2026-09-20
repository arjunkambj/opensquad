/**
 * Setup — the full-screen four-dot flow (PLAN §5, §11 M1, references 01–11).
 *
 * This is the container for every dot. It does three things and delegates the
 * rest: it makes sure the workspace record exists, it reads how far the user
 * got, and it renders the screen that belongs to that step.
 *
 * THERE IS NO WORKSPACE OR TEAM SCREEN. The identity provider already gives
 * every account its own team when it signs up; our workspace row is only what
 * app data hangs off, so it is created silently on first entry and the user is
 * never asked to name, choose or create one. What CAN stop that creation is a
 * real condition with a real answer — an unverified email, a restricted
 * account, a full trial — and each of those gets a designed state here rather
 * than a raw error.
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
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { domainErrorCode } from "@/lib/convex-error"
import { detectLocalTimezone } from "@/lib/workspace-time"

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
  const current = useCurrentWorkspace()
  const ensureWorkspace = useMutation(api.workspaces.mutations.ensureWorkspace)
  const [refusal, setRefusal] = useState<OnboardingEntryRefusal | null>(null)
  const [attempt, setAttempt] = useState(0)
  // One creation request per attempt: the mutation is idempotent, but firing
  // it on every render would still be a request per render.
  const requested = useRef(-1)

  useEffect(() => {
    if (current !== null || requested.current === attempt) {
      return
    }
    requested.current = attempt
    let live = true
    void (async () => {
      try {
        await ensureWorkspace({ timezone: detectLocalTimezone() })
      } catch (cause) {
        if (live) {
          setRefusal(entryRefusalOf(cause))
        }
      }
    })()
    return () => {
      live = false
    }
  }, [attempt, current, ensureWorkspace])

  if (current === undefined) {
    return (
      <SetupFrame>
        <LoadingState
          description="Checking your account and workspace."
          title="Opening setup"
        />
      </SetupFrame>
    )
  }

  if (current === null) {
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
          description="Setting up the workspace your agent runs in."
          title="Just a moment"
        />
      </SetupFrame>
    )
  }

  if (current.role === "viewer") {
    return (
      <SetupFrame>
        <EmptyState
          description="Setup writes the company profile and activates the agent, which read-only access cannot do. An owner or operator in this workspace can finish it."
          title="You have read-only access to this workspace"
        />
      </SetupFrame>
    )
  }

  return <AgentFlow workspaceId={current.workspace._id} />
}

/** Why the workspace could not be prepared, and what to do about it. */
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
          description="This account can't create a workspace. If you think that's wrong, reply to the email you signed up with and we'll take a look."
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
        description="We couldn't prepare your workspace. Nothing was lost — try again."
        onRetry={onRetry}
        title="Setup couldn't start"
      />
    </SetupFrame>
  )
}

/** The step the agent row says the user is on. */
function AgentFlow({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const agent = useQuery(api.agents.queries.get, { workspaceId })
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
          description="This workspace has no agent to set up, which shouldn't happen. Reload the page and we'll try again."
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

  const entry = ONBOARDING_STEP_REGISTRY[agent.onboardingStep]
  if (entry === undefined) {
    return (
      <SetupFrame>
        <ErrorState
          description="This part of setup isn't available in your version of the app yet. Reload to pick up the latest one."
          onRetry={() => window.location.reload()}
          retryLabel="Reload"
          title="We can't open this step"
        />
      </SetupFrame>
    )
  }

  const move = async (step: OnboardingStep) => {
    setMoving(true)
    setMoveError(null)
    try {
      await setStep({ workspaceId, step })
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
      workspaceId={workspaceId}
      {...(backward === null
        ? {}
        : { goBack: () => void move(backward) })}
    />
  )
}
