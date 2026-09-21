import type { ReactNode } from "react"

/** A label/value line used throughout the detail surfaces. */
export function DetailRow({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-sm text-foreground">
        {value}
      </span>
    </div>
  )
}
