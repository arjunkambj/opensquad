import {
  PageTitleSkeleton,
  SkeletonRegion,
} from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

/** Mirrors `IntegrationsPage`: the title over the grid of integration cards. */
export function IntegrationsPageSkeleton() {
  return (
    <SkeletonRegion label="Loading integrations">
      <PageTitleSkeleton />
      <IntegrationsGridSkeleton />
    </SkeletonRegion>
  )
}

export function IntegrationsGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <IntegrationCardSkeleton />
      <IntegrationCardSkeleton />
    </div>
  )
}

/** Mirrors `IntegrationCard`: logo and title row, description, then the footer rule. */
function IntegrationCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-panel p-5">
      <div className="flex items-center gap-3">
        <Skeleton shape="xl" className="size-10 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex h-5 items-center justify-between gap-3">
            <Skeleton shape="full" className="h-3.5 w-28" />
            <Skeleton shape="lg" className="h-5 w-20 shrink-0" />
          </div>
          <div className="flex h-4 items-center">
            <Skeleton shape="full" className="h-3 w-20" />
          </div>
        </div>
      </div>

      <div className="flex h-5 items-center">
        <Skeleton shape="full" className="h-3.5 w-48" />
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4">
        <Skeleton shape="full" className="h-3 w-32" />
        <Skeleton shape="xl" className="h-7 w-20" />
      </div>
    </div>
  )
}
