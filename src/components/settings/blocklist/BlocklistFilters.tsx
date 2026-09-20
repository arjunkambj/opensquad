/**
 * The blocklist's search box and scope filter.
 *
 * Both narrow the SERVER query rather than the rendered page — a list that
 * spans pages cannot be filtered honestly in the browser, because the match
 * a reader is looking for may be on a page they have not asked for.
 */
import { Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export type BlocklistKindFilter = "all" | "email" | "domain"

export type BlocklistFiltersProps = {
  search: string
  onSearchChange: (next: string) => void
  kind: BlocklistKindFilter
  onKindChange: (next: BlocklistKindFilter) => void
}

export function BlocklistFilters({
  search,
  onSearchChange,
  kind,
  onKindChange,
}: BlocklistFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <InputGroup className="h-9 min-w-56 flex-1">
        <InputGroupAddon align="inline-start">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-4 text-muted-foreground"
            icon={Search01Icon}
            strokeWidth={2}
          />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search the blocklist"
          placeholder="Search an address or domain"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </InputGroup>
      <ToggleGroup
        aria-label="Filter by scope"
        size="sm"
        value={[kind]}
        variant="outline"
        onValueChange={(next) => {
          const picked = next.at(-1)
          // An empty array is the user pressing the active item again. The
          // list is always scoped to something, so that is a no-op.
          if (picked === "all" || picked === "email" || picked === "domain") {
            onKindChange(picked)
          }
        }}
      >
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="email">Addresses</ToggleGroupItem>
        <ToggleGroupItem value="domain">Domains</ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}
