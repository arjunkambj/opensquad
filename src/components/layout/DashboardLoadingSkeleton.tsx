import { Skeleton } from "@/components/ui/skeleton"

/** Match the loaded shell at every breakpoint to avoid a layout jump while auth resolves. */
export function DashboardLoadingSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading your organization"
      className="flex min-h-dvh bg-background"
    >
      <div className="hidden w-64 shrink-0 flex-col gap-3 border-r border-sidebar-border bg-sidebar p-3 md:flex">
        <Skeleton className="h-9 w-32" />
        <div className="mt-3 flex flex-col gap-1.5">
          <Skeleton className="h-9 w-full rounded-2xl" />
          <Skeleton className="h-9 w-full rounded-2xl" />
          <Skeleton className="h-9 w-full rounded-2xl" />
          <Skeleton className="h-9 w-full rounded-2xl" />
          <Skeleton className="h-9 w-full rounded-2xl" />
        </div>
        <div className="mt-auto flex flex-col gap-3">
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-11 w-full rounded-2xl" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4 md:hidden">
          <Skeleton className="size-8" />
          <Skeleton className="h-7 w-28" />
        </div>
        <div className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-28 w-full rounded-3xl" />
        </div>
      </div>
    </div>
  )
}
