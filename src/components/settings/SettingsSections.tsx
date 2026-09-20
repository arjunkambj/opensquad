/**
 * Settings — company, inbox, outreach, blocklist, sending and usage.
 *
 * One card set per tab, chosen by the route's `?tab=` contract. Account is
 * the only tab that is not workspace-scoped, and the page renders it itself.
 */
import { Link } from "@tanstack/react-router"
import type { SettingsTab } from "@/components/settings/settings-model"
import { AutomationSection } from "@/components/settings/AutomationSection"
import { IntegrationsSection } from "@/components/settings/IntegrationsSection"
import { SendingPolicySection } from "@/components/settings/SendingPolicySection"
import { SuppressionsSection } from "@/components/settings/SuppressionsSection"
import { UsageSection } from "@/components/settings/UsageSection"
import { WorkspaceSection } from "@/components/settings/WorkspaceSection"
import { EmptyState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

/**
 * One workspace-backed settings tab at a time — the `?tab=` deep link is the
 * contract a policy-blocked send relies on, so each tab is individually
 * addressable rather than one long stack. Loading, missing-workspace and
 * role-gated states stay explicit; every control here is backed by a real
 * mutation.
 */
export function SettingsSections({ tab }: { tab: SettingsTab }) {
  const current = useCurrentWorkspace()

  if (current === undefined) {
    return (
      <LoadingState
        title="Loading workspace settings"
        description="Reading your workspace, policy and blocklist."
      />
    )
  }

  if (current === null) {
    return (
      <EmptyState
        title="No workspace yet"
        description="Finish setup to create your workspace and configure it."
        action={<Button render={<Link to="/onboarding" />}>Start setup</Button>}
      />
    )
  }

  const { workspace, role } = current
  const isOwner = role === "owner"

  switch (tab) {
    case "company":
      return <WorkspaceSection workspace={workspace} isOwner={isOwner} />
    case "inbox":
      // T22 replaces this with the connect/verify/sync flow of PLAN §4; until
      // then it reports the inbox this workspace actually holds.
      return <IntegrationsSection workspace={workspace} isOwner={isOwner} />
    case "outreach":
      return <AutomationSection workspace={workspace} isOwner={isOwner} />
    case "blocklist":
      return (
        <div className="flex max-w-3xl flex-col gap-4">
          <SuppressionsSection workspace={workspace} role={role} />
        </div>
      )
    case "sending":
      return (
        <div className="flex max-w-3xl flex-col gap-4">
          <SendingPolicySection workspace={workspace} isOwner={isOwner} />
        </div>
      )
    case "usage":
      return <UsageSection workspaceId={workspace._id} />
    default:
      // "account" is rendered by the page itself — it is a Hexclave identity
      // surface, not a workspace one, and must stay reachable without a
      // membership.
      return null
  }
}
