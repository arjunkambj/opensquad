import { FieldSkeleton, SkeletonRegion } from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

/** Mirrors `InboxKeyForm`, the first thing most organizations see here. */
export function InboxConnectionSkeleton() {
  return (
    <SkeletonRegion label="Reading your inbox connection" className="gap-4">
      <div className="flex flex-col gap-2">
        <FieldSkeleton />
        <div className="flex h-5 items-center">
          <Skeleton shape="full" className="h-3.5 w-4/5" />
        </div>
      </div>
      <Skeleton shape="xl" className="h-8 w-24" />
    </SkeletonRegion>
  )
}
