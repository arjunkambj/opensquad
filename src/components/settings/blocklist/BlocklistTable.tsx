import { Delete02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Doc } from "../../../../convex/_generated/dataModel"
import {
  BLOCK_KIND_LABEL,
  BLOCK_REASON_LABEL,
} from "@/components/settings/blocklist/blocklist-copy"
import { Chip } from "@/components/kit/Chip"
import { formatInstant } from "@/lib/presentation"
import { Button } from "@/components/ui/button"
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Blocked</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead>Why</TableHead>
          <TableHead>Added</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
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
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
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
  )
}
