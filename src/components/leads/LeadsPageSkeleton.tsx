import {
  PageTitleSkeleton,
  SkeletonRegion,
} from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import {
  LineSkeleton,
  PersonCellSkeleton,
  ProspectTableSkeleton,
  TableFooterSkeleton,
  type SkeletonColumn,
} from "./table/ProspectTableSkeleton"

/** Mirrors `LeadsTable`: one entry per column after the checkbox. */
const LEAD_COLUMNS: readonly SkeletonColumn[] = [
  { head: "w-10", cell: <PersonCellSkeleton />, className: "max-w-72" },
  { head: "w-12", cell: <LineSkeleton className="w-28" />, className: "max-w-64" },
  { head: "w-14", cell: <Skeleton shape="lg" className="h-4 w-14" /> },
  { head: "w-10", cell: <Skeleton shape="xl" className="h-7 w-32" /> },
  { head: "w-10", cell: <Skeleton shape="lg" className="h-6 w-20" /> },
  { head: "w-16", cell: <LineSkeleton size="xs" className="w-14" /> },
  {
    head: "w-16",
    cell: (
      <div className="flex gap-1.5">
        <Skeleton shape="xl" className="h-6 w-20" />
        <Skeleton shape="xl" className="h-6 w-14" />
      </div>
    ),
  },
  {
    head: "ml-auto mr-2 w-14",
    cell: (
      <div className="flex justify-end pr-2">
        <Skeleton shape="xl" className="size-7" />
      </div>
    ),
    className: "text-right",
  },
]

/** The whole `/leads` route while the organization loads. */
export function LeadsPageSkeleton() {
  return (
    <SkeletonRegion label="Loading leads">
      <PageTitleSkeleton />
      <div className="flex flex-col gap-4">
        <LeadsFiltersSkeleton />
        <LeadsResultsSkeleton />
      </div>
    </SkeletonRegion>
  )
}

/** Mirrors `LeadsFilters`: the search field, then the three selects pushed right. */
function LeadsFiltersSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Skeleton shape="xl" className="h-8 w-full sm:w-72" />
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <Skeleton shape="xl" className="h-8 w-44" />
        <Skeleton shape="xl" className="h-8 w-40" />
        <Skeleton shape="xl" className="h-8 w-36" />
      </div>
    </div>
  )
}

/** Mirrors `LeadsResults`: the table and its footer bar. */
export function LeadsResultsSkeleton() {
  return (
    <>
      <ProspectTableSkeleton columns={LEAD_COLUMNS} />
      <TableFooterSkeleton />
    </>
  )
}
