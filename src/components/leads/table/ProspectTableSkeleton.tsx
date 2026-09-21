/** Placeholders built on the real table primitives, so a loading table has the
 * leads and contacts tables' own row heights, cell padding and frame. */
import type { ReactNode } from "react"
import { TableFrame } from "@/components/kit/PageSection"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type SkeletonColumn = {
  /** Width of the header label bar. */
  head: string
  cell: ReactNode
  className?: string
}

/** A bar in one line of `text-sm` (`sm`) or `text-xs` (`xs`) type. Width
 * classes go on the line, since the bar itself only takes static classes. */
export function LineSkeleton({
  size = "sm",
  className,
}: {
  size?: "sm" | "xs"
  className?: string
}) {
  return (
    <span
      className={cn("flex items-center", size === "sm" ? "h-5" : "h-4", className)}
    >
      <Skeleton
        shape="full"
        className={cn("w-full", size === "sm" ? "h-3.5" : "h-3")}
      />
    </span>
  )
}

/** Name, role and company: the three-line person cell both tables open with. */
export function PersonCellSkeleton() {
  return (
    <div className="flex flex-col">
      <LineSkeleton className="w-32" />
      <LineSkeleton size="xs" className="w-24" />
      <LineSkeleton size="xs" className="w-20" />
    </div>
  )
}

export function ProspectTableSkeleton({
  columns,
  rows = 8,
}: {
  columns: readonly SkeletonColumn[]
  rows?: number
}) {
  return (
    <TableFrame>
      <Table>
        <TableHeader>
          <tr className="border-b">
            <TableHead className="w-10">
              <div className="flex items-center pl-2">
                <Skeleton shape="lg" className="size-4" />
              </div>
            </TableHead>
            {columns.map((column, index) => (
              <TableHead key={index} className={column.className}>
                <div className={column.head}>
                  <Skeleton shape="full" className="h-3 w-full" />
                </div>
              </TableHead>
            ))}
          </tr>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, row) => (
            <TableRow key={row}>
              <TableCell className="w-10">
                <div className="flex items-center pl-2">
                  <Skeleton shape="lg" className="size-4" />
                </div>
              </TableCell>
              {columns.map((column, index) => (
                <TableCell key={index} className={column.className}>
                  {column.cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableFrame>
  )
}

/** Mirrors `TableFooterBar`. */
export function TableFooterSkeleton() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <LineSkeleton className="w-48" />
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <LineSkeleton className="w-9" />
          <Skeleton shape="xl" className="h-8 w-20" />
          <LineSkeleton className="w-14" />
        </div>
        <div className="flex gap-1.5">
          <Skeleton shape="xl" className="h-7 w-24" />
          <Skeleton shape="xl" className="h-7 w-20" />
        </div>
      </div>
    </div>
  )
}
