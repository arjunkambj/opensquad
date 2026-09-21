import { Robot01Icon } from "@hugeicons/core-free-icons"
import { FramedPanel } from "@/components/kit/FramedPanel"
import { PageTitleSkeleton, SkeletonRegion } from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import { AgentActivitySkeleton } from "./AgentActivity"
import { AgentFunnelRow } from "./AgentFunnelRow"

/** Mirrors `AgentPage`: the title with Instructions, the agent card, the funnel and the activity panel. */
export function AgentPageSkeleton() {
  return (
    <SkeletonRegion label="Loading autopilot">
      <PageTitleSkeleton actions={1} />
      <AgentCardSkeleton />
      <AgentFunnelRow funnel={undefined} />
      <AgentActivitySkeleton />
    </SkeletonRegion>
  )
}

/** Mirrors `AgentCard` with its run panel. */
function AgentCardSkeleton() {
  return (
    <FramedPanel
      title="Agent"
      icon={Robot01Icon}
      action={<Skeleton shape="lg" className="size-6" />}
      bodyClassName="gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex h-6 items-center">
            <Skeleton shape="full" className="h-4 w-36" />
          </div>
          <div className="flex h-4 items-center">
            <Skeleton shape="full" className="h-3 w-64 max-w-full" />
          </div>
        </div>
        <Skeleton shape="xl" className="h-8 w-32" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-3">
        <div className="flex h-5 min-w-0 flex-1 items-center">
          <Skeleton shape="full" className="h-3.5 w-56 max-w-full" />
        </div>
        <Skeleton shape="xl" className="h-8 w-28" />
      </div>
    </FramedPanel>
  )
}
