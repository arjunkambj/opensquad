import { Link } from "@tanstack/react-router"
import { AutomationSection } from "@/components/settings/AutomationSection"
import { IntegrationsSection } from "@/components/settings/IntegrationsSection"
import { MembersSection } from "@/components/settings/MembersSection"
import { RuntimeSection } from "@/components/settings/RuntimeSection"
import { SendingPolicySection } from "@/components/settings/SendingPolicySection"
import { WorkspaceSection } from "@/components/settings/WorkspaceSection"
import { EmptyState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

/**
 * All workspace-backed settings sections. Loading, missing-workspace and
 * role-gated states are explicit (V11); every mutation-backed control here is
 * functional — including the P07 runtime section — while provider rows in
 * Integrations stay honestly pending their own gates.
 */
export function SettingsSections() {
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

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <WorkspaceSection workspace={workspace} isOwner={isOwner} />
      <SendingPolicySection workspace={workspace} isOwner={isOwner} />
      <AutomationSection workspace={workspace} isOwner={isOwner} />
      <MembersSection
        workspaceId={workspace._id}
        isOwner={isOwner}
        selfMembershipId={membershipId}
      />
      <RuntimeSection workspace={workspace} isOwner={isOwner} />
      <IntegrationsSection workspace={workspace} isOwner={isOwner} />
    </div>
  )
}
