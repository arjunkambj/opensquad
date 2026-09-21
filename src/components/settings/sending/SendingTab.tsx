import { AutomationCard } from "@/components/settings/sending/AutomationCard"
import { SendWindowCard } from "@/components/settings/sending/SendWindowCard"
import type { OrgView } from "@/lib/org-view"

export function SendingTab({ org }: { org: OrgView }) {
  return (
    <div className="flex flex-col gap-6">
      <SendWindowCard org={org} />
      <AutomationCard org={org} />
    </div>
  )
}
