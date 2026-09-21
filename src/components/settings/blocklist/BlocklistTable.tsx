import { Delete02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Doc } from "../../../../convex/_generated/dataModel"
import {
  BLOCK_KIND_LABEL,
  BLOCK_REASON_LABEL,
} from "@/components/settings/blocklist/blocklist-copy"
import { Chip } from "@/components/kit/Chip"
import { TableFrame } from "@/components/kit/PageSection"
import { formatInstant } from "@/lib/presentation"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type BlocklistTableProps = {
  entries: readonly Doc<"suppressions">[]
  removing: boolean
  onRemove: (entry: Doc<"suppressions">) => void
}

export function BlocklistTable({
  entries,
  removing,
  onRemove,
}: BlocklistTableProps) {
  return (
    <TableFrame>
      <Table>
        <BlocklistTableHeader />
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry._id}>
              <TableCell className="font-mono break-all text-foreground">
                {entry.normalizedValue}
              </TableCell>
              <TableCell>
                <Chip>{BLOCK_KIND_LABEL[entry.kind]}</Chip>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {BLOCK_REASON_LABEL[entry.reason]}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatInstant(entry.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  aria-label={`Remove ${entry.normalizedValue} from the blocklist`}
                  disabled={removing}
                  onClick={() => onRemove(entry)}
                  size="icon-sm"
                  type="button"
                  variant="destructive"
                >
                  <HugeiconsIcon
                    aria-hidden="true"
                    icon={Delete02Icon}
                    strokeWidth={2}
                  />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableFrame>
  )
}

function BlocklistTableHeader() {
  return (
    <TableHeader>
      <tr className="border-b">
        <TableHead>Blocked</TableHead>
        <TableHead>Scope</TableHead>
        <TableHead>Why</TableHead>
        <TableHead>Added</TableHead>
        <TableHead>
          <span className="sr-only">Actions</span>
        </TableHead>
      </tr>
    </TableHeader>
  )
}

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5] as const

/** The table's own header and cells, so rows keep the real heights while entries load. */
export function BlocklistTableSkeleton() {
  return (
    <TableFrame>
      <Table aria-hidden="true">
        <BlocklistTableHeader />
        <TableBody>
          {SKELETON_ROWS.map((row) => (
            <TableRow key={row}>
              <TableCell>
                <Skeleton shape="full" className="h-3.5 w-44" />
              </TableCell>
              <TableCell>
                <Skeleton shape="lg" className="h-6 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton shape="full" className="h-3.5 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton shape="full" className="h-3.5 w-28" />
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
