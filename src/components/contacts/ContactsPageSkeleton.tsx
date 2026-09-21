import {
  PageTitleSkeleton,
  SkeletonRegion,
} from "@/components/states/skeletons"
import {
  LineSkeleton,
  PersonCellSkeleton,
  ProspectTableSkeleton,
  TableFooterSkeleton,
  type SkeletonColumn,
} from "@/components/leads/table/ProspectTableSkeleton"
import { Skeleton } from "@/components/ui/skeleton"

/** Mirrors `ContactsTable`: one entry per column after the checkbox. */
const CONTACT_COLUMNS: readonly SkeletonColumn[] = [
  { head: "w-14", cell: <PersonCellSkeleton />, className: "max-w-72" },
  { head: "w-12", cell: <LineSkeleton className="w-28" />, className: "max-w-64" },
  { head: "w-14", cell: <Skeleton shape="lg" className="h-4 w-14" /> },
  {
    head: "ml-auto mr-2 w-10",
    cell: (
      <div className="flex justify-end pr-2">
        <Skeleton shape="xl" className="h-7 w-32" />
      </div>
    ),
    className: "text-right",
  },
]

/** The whole `/contacts` route while the organization loads. */
export function ContactsPageSkeleton() {
  return (
    <SkeletonRegion label="Loading contacts">
      <PageTitleSkeleton />
      <div className="flex flex-col gap-4">
        <ContactsResultsSkeleton />
      </div>
    </SkeletonRegion>
  )
}

/** Mirrors the contacts table and its footer bar. */
export function ContactsResultsSkeleton() {
  return (
    <>
      <ProspectTableSkeleton columns={CONTACT_COLUMNS} />
      <TableFooterSkeleton />
    </>
  )
}
