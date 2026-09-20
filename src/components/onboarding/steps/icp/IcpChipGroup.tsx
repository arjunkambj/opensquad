/**
 * One filter group on reference 07: an uppercase label, an exclusive "All …"
 * chip, the chips themselves, and — for the two vocabularies too long to show
 * — a dashed "+ Add" that searches the rest.
 *
 * Two rules it exists to keep:
 *
 *   "ALL" IS AN EMPTY LIST. A group with no values is a filter we do not send,
 *   which is the only thing "All industries" can honestly mean. So the stored
 *   value for that chip is `[]`, and the sentinel below never leaves this file.
 *
 *   NOTHING IS TYPED. Industries, locations and company types are the lead
 *   catalogue's own values: they are case-sensitive and a near-miss silently
 *   matches nobody (PLAN §3 step 2). The Add affordance therefore searches the
 *   allowed values rather than accepting free text, so a chip on screen is
 *   always a value a search can actually use.
 */
import { Add01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useState } from "react"
import { ToggleChipGroup } from "@/components/kit/ToggleChipGroup"
import type { ToggleChipOption } from "@/components/kit/ToggleChipGroup"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/** Never stored and never sent: it only tells `ToggleChipGroup` which chip is
 *  the exclusive one. An empty selection is what "All …" means on the wire. */
const ALL_CHIP = "__all__"

/** How many matches the picker shows at once. The industry catalogue has 454
 *  values; a list that long is a wall, not a choice. */
const PICKER_RESULTS = 40

export type IcpChipGroupProps = {
  label: string
  /** The exclusive chip's words, e.g. "All industries". */
  allLabel: string
  /** Chips always on screen, whether or not they are picked. */
  options: ToggleChipOption[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Every value a chip may carry. Given only when the group has an Add. */
  catalogue?: ToggleChipOption[]
  addLabel?: string
  searchPlaceholder?: string
  /** Upper bound; the Add affordance disappears once it is reached. */
  maxCount: number
  disabled?: boolean
}

export function IcpChipGroup({
  label,
  allLabel,
  options,
  selected,
  onChange,
  catalogue,
  addLabel = "Add",
  searchPlaceholder = "Search",
  maxCount,
  disabled = false,
}: IcpChipGroupProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState("")

  // Anything picked is a chip, even when it is not one of the always-on ones —
  // which is how a generated industry shows up next to the defaults.
  const shown = [...options]
  for (const value of selected) {
    if (!shown.some((option) => option.value === value)) {
      shown.push({
        value,
        label:
          catalogue?.find((entry) => entry.value === value)?.label ?? value,
      })
    }
  }

  const atMax = selected.length >= maxCount
  const query = search.trim().toLocaleLowerCase()
  const matches =
    catalogue === undefined
      ? []
      : catalogue
          .filter(
            (entry) =>
              !shown.some((option) => option.value === entry.value) &&
              (query === "" ||
                entry.label.toLocaleLowerCase().includes(query)),
          )
          .slice(0, PICKER_RESULTS)

  return (
    <ToggleChipGroup
      allOption={{ value: ALL_CHIP, label: allLabel }}
      disabled={disabled}
      label={label}
      onChange={(next) => {
        onChange(next.filter((value) => value !== ALL_CHIP))
      }}
      options={shown}
      selected={selected.length === 0 ? [ALL_CHIP] : selected}
    >
      {catalogue === undefined || atMax ? null : (
        <Popover
          onOpenChange={(open) => {
            setIsOpen(open)
            if (!open) {
              setSearch("")
            }
          }}
          open={isOpen}
        >
          <PopoverTrigger
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-border px-4 text-sm text-muted-foreground outline-none transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
            disabled={disabled}
            type="button"
          >
            <HugeiconsIcon
              aria-hidden="true"
              className="size-3.5"
              icon={Add01Icon}
              strokeWidth={2}
            />
            {addLabel}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-0">
            <Command shouldFilter={false}>
              <CommandInput
                onValueChange={setSearch}
                placeholder={searchPlaceholder}
                value={search}
              />
              <CommandList>
                <CommandEmpty>Nothing matches that.</CommandEmpty>
                {matches.map((entry) => (
                  <CommandItem
                    key={entry.value}
                    onSelect={() => {
                      onChange([...selected, entry.value])
                      setSearch("")
                      setIsOpen(false)
                    }}
                    value={entry.value}
                  >
                    {entry.label}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </ToggleChipGroup>
  )
}
