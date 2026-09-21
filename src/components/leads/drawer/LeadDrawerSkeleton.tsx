import type { ReactNode } from "react"
import { SkeletonRegion } from "@/components/states/skeletons"
import { SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { LineSkeleton } from "../table/ProspectTableSkeleton"

/** Mirrors the loaded drawer: header and chips, actions, research, details and activity. */
export function LeadDrawerSkeleton() {
  return (
    <SkeletonRegion label="Opening lead" className="gap-0">
      <SheetHeader>
        {/* The sheet still needs a name while its real title loads. */}
        <SheetTitle className="sr-only">Opening lead</SheetTitle>
        <Skeleton shape="full" className="my-1 h-4 w-44" />
        <LineSkeleton className="w-56" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Skeleton shape="lg" className="h-6 w-20" />
          <Skeleton shape="lg" className="h-6 w-16" />
          <LineSkeleton size="xs" className="w-24" />
        </div>
      </SheetHeader>

      <div className="flex flex-col gap-6 px-6 pb-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Skeleton shape="xl" className="h-7 w-40" />
            <Skeleton shape="xl" className="h-7 w-16" />
            <Skeleton shape="xl" className="h-7 w-44" />
            <Skeleton shape="xl" className="h-7 w-40" />
          </div>
          <LineSkeleton size="xs" className="w-4/5" />
        </div>

        <DrawerSectionSkeleton>
          <div className="flex flex-col gap-3">
            <LineSkeleton className="w-full" />
            <LineSkeleton className="w-3/4" />
            <Skeleton className="h-16 w-full" />
          </div>
        </DrawerSectionSkeleton>

        <DrawerSectionSkeleton>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            {["w-40", "w-28", "w-12", "w-32", "w-36"].map((width) => (
              <div key={width} className="contents">
                <LineSkeleton className="w-16" />
                <div className={width}>
                  <LineSkeleton />
                </div>
              </div>
            ))}
          </div>
        </DrawerSectionSkeleton>

        <DrawerSectionSkeleton>
          <Skeleton className="h-16 w-full" />
        </DrawerSectionSkeleton>
      </div>
    </SkeletonRegion>
  )
}

function DrawerSectionSkeleton({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <LineSkeleton className="w-24" />
      {children}
    </section>
  )
}
