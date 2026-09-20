/**
 * Onboarding — the setup wizard: the workspace, the business and what the
 * squad may do before anything runs.
 *
 * Each step owns its own save; the wizard owns which step is current and
 * derives the starting step from what is already saved.
 */
import { ArrowRight01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc } from "../../../convex/_generated/dataModel"
import {
  EmptyState,
  ErrorState,
  FormError,
  LoadingState,
} from "@/components/states/states"
import { BusinessStep } from "@/components/onboarding/BusinessStep"
import { WorkspaceStep } from "@/components/onboarding/WorkspaceStep"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { errorMessage } from "@/lib/convex-error"
import { detectLocalTimezone } from "@/lib/workspace-time"
import { cn } from "@/lib/utils"

const STEPS = [
  { id: "business", label: "Company" },
  { id: "workspace", label: "Workspace & policy" },
] as const

export type StepId = (typeof STEPS)[number]["id"]

/** The step ids, for the route's `?step=` validator. */
export const STEP_IDS = STEPS.map((entry) => entry.id) as readonly StepId[]

/**
 * First-run setup: provision the workspace (if needed), save the company
 * profile and the workspace timezone/send policy, then create the workspace's
 * one draft agent.
 *
 * This is the pre-pivot wizard reduced to what the new model still needs. The
 * real onboarding — the four-dot stepper of PLAN §11 M1, website analysis,
 * ICP, inbox connection and signals — is T20 through T23.
 */
export function OnboardingWizard() {
  const current = useCurrentWorkspace()

  if (current === undefined) {
    return (
      <LoadingState
        title="Loading workspace"
        description="Checking your account and workspace membership."
      />
    )
  }

  if (current === null) {
    return (
      <div className="flex w-full max-w-3xl flex-col gap-6">
        {/* The rail renders on the provisioning screen too — setup is one
            continuous task, and a bare card here read as a different flow. */}
        <StepRail current={null} onGo={undefined} />
        <ProvisionWorkspace />
      </div>
    )
  }

  if (current.role !== "owner") {
    return (
      <EmptyState
        title="Only the workspace owner can complete setup"
        description="Onboarding changes the send policy and activates automation, which are owner-only controls. Ask your workspace owner to finish setup."
      />
    )
  }

  return <WizardSteps workspace={current.workspace} />
}

/** Explicit, idempotent workspace creation — the only way in for a new user. */
function ProvisionWorkspace() {
  const ensureWorkspace = useMutation(api.workspaces.mutations.ensureWorkspace)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const provision = async () => {
    setPending(true)
    setError(null)
    try {
      await ensureWorkspace({ timezone: detectLocalTimezone() })
      // getCurrent reactively returns the new workspace; the wizard continues.
    } catch (cause) {
      setError(errorMessage(cause, "Could not create your workspace."))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader>
        <CardTitle>Create your workspace</CardTitle>
        <CardDescription>
          One workspace for your outbound, plus a conservative send policy you
          confirm next.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error !== null ? (
          <ErrorState
            title="Could not create the workspace"
            description={error}
            onRetry={() => void provision()}
          />
        ) : null}
        <Button onClick={() => void provision()} disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Create workspace
        </Button>
      </CardContent>
    </Card>
  )
}

