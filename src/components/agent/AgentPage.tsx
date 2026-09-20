/**
 * `/agent` — the one sales agent an organization runs: what it looks for, how
 * much it may do on its own, and what it has been up to (reference 21, plus
 * reference 25's per-signal table).
 *
 * There is no agent list and no "Create an agent": an organization has
 * exactly one agent, created with its row and filled in by setup, so the page
 * opens straight on it (PLAN §2).
 *
 * This container owns every Convex read on the screen; each card below owns
 * its own writes. Three honest states come first — still reading, no agent at
 * all, and an agent setup has not finished — because none of the controls
 * below means anything until there is a live agent to point them at.
 */
import { Link } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import { InboxConnectionBanner } from "@/components/inbox-connection/InboxConnectionBanner"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { EmptyState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useCurrentOrg } from "@/hooks/use-current-org"
import { AgentCard } from "./AgentCard"
import { AgentRunPanel } from "./AgentRunPanel"
import { InstructionsCard } from "./InstructionsCard"
import { NeedsAttentionCard } from "./NeedsAttentionCard"
import { OutreachDetailsCard } from "./OutreachDetailsCard"
import { SignalsCard } from "./SignalsCard"
import { agentFunnel } from "./agent-model"

export function AgentPage() {
  const current = useCurrentOrg()
  const org = current.status === "ready" ? current.org : undefined
  const orgId = org?._id
  const skip = orgId === undefined ? "skip" : { orgId }

  const agent = useQuery(api.agents.queries.get, skip)
  const runState = useQuery(api.leads.counts.runState, skip)
  const strategies = useQuery(api.leads.counts.byStrategy, skip)
  const counts = useQuery(api.leads.counts.funnel, skip)

  const header = (
    <DashboardPageTitle
      title="Agent"
      description="Who it looks for, how much it may do on its own, and what it has been up to."
    />
  )

  if (current.status === "loading" || agent === undefined) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <LoadingState
          title="Loading your agent"
          description="Reading this organization's agent."
        />
      </div>
    )
  }

  // This cannot normally reach here — the `_org` gate sends a caller with no
  // organization row to setup — but an honest state is cheaper than an
  // assertion.
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
      {header}
      <InboxConnectionBanner orgId={orgId} />
      <AgentCard
        agent={agent}
        org={org}
        funnel={counts === undefined ? undefined : agentFunnel(counts)}
      />
      <AgentRunPanel
        orgId={orgId}
        agentId={agent._id}
        timezone={org.timezone}
        runState={runState ?? undefined}
      />
      <NeedsAttentionCard orgId={orgId} />
      <SignalsCard orgId={orgId} strategies={strategies} />
      <InstructionsCard agent={agent} />
      <OutreachDetailsCard agent={agent} />
    </div>
  )
}
