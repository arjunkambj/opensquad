import { Skeleton } from "@/components/ui/skeleton"

/**
 * Stand-in for the dashboard shell while the session resolves.
 *
 * It must be STRUCTURALLY identical to the loaded shell at every width, or the
 * hand-off reads as a layout jump. The previous version rendered a desktop-only
 * rail (`hidden md:flex`) and a bare header, so at phone width the whole screen
 * was two floating blocks with no header row and no sidebar trigger — which is
 * indistinguishable from a page that failed to load.
 */
export function DashboardLoadingSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading your workspace"
      className="flex min-h-dvh bg-background"
    >
      <div className="hidden w-64 shrink-0 flex-col gap-3 border-r border-border p-3 md:flex">
        <Skeleton className="size-9" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <div className="mt-auto flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center justify-between border-b border-border px-4 sm:px-6">
          {/* The trigger occupies its real position at every width — at phone
              width it is the only proof that a sidebar exists at all. */}
          <Skeleton className="size-8" />
          <Skeleton className="size-8 rounded-full" />
        </div>
        <div className="flex flex-1 flex-col gap-6 px-4 py-3 sm:px-6 sm:py-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    </div>
  )
}
