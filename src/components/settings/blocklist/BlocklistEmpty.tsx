import { ShieldBanIcon } from "@hugeicons/core-free-icons"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"

export type BlocklistEmptyProps = {
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
        variant="plain"
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
      variant="plain"
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
