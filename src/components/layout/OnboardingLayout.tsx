import { useUser } from "@hexclave/react"
import { Navigate } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { Suspense } from "react"
import type { ReactNode } from "react"
import { api } from "../../../convex/_generated/api"
import Logo from "@/components/layout/Logo"
import { OnboardingPage } from "@/components/onboarding/OnboardingPage"
import { LoadingState } from "@/components/states/states"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

/**
 * The full-screen setup frame (PLAN §5, reference 01): logo, a soft warm
 * ground, and the stepper centred on it. No sidebar, no credits block, no
 * notifications — none of them has anything true to say before a workspace
 * and an agent exist.
 *
 * It also holds the guard that belongs to this route: a user whose agent
 * already reads `onboardingStep: "done"` is finished, and opening
 * `/onboarding` again sends them to the dashboard instead of offering to redo
 * setup. Everyone else stays, and the wizard resumes at the saved step.
 */
export function OnboardingLayout() {
  return (
    <Suspense fallback={<OnboardingFrame>{null}</OnboardingFrame>}>
      <AuthedOnboarding />
    </Suspense>
  )
}

function AuthedOnboarding() {
  // Suspends until the session resolves, and bounces a signed-out visitor to
  // sign-in — setup is not a public page.
  useUser({ or: "redirect" })
  const current = useCurrentWorkspace()
  const workspaceId =
    current !== undefined && current !== null
      ? current.workspace._id
      : undefined
  const agent = useQuery(
    api.agents.queries.get,
    workspaceId === undefined ? "skip" : { workspaceId },
  )

  if (current === undefined || (workspaceId !== undefined && agent === undefined)) {
    return (
      <OnboardingFrame>
        <LoadingState
          title="Loading setup"
          description="Checking how far you got."
        />
      </OnboardingFrame>
    )
  }

  if (agent !== undefined && agent !== null && agent.onboardingStep === "done") {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <OnboardingFrame>
      <OnboardingPage />
    </OnboardingFrame>
  )
}

function OnboardingFrame({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <div className="flex min-h-dvh flex-col items-center bg-linear-to-b from-accent/70 via-background to-background px-4 py-10 sm:px-6">
        <Logo className="mb-8" markClassName="size-8" />
        <main className="flex w-full max-w-3xl flex-col gap-6">{children}</main>
      </div>
    </TooltipProvider>
  )
}
