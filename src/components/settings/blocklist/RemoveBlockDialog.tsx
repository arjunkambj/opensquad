import type { Doc } from "../../../../convex/_generated/dataModel"
import { BLOCK_REASON_LABEL } from "@/components/settings/blocklist/blocklist-copy"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"

export type RemoveBlockDialogProps = {
  entry: Doc<"suppressions"> | null
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

export function RemoveBlockDialog({
  entry,
  busy,
  error,
  onCancel,
  onConfirm,
}: RemoveBlockDialogProps) {
  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(next) => {
        if (!next) {
          onCancel()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Take this off the blocklist?</DialogTitle>
          <DialogDescription>
            {entry === null
              ? null
              : `${entry.normalizedValue} becomes contactable again as soon as this row is gone.`}
          </DialogDescription>
        </DialogHeader>

        {entry === null ? null : (
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              This entry is here because:{" "}
              <span className="text-foreground">
                {BLOCK_REASON_LABEL[entry.reason]}
              </span>
              .
            </li>
            {entry.reason === "unsubscribe" ? (
              <li>
                Someone asked to stop hearing from you. Removing this lets your
                agent write to them again.
              </li>
            ) : null}
            {entry.reason === "bounce" || entry.reason === "provider" ? (
              <li>
                The mail provider reported this, so sending here is likely to
                fail again and to cost you sending reputation.
              </li>
            ) : null}
            {entry.kind === "domain" ? (
              <li>Every address on this domain becomes contactable again.</li>
            ) : null}
          </ul>
        )}

        <FormError message={error} />

        <DialogFooter>
          <Button
            disabled={busy}
            onClick={onCancel}
            type="button"
            variant="ghost"
          >
            Keep it blocked
          </Button>
          <Button
            disabled={busy}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Remove from blocklist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
