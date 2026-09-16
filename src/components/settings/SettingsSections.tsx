import { Link, useSearch } from "@tanstack/react-router"
import { useEffect } from "react"
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
 * The element id a `?section=` deep link lands on. Section cards stack on one
 * route, so the link's job is a scroll, not a page switch — `runtime`,
 * `sending` and friends are pointed at from the decision queue, the runtime
 * badge and mission detail, and landing them at the top of the page was the
 * whole defect.
 */
export const settingsSectionId = (section: string) => `settings-${section}`

/**
 * All workspace-backed settings sections. Loading, missing-workspace and
 * role-gated states are explicit (V11); every mutation-backed control here is
 * functional — including the P07 runtime section — while provider rows in
 * Integrations stay honestly pending their own gates.
 */
export function SettingsSections() {
  const current = useCurrentWorkspace()
  const { section } = useSearch({ from: "/_dashboard/settings" })

  // The effect lives where the sections render — after the workspace has
  // loaded — so a deep link scrolls only once its target exists, and it still
  // re-runs when the param changes while already on the page.
  const sectionsReady = current !== undefined && current !== null
  useEffect(() => {
    if (section === undefined || !sectionsReady) {
      return
    }
    document
      .getElementById(settingsSectionId(section))
      ?.scrollIntoView({ block: "start" })
  }, [section, sectionsReady])

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
      <div id={settingsSectionId("workspace")} className="scroll-mt-6">
        <WorkspaceSection workspace={workspace} isOwner={isOwner} />
      </div>
      <div id={settingsSectionId("sending")} className="scroll-mt-6">
        <SendingPolicySection workspace={workspace} isOwner={isOwner} />
      </div>
      <div id={settingsSectionId("automation")} className="scroll-mt-6">
        <AutomationSection workspace={workspace} isOwner={isOwner} />
      </div>
      <div id={settingsSectionId("members")} className="scroll-mt-6">
        <MembersSection
          workspaceId={workspace._id}
          isOwner={isOwner}
          selfMembershipId={membershipId}
        />
      </div>
      <div id={settingsSectionId("runtime")} className="scroll-mt-6">
        <RuntimeSection workspace={workspace} isOwner={isOwner} />
      </div>
      <div id={settingsSectionId("integrations")} className="scroll-mt-6">
        <IntegrationsSection workspace={workspace} isOwner={isOwner} />
      </div>
    </div>
  )
}
