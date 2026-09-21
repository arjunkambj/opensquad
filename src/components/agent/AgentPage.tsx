import { Link } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useCurrentOrg } from "@/hooks/use-current-org"
import { useMinuteClock } from "@/hooks/use-minute-clock"
import { AgentActivity } from "./AgentActivity"
import { AgentCard } from "./AgentCard"
import { AgentFunnelRow } from "./AgentFunnelRow"
import { AgentPageSkeleton } from "./AgentPageSkeleton"
import { AgentRunPanel } from "./AgentRunPanel"
import { InstructionsDialog } from "./InstructionsDialog"
import { NeedsAttentionCard } from "./NeedsAttentionCard"
import { agentFunnel } from "./agent-model"

export function AgentPage() {
  const current = useCurrentOrg()
  const org = current.status === "ready" ? current.org : undefined
  const orgId = org?._id
  const now = useMinuteClock()
  const skip = orgId === undefined ? "skip" : { orgId }

  const agent = useQuery(api.agents.queries.get, skip)
  const runState = useQuery(
    api.leads.counts.runState,
    orgId === undefined ? "skip" : { orgId, now },
  )
  const counts = useQuery(api.leads.counts.funnel, skip)

  const header = (
    <DashboardPageTitle
      title="Autopilot"
      description="How your agent works, and what it has done."
    />
  )

  if (current.status === "loading") {
    return <AgentPageSkeleton />
  }

  // This cannot normally reach here — the `_org` gate sends a caller with no
  // organization row to setup — but an honest state is cheaper than an
  // assertion. Checked BEFORE the agent: with no organization the agent query
  // is skipped, so waiting on it would be a skeleton that never resolves.
  if (org === undefined || orgId === undefined) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState
          title="No organization yet"
          description="Finish setup to create your agent."
          action={<Button render={<Link to="/onboarding" />}>Finish setup</Button>}
        />
      </div>
    )
  }

  if (agent === undefined) {
    return <AgentPageSkeleton />
  }

  if (agent === null || agent.status === "draft") {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState
          title={agent === null ? "No agent yet" : "Your agent is not live yet"}
          description="Setup builds the agent from your website and the people you want to reach. Finish it and the agent starts finding leads."
          action={<Button render={<Link to="/onboarding" />}>Finish setup</Button>}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Autopilot"
        description="How your agent works, and what it has done."
        actions={<InstructionsDialog agent={agent} />}
      />
      <AgentCard
        agent={agent}
        org={org}
        runPanel={
          <AgentRunPanel
            orgId={orgId}
            agentId={agent._id}
            timezone={org.timezone}
            runState={runState ?? undefined}
            now={now}
          />
        }
      />
      <AgentFunnelRow
        funnel={counts === undefined ? undefined : agentFunnel(counts)}
      />
      <NeedsAttentionCard orgId={orgId} now={now} />
      <AgentActivity orgId={orgId} timezone={org.timezone} />
    </div>
  )
}
