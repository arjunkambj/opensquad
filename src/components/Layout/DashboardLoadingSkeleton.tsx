import { Skeleton } from "@/components/ui/skeleton"

export function DashboardLoadingSkeleton() {
  return (
    <div className="flex min-h-dvh bg-background">
      <div className="hidden w-64 border-r border-border p-3 md:flex md:flex-col gap-3">
        <Skeleton className="size-9" />
        <Skeleton className="h-8 w-full rounded-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <div className="mt-auto flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center justify-between border-b border-border px-4 sm:px-6">
          <Skeleton className="size-8" />
          <Skeleton className="size-8 rounded-full" />
        </div>
        <div className="flex flex-1 flex-col gap-6 px-4 py-3 sm:px-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    </div>
  )
}
