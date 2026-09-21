import { Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

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
      <InputGroup className="min-w-56 flex-1">
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
      <Tabs
        value={kind}
        onValueChange={(picked: typeof kind) => onKindChange(picked)}
      >
        <TabsList aria-label="Filter by scope">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="email">Addresses</TabsTrigger>
          <TabsTrigger value="domain">Domains</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  )
}
