import { HugeiconsIcon } from "@hugeicons/react"
import { Hint } from "@/components/kit/Hint"
import type { ReviewRow } from "@/components/onboarding/steps/signals/review-rows"
import { TextLine } from "@/components/onboarding/OnboardingSkeleton"
import { SkeletonRegion } from "@/components/states/skeletons"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

const VISIBLE_CHIPS = 4

export function ReviewList({
  rows,
  disabled,
  onEdit,
}: {
  rows: ReviewRow[]
  disabled: boolean
  onEdit: (row: ReviewRow) => void
}) {
  return (
    <ul className="flex flex-col gap-6">
      {rows.map((row) => (
        <li
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
          key={row.id}
        >
          <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground sm:h-8">
            <HugeiconsIcon
              aria-hidden="true"
              className="size-4 shrink-0"
              icon={row.icon}
              strokeWidth={2}
            />
            {row.label}
          </p>

          <div className="col-span-2 row-start-2 flex min-w-0 flex-col gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
            <ReviewValues empty={row.empty} values={row.values} />
            {row.note === undefined ? null : (
              <p className="text-sm text-muted-foreground">{row.note}</p>
            )}
          </div>

          <div className="col-start-2 row-start-1 sm:col-start-3">
            <Hint content={row.hint}>
              <Button
                aria-label={`Edit ${row.label.toLowerCase()}`}
                disabled={disabled}
                onClick={() => {
                  onEdit(row)
                }}
                type="button"
                variant="ghost"
              >
                Edit
              </Button>
            </Hint>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Same grid as the rows above, one per review row: label, value chips, Edit. */
export function ReviewListSkeleton({ rows = 7 }: { rows?: number }) {
  const chipWidths = [
    ["w-32", "w-24"],
    ["w-28", "w-36", "w-24"],
    ["w-40"],
  ]
  return (
    <SkeletonRegion label="Loading your setup" className="gap-6">
      {Array.from({ length: rows }, (_, row) => (
        <div
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
          key={row}
        >
          <div className="flex items-center gap-2 sm:h-8">
            <Skeleton shape="full" className="size-4 shrink-0" />
            <TextLine className="w-20" />
          </div>
          <div className="col-span-2 row-start-2 flex flex-wrap gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
            {chipWidths[row % chipWidths.length]?.map((width) => (
              <div className={width} key={width}>
                <Skeleton shape="lg" className="h-8 w-full" />
              </div>
            ))}
          </div>
          <Skeleton
            shape="xl"
            className="col-start-2 row-start-1 h-8 w-14 sm:col-start-3"
          />
        </div>
      ))}
    </SkeletonRegion>
  )
}

function ReviewValues({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) {
    return <p className="text-sm text-muted-foreground sm:leading-8">{empty}</p>
  }
  const shown = values.slice(0, VISIBLE_CHIPS)
  const hidden = values.slice(VISIBLE_CHIPS)
  return (
    <div className="flex flex-wrap gap-2">
      {shown.map((value, index) => (
        <span
          className="inline-flex h-8 max-w-full items-center truncate rounded-lg bg-muted px-2.5 text-sm text-foreground"
          // Values are free text and can repeat, so position is the stable key.
          key={index}
        >
          {value}
        </span>
      ))}
      {hidden.length === 0 ? null : (
        <Hint content={hidden.join(", ")}>
          <span className="inline-flex h-8 items-center rounded-lg px-2 text-sm text-muted-foreground">
            +{hidden.length} more
          </span>
        </Hint>
      )}
    </div>
  )
}
