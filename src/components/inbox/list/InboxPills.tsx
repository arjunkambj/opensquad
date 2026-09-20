/**
 * The four filter pills of reference 24. Each is a link over one search
 * param, so a filtered inbox is a view someone can paste to a colleague and
 * Back walks through the filters that were tried.
 */
import {
  ClockIcon,
  InboxIcon,
  Mail01Icon,
  MenuCircleIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import {
  INBOX_PILLS,
  PILL_LABEL,
  type InboxPill,
} from "@/components/inbox/inbox-presentation"
import { withFilters } from "@/lib/search-params"
import { cn } from "@/lib/utils"
import type { InboxSearch } from "@/routes/_dashboard/_workspace/inbox"

const PILL_ICON: Record<InboxPill, IconSvgElement | undefined> = {
  received: InboxIcon,
  interested: ClockIcon,
  unread: Mail01Icon,
  all: MenuCircleIcon,
}

export function InboxPills({
  active,
  search,
}: {
  active: InboxPill
  search: InboxSearch
}) {
  return (
    <nav aria-label="Filter conversations" className="flex flex-wrap gap-1.5">
      {INBOX_PILLS.map((pill) => {
        const selected = pill === active
        const icon = PILL_ICON[pill]
        return (
          <Link
            key={pill}
            to="/inbox"
            search={withFilters(search, {
              pill: pill === "received" ? undefined : pill,
            })}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
              selected
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {icon === undefined ? null : (
              <HugeiconsIcon
                icon={icon}
                strokeWidth={2}
                className="size-3.5"
                aria-hidden="true"
              />
            )}
            {PILL_LABEL[pill]}
          </Link>
        )
      })}
    </nav>
  )
}
