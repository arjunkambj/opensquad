import { Clock01Icon } from "@hugeicons/core-free-icons"
import { Link } from "@tanstack/react-router"
import { AutomationCard } from "@/components/settings/sending/AutomationCard"
import { SendWindowCard } from "@/components/settings/sending/SendWindowCard"
import { SectionHeaderCard } from "@/components/settings/SectionHeaderCard"
import type { OrgView } from "@/lib/org-view"

export function SendingTab({ org }: { org: OrgView }) {
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
      <SendWindowCard org={org} />
      <AutomationCard org={org} />
    </div>
  )
}
