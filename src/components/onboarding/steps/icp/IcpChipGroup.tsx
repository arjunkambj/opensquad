/** An empty selection means All. Catalogue values are case-sensitive, so Add searches allowed values only. */
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

const PICKER_RESULTS = 40

export type IcpChipGroupProps = {
  label: string
  allLabel: string
  options: ToggleChipOption[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Every value a chip may carry. Given only when the group has an Add. */
  catalogue?: ToggleChipOption[]
  addLabel?: string
  searchPlaceholder?: string
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
