/**
 * CheckCard — a checkbox drawn as a card, with an optional info tooltip and a
 * trailing count (refs 08 "Exclude these profiles", 09 signal strategies).
 *
 * The label wraps a real `<input type="checkbox">` so the whole row toggles
 * and the browser owns the keyboard behaviour. The info button and the count
 * sit *outside* that label — a button nested inside a label would toggle the
 * checkbox on its way to opening the tooltip.
 *
 * `count` has three legitimate shapes because a strategy's match count is
 * fetched: a number, "loading" while it is being fetched, or absent when the
 * caller has nothing to show. It never renders a zero it made up.
 */
import { InformationCircleIcon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type CheckCardProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  title: string
  description?: string
  /** Tooltip body; the info button only renders when this is given. */
  info?: string
  /** Accessible name for the info button. */
  infoLabel?: string
  /** A number, "loading" while it is being fetched, or nothing. */
  count?: number | "loading"
  /** Word after the count, e.g. "matches". */
  countLabel?: string
  /** Word before the count, e.g. "About" for a count the source estimated.
   *  A number we cannot vouch for is never shown as an exact one. */
  countPrefix?: string
  disabled?: boolean
  className?: string
}

function CheckCount({
  count,
  countLabel,
  countPrefix,
}: {
  count: number | "loading"
  countLabel?: string
  countPrefix?: string
}) {
  if (count === "loading") {
    // bg-foreground/10 rather than the default bg-muted: a checked card's
    // ground is already tinted, and an invisible skeleton would read as a
    // count that came back empty.
    return <Skeleton className="h-5 w-16 shrink-0 rounded-full bg-foreground/10" />
  }
  return (
    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground tabular-nums">
      {[countPrefix, count.toLocaleString(), countLabel]
        .filter((part): part is string => part !== undefined)
        .join(" ")}
    </span>
  )
}

export function CheckCard({
  checked,
  onCheckedChange,
  title,
  description,
  info,
  infoLabel = "More information",
  count,
  countLabel,
  countPrefix,
  disabled = false,
  className,
}: CheckCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors",
        checked ? "border-primary bg-primary/5" : "border-border bg-background",
        disabled && "opacity-50",
        className,
      )}
    >
      <label
        className={cn(
          "flex min-w-0 flex-1 items-start gap-3 rounded-xl transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
          disabled ? "pointer-events-none" : "cursor-pointer",
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => {
            onCheckedChange(event.target.checked)
          }}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
            checked
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background",
          )}
        >
          {checked ? (
            <HugeiconsIcon
              icon={Tick02Icon}
              strokeWidth={2.5}
              className="size-3"
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {description ? (
            <span className="text-sm text-muted-foreground">{description}</span>
          ) : null}
        </span>
      </label>

      {count === undefined ? null : (
        <CheckCount
          count={count}
          countLabel={countLabel}
          countPrefix={countPrefix}
        />
      )}

      {info ? (
        <Tooltip>
          <TooltipTrigger
            type="button"
            aria-label={infoLabel}
            className="shrink-0 rounded-full p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <HugeiconsIcon
              icon={InformationCircleIcon}
              strokeWidth={2}
              className="size-4"
              aria-hidden="true"
            />
          </TooltipTrigger>
          <TooltipContent>{info}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
