/**
 * What an empty blocklist looks like — and it is two different things.
 *
 * "Nothing is blocked" is a state to explain: the list fills itself from
 * unsubscribes and bounces, and a hand-added entry is for someone who asked
 * off-channel. "Nothing matches" is a filter to undo. Collapsing them into
 * one message would send a reader looking for a row that is only hidden.
 */
import { ShieldBanIcon } from "@hugeicons/core-free-icons"
import { EmptyState } from "@/components/kit/EmptyState"
import { Button } from "@/components/ui/button"

export type BlocklistEmptyProps = {
  /** A search or scope is narrowing the list. */
  filtered: boolean
  onClearFilters: () => void
  onAdd: () => void
}

export function BlocklistEmpty({
  filtered,
  onClearFilters,
  onAdd,
}: BlocklistEmptyProps) {
  if (filtered) {
    return (
      <EmptyState
        icon={ShieldBanIcon}
        title="Nothing matches that"
        description="No entry matches this search and scope. Clear them to see the whole list."
        action={
          <Button onClick={onClearFilters} type="button" variant="outline">
            Clear filters
          </Button>
        }
      />
    )
  }

  return (
    <EmptyState
      icon={ShieldBanIcon}
      title="Nothing is blocked yet"
      description="An unsubscribe or a bounce adds itself here. Add an address by hand when someone asks to be left alone off-channel, or a domain when no mail to that company should ever go out."
      action={
        <Button onClick={onAdd} type="button">
          Add the first entry
        </Button>
      }
    />
  )
}
