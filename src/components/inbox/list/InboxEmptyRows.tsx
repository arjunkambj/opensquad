import {
  CheckmarkCircle02Icon,
  FavouriteIcon,
  InboxIcon,
  SearchRemoveIcon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { InboxPill } from "@/components/inbox/inbox-presentation"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"

export function InboxEmptyRows({
  pill,
  searched,
  query,
  hasCursor,
  onReset,
  onShowAll,
}: {
  pill: InboxPill
  searched: boolean
  query: string | undefined
  hasCursor: boolean
  onReset: () => void
  onShowAll: () => void
}) {
  if (searched) {
    return (
      <EmptyState
        variant="plain"
        icon={SearchRemoveIcon}
        title={query === undefined ? "No matches" : `No matches for “${query}”`}
        description="Search matches company names only."
        action={
          <Button variant="outline" size="sm" onClick={onReset}>
            Clear search
          </Button>
        }
      />
    )
  }
  if (hasCursor) {
    return (
      <EmptyState
        variant="plain"
        icon={InboxIcon}
        title="You've reached the end"
        action={
          <Button variant="outline" size="sm" onClick={onReset}>
            Back to newest
          </Button>
        }
      />
    )
  }

  const copy: Record<
    InboxPill,
    { icon: IconSvgElement; title: string; description: string; action: ReactNode }
  > = {
    received: {
      icon: InboxIcon,
      title: "No replies yet",
      description: "Replies to your outreach will show up here.",
      action: (
        <Button variant="outline" size="sm" render={<Link to="/autopilot" />}>
          Check outreach
        </Button>
      ),
    },
    interested: {
      icon: FavouriteIcon,
      title: "No interested leads yet",
      description: "Leads who say yes or ask for a call show up here.",
      action: (
        <Button variant="outline" size="sm" onClick={onShowAll}>
          View all conversations
        </Button>
      ),
    },
    unread: {
      icon: CheckmarkCircle02Icon,
      title: "You're all caught up",
      description: "No unread replies.",
      action: (
        <Button variant="outline" size="sm" onClick={onShowAll}>
          View all conversations
        </Button>
      ),
    },
    all: {
      icon: InboxIcon,
      title: "Your inbox is empty",
      description: "Emails your agent sends will show up here.",
      action: (
        <Button variant="outline" size="sm" render={<Link to="/autopilot" />}>
          Check outreach
        </Button>
      ),
    },
  }
  const { icon, title, description, action } = copy[pill]
  return (
    <EmptyState
      variant="plain"
      icon={icon}
      title={title}
      description={description}
      action={action}
    />
  )
}