function WizardSteps({ workspace }: { workspace: Doc<"workspaces"> }) {
  const profile = useQuery(api.company.queries.get, {
    workspaceId: workspace._id,
  })
  const search = useSearch({ from: "/onboarding" })
  const navigate = useNavigate()
  // No `?step=` means derive the start from what is already saved — a reload
  // or a fresh arrival resumes instead of restarting at step one. The
  // profile's existence is the only durable per-step marker: the workspace
  // step can complete with no version bump (accepting every default writes
  // nothing), so the honest resume point after a saved profile is the
  // workspace step itself.
  const step: StepId = search.step ?? (profile ? "workspace" : "business")
  const agent = useQuery(api.agents.queries.get, { workspaceId: workspace._id })
  const createAgent = useMutation(api.agents.mutations.createDraft)
  const [completed, setCompleted] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)

  /**
   * Finish setup by creating the workspace's one agent.
   *
   * A workspace has exactly one agent and `createDraft` refuses a second, so
   * finishing again on a workspace that already has one is a no-op here
   * rather than a refusal the user has to read.
   */
  const finish = async () => {
    if (agent === undefined) {
      return
    }
    if (agent !== null) {
      setCompleted(true)
      return
    }
    setFinishing(true)
    setFinishError(null)
    try {
      await createAgent({ workspaceId: workspace._id })
      setCompleted(true)
    } catch (cause) {
      setFinishError(errorMessage(cause, "Could not create your agent."))
    } finally {
      setFinishing(false)
    }
  }

  if (profile === undefined) {
    return (
      <LoadingState
        title="Loading profile"
        description="Reading your saved business profile."
      />
    )
  }

  if (completed) {
    return (
      <Card className="mx-auto w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              strokeWidth={2}
              className="size-5"
              aria-hidden="true"
            />
            Setup complete
          </CardTitle>
          <CardDescription>
            Your agent exists and starts in sourcing-only mode: it finds and
            researches leads and contacts nobody until you connect an inbox.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button render={<Link to="/contacts" />}>
            Go to Leads
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              data-icon="inline-end"
              strokeWidth={2}
            />
          </Button>
          <Button variant="outline" render={<Link to="/inbox" />}>
            Open the inbox
          </Button>
        </CardContent>
      </Card>
    )
  }

  // `replace` — the wizard is one task, so Back should leave setup rather than
  // walk the user backwards through every step they already completed.
  const go = (id: StepId) => {
    void navigate({ to: "/onboarding", search: { step: id }, replace: true })
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      {workspace.automationState === "active" ? (
        <p className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Setup was already completed for this workspace. Saving updates your
          profile and policy; finishing again returns the agent you already
          have.
        </p>
      ) : null}
      <StepRail current={step} onGo={go} />

      {step === "business" ? (
        <BusinessStep
          workspaceId={workspace._id}
          profile={profile}
          onDone={() => go("workspace")}
        />
      ) : null}
      {step === "workspace" ? (
        <>
          <WorkspaceStep workspace={workspace} onDone={() => void finish()} />
          <FormError message={finishError} />
          {finishing ? (
            <LoadingState
              title="Creating your agent"
              description="Setting up the one agent this workspace runs."
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/**
 * The step rail, rendered on every setup screen including provisioning
 * (`current: null`). A bare card before a workspace exists read as a
 * different flow entirely — the rail keeps it visibly inside one sequence.
 * While provisioning, it gains a leading "Create workspace" entry; once a
 * workspace exists that step is always complete and never appears again.
 *
 * Only past steps are reachable: a step ahead of the current one may need
 * input the user has not given yet, so future entries render inert.
 */
function StepRail({
  current,
  onGo,
}: {
  current: StepId | null
  onGo?: (id: StepId) => void
}) {
  const entries: readonly { id: string; label: string }[] =
    current === null
      ? [{ id: "provision", label: "Create workspace" }, ...STEPS]
      : STEPS
  const stepIndex = entries.findIndex((entry) => entry.id === current)

  return (
    <nav aria-label="Onboarding steps">
      <ol className="flex flex-wrap gap-2">
        {entries.map((entry, index) => {
          const isCurrent = index === stepIndex
          const isPast = index < stepIndex
          const reachable =
            isPast && onGo !== undefined && entry.id !== "provision"
          return (
            <li key={entry.id}>
              <button
                type="button"
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => {
                  if (reachable) {
                    onGo(entry.id as StepId)
                  }
                }}
                className={cn(
                  "flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-sm",
                  isCurrent
                    ? "border-primary bg-primary/5 font-medium"
                    : isPast
                      ? "border-border text-muted-foreground hover:text-foreground"
                      : "cursor-default border-border text-muted-foreground/60",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 place-content-center rounded-full text-xs",
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted",
                  )}
                >
                  {index + 1}
                </span>
                {entry.label}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
