import type { InboxPill } from "@/components/inbox/inbox-presentation"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"

export function InboxEmptyRows({
  pill,
  searched,
  hasCursor,
  onReset,
}: {
  pill: InboxPill
  searched: boolean
  hasCursor: boolean
  onReset: () => void
}) {
  if (searched) {
    return (
      <EmptyState
        title="No thread matches that company"
        description="Search looks at the company name of the lead a thread belongs to — not at message text."
        action={
          <Button variant="outline" size="sm" onClick={onReset}>
            Clear the search
          </Button>
        }
      />
    )
  }
  if (hasCursor) {
    return (
      <EmptyState
        title="Nothing further"
        description="This is a link to a later page, and there is nothing on it."
        action={
          <Button variant="outline" size="sm" onClick={onReset}>
            Back to the first page
          </Button>
        }
      />
    )
  }
  const description: Record<typeof pill, string> = {
    received:
      "No one has replied yet. Replies to the agent's emails land here the moment they arrive.",
    interested:
      "No reply has been read as interest yet. Threads move here when a lead says yes, or asks for a call.",
    unread:
      "Everything that arrived has been read. New replies show up here with a dot until you open them.",
    all: "This inbox holds no conversations yet — the agent's first emails and their replies will fill it.",
  }
  return (
    <EmptyState title="No conversations yet" description={description[pill]} />
  )
}
