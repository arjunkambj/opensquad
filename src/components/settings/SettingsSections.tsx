/**
 * Settings — workspace, sending policy, automation, members and integrations.
 *
 * One card per section, chosen by the route's `?section=` contract. Account
 * is the only section that is not workspace-scoped.
 */
import { Link } from "@tanstack/react-router"
import type { SettingsSection } from "@/components/settings/settings-model"
import { AutomationSection } from "@/components/settings/AutomationSection"
import { IntegrationsSection } from "@/components/settings/IntegrationsSection"
import { MembersSection } from "@/components/settings/MembersSection"
import { SendingPolicySection } from "@/components/settings/SendingPolicySection"
import { SuppressionsSection } from "@/components/settings/SuppressionsSection"
import { WorkspaceSection } from "@/components/settings/WorkspaceSection"
import { EmptyState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

/**
 * One workspace-backed settings section at a time — the `?section=` deep link
 * is the contract a policy-blocked send relies on, so each section is
 * individually addressable rather than one long stack. Loading,
 * missing-workspace and role-gated states stay explicit (V11); every
 * mutation-backed control here is functional while provider rows in
 * Integrations stay honestly pending their own gates.
 */
export function SettingsSections({ section }: { section: SettingsSection }) {
  const current = useCurrentWorkspace()

  if (current === undefined) {
    return (
      <LoadingState
        title="Loading workspace settings"
        description="Reading your workspace, policy and members."
      />
    )
  }

  if (current === null) {
    return (
      <EmptyState
        title="No workspace yet"
        description="Complete setup to create your workspace and configure it."
        action={<Button render={<Link to="/onboarding" />}>Start setup</Button>}
      />
    )
  }

  const { workspace, role, membershipId } = current
  const isOwner = role === "owner"

  switch (section) {
    case "workspace":
      return <WorkspaceSection workspace={workspace} isOwner={isOwner} />
    case "sending":
      return (
        <div className="flex max-w-3xl flex-col gap-4">
          <SendingPolicySection workspace={workspace} isOwner={isOwner} />
          <SuppressionsSection workspace={workspace} role={role} />
        </div>
      )
    case "automation":
      return <AutomationSection workspace={workspace} isOwner={isOwner} />
    case "members":
      return (
        <MembersSection
          workspaceId={workspace._id}
          isOwner={isOwner}
          selfMembershipId={membershipId}
        />
      )
    case "integrations":
      return <IntegrationsSection workspace={workspace} isOwner={isOwner} />
    default:
      // "account" is rendered by the page itself — it is a Hexclave identity
      // surface, not a workspace one, and must stay reachable without a
      // membership.
      return null
  }
}
