import { PageTitleSkeleton, SkeletonRegion, TableSkeleton } from "@/components/states/skeletons"
import { SignalsSummary } from "./SignalsSummary"

/** Mirrors `SignalsPage`: the title, the three figures and the signal table. */
export function SignalsPageSkeleton() {
  return (
    <SkeletonRegion label="Loading signals">
      <PageTitleSkeleton />
      <SignalsSummary strategies={undefined} />
      <TableSkeleton rows={5} columns={5} />
    </SkeletonRegion>
  )
}
