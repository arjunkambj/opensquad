/**
 * The blocklist itself: what is blocked, why, since when, and the way to
 * take an entry off.
 *
 * Presentational. The value is shown in its normalised form — that is the
 * exact key the send boundary compares against, so showing anything else
 * would be showing a different fact from the one that blocks the mail.
 */
import { Delete02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Doc } from "../../../../convex/_generated/dataModel"
import {
  BLOCK_KIND_LABEL,
  BLOCK_REASON_LABEL,
} from "@/components/settings/blocklist/blocklist-copy"
import { Chip, formatInstant } from "@/components/shared/presentation"
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
  canEdit: boolean
  /** A removal is in flight; the confirm dialog holds which row it is. */
  removing: boolean
  onRemove: (entry: Doc<"suppressions">) => void
}

export function BlocklistTable({
  entries,
  canEdit,
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
          {canEdit ? (
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          ) : null}
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
            {canEdit ? (
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
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
