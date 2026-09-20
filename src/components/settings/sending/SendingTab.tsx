/**
 * Settings → Sending (reference 26, PLAN §5).
 *
 * Two cards, in the order a reader needs them: the window your agent may send
 * inside, then the switch that decides whether it runs at all.
 *
 * The workspace record arrives from the page, so there is no second read
 * here; each card owns the mutation that writes its own half.
 */
import { Clock01Icon } from "@hugeicons/core-free-icons"
import { Link } from "@tanstack/react-router"
import { AutomationCard } from "@/components/settings/sending/AutomationCard"
import { SendWindowCard } from "@/components/settings/sending/SendWindowCard"
import { SectionHeaderCard } from "@/components/settings/SectionHeaderCard"
import type { WorkspaceRole } from "@/lib/workspace-role"
import type { WorkspaceView } from "@/lib/workspace-view"

export function SendingTab({
  workspace,
  role,
}: {
  workspace: WorkspaceView
  role: WorkspaceRole
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <SectionHeaderCard
        icon={Clock01Icon}
        title="Sending"
        description={
          <>
            When your agent may send, and whether it runs at all. The inbox it
            sends from lives in{" "}
            <Link
              className="text-primary underline-offset-4 hover:underline"
              search={{ tab: "inbox" }}
              to="/settings"
            >
              Inbox
            </Link>
            .
          </>
        }
      />
      <SendWindowCard role={role} workspace={workspace} />
      <AutomationCard role={role} workspace={workspace} />
    </div>
  )
}
