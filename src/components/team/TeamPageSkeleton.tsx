import { TableFrame } from "@/components/kit/PageSection"
import { MembersTableHeader } from "@/components/team/MembersTableHeader"
import {
  PageTitleSkeleton,
  SkeletonRegion,
} from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"

/** Mirrors `TeamPage`: the title with its invite action, over the members table. */
export function TeamPageSkeleton() {
  return (
    <SkeletonRegion label="Loading team">
      <PageTitleSkeleton actions={1} />
      <MembersTableSkeleton />
    </SkeletonRegion>
  )
}

const SKELETON_ROWS = [0, 1, 2] as const

/** The members table's own header and cells, so rows keep their real height. */
export function MembersTableSkeleton() {
  return (
    <TableFrame>
      <Table aria-hidden="true">
        <MembersTableHeader />
        <TableBody>
          {SKELETON_ROWS.map((row) => (
            <TableRow key={row}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Skeleton shape="full" className="size-8 shrink-0" />
                  <Skeleton shape="full" className="h-3.5 w-36" />
                </div>
              </TableCell>
              <TableCell>
                <Skeleton shape="full" className="h-3.5 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton shape="xl" className="ml-auto size-7" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableFrame>
  )
}
