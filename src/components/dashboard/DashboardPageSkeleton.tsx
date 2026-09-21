import { ActivityChart } from "@/components/dashboard/ActivityChart"
import {
  DashboardStats,
  PipelineStat,
} from "@/components/dashboard/DashboardStats"
import { LatestReplies } from "@/components/dashboard/LatestReplies"
import { PageTitleSkeleton, SkeletonRegion } from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

const noop = async () => {}

/** Mirrors `DashboardPage`. The panels render their own loading state, so their frames are the real ones. */
export function DashboardPageSkeleton() {
  return (
    <SkeletonRegion label="Loading overview">
      <PageTitleSkeleton actions={2} />
      <div className="flex justify-end">
        <Skeleton shape="xl" className="h-8 w-80 max-w-full" />
      </div>
      <DashboardStats summary={undefined} hint="" />
      <ActivityChart series={undefined} hint="" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <PipelineStat
            className="flex-1"
            summary={undefined}
            hint=""
            canEditDealSize={false}
            onSaveDealSize={noop}
          />
        </div>
        <LatestReplies replies={undefined} hint="" timezone="UTC" />
      </div>
    </SkeletonRegion>
  )
}
