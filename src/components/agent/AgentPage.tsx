/**
 * Agent — the one sales agent a workspace runs: its mode, the signals it
 * sources from, what it says and when it runs.
 *
 * This container owns the agent read and nothing else. The card itself —
 * funnel metrics, mode switch, signal table, instructions, Run now — is T32,
 * built against reference 21.
 */
import { useQuery } from "convex/react"
import { Link } from "@tanstack/react-router"
import { api } from "../../../convex/_generated/api"
import type { AgentMode } from "../../../convex/lib/validators"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { Chip } from "@/components/shared/presentation"
import { EmptyState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

/**
 * The modes in words, as a total map over the union: a mode added to
 * `convex/lib/validators/agents.ts` fails this build until it has a label.
 */
const MODE_LABEL: Record<AgentMode, string> = {
  sourcing_only: "Sourcing only",
  review: "Review before sending",
  autopilot: "Autopilot",
  paused: "Paused",
}

export function AgentPage() {
  const current = useCurrentWorkspace()
  const workspaceId =
    current !== undefined && current !== null
      ? current.workspace._id
      : undefined
  const agent = useQuery(
    api.agents.queries.get,
    workspaceId === undefined ? "skip" : { workspaceId },
  )

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Agent"
        description="Who it looks for, how much it may do on its own, and what it has been up to."
      />
      {agent === undefined ? (
        <LoadingState
          title="Loading your agent"
          description="Reading this workspace's agent."
        />
      ) : agent === null ? (
        <EmptyState
          title="No agent yet"
          description="Setup creates your agent from your website and the people you want to reach."
          action={<Button render={<Link to="/onboarding" />}>Finish setup</Button>}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {/* An unnamed draft agent is named by onboarding, never by a
                  fabricated placeholder here. */}
              {agent.name === "" ? "Your agent" : agent.name}
              <Chip>{MODE_LABEL[agent.mode]}</Chip>
            </CardTitle>
            <CardDescription>
              {agent.mode === "sourcing_only"
                ? "Finding and researching people, contacting nobody. Connect your inbox in Settings to start sending."
                : "Running on its own schedule. Every email it sends follows the mode above."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  )
}
