import { useNavigate } from "@tanstack/react-router"
import {
  INBOX_PILLS,
  PILL_LABEL,
  type InboxPill,
} from "@/components/inbox/inbox-presentation"
import { Hint } from "@/components/kit/Hint"
import { withFilters } from "@/lib/search-params"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { InboxSearch } from "@/routes/_dashboard/_org/inbox"

/** The pills nest rather than partition: Interested and Unread are slices of
 *  Received, and All adds threads nobody has answered yet. */
const PILL_HINT: Record<InboxPill, string> = {
  received: "Every thread someone has replied to",
  interested: "Replies that read as interest, or leads with a meeting",
  unread: "Replies you have not opened yet",
  all: "Every thread, including ones still waiting for a first reply",
}

export function InboxPills({
  active,
  search,
}: {
  active: InboxPill
  search: InboxSearch
}) {
  const navigate = useNavigate()
  return (
    <Tabs
      value={active}
      onValueChange={(pill: InboxPill) =>
        void navigate({
          to: "/inbox",
          search: withFilters(search, {
            pill: pill === "received" ? undefined : pill,
          }),
        })
      }
    >
      <TabsList aria-label="Filter conversations" className="grid w-full grid-cols-4 sm:max-w-sm xl:max-w-none">
        {INBOX_PILLS.map((pill) => (
          <TabsTrigger key={pill} value={pill}>
            <Hint content={PILL_HINT[pill]}>{PILL_LABEL[pill]}</Hint>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
