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
        description="Clear the filters to see the whole list."
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
      description="Unsubscribes and bounces are added automatically."
      action={
        <Button onClick={onAdd} type="button">
          Add the first entry
        </Button>
      }
    />
  )
}
