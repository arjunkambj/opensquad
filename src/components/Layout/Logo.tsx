import { cn } from "@/lib/utils"

export default function Logo({
  className,
  markOnly = false,
  markClassName,
}: {
  className?: string
  markOnly?: boolean
  markClassName?: string
}) {
  return (
    <div
      className={cn(
        "group flex cursor-pointer items-center gap-2 text-foreground transition-colors hover:text-primary",
        className,
      )}
    >
      <svg
        aria-label={markOnly ? "OpenSquad" : undefined}
        aria-hidden={!markOnly}
        className={cn("size-8 shrink-0", markClassName)}
        fill="none"
        role={markOnly ? "img" : undefined}
        viewBox="0 0 64 64"
      >
        <circle cx="22" cy="24" r="8" stroke="currentColor" strokeWidth="6" />
        <circle cx="42" cy="24" r="8" stroke="currentColor" strokeWidth="6" />
        <circle cx="32" cy="42" r="8" stroke="currentColor" strokeWidth="6" />
      </svg>
      {!markOnly && (
        <span className="font-heading text-lg font-bold leading-none tracking-tight">
          OpenSquad
        </span>
      )}
    </div>
  )
}
