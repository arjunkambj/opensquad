import type { ReactNode } from "react"
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

/**
 * The confirmation step in front of every irreversible decision action.
 *
 * `plan/ux.md` §6 reserves real dialogs for irreversible confirmations, and
 * these are the most irreversible controls in the product: Approve schedules
 * the send, Reject is terminal for the revision. Two properties matter more
 * than the shape:
 *
 * - The *description* states what the button actually does, in the sentence
 *   immediately above it. "Approve" without "this sends the email" is the
 *   single most damaging thing this screen could say.
 * - The text the reviewer typed lives in the caller, not here, so a CONFLICT
 *   keeps the dialog open with the message and the typed words intact rather
 *   than throwing both away.
 */
export function DecisionActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  confirmDisabled = false,
  confirmDescribedBy,
  busy,
  error,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  confirmVariant?: "default" | "destructive"
  confirmDisabled?: boolean
  /**
   * The id of the element stating why the confirm control is unavailable.
   * A disabled button announces its label and nothing else, and a live region
   * near it only speaks when its text changes — so a bound that was never
   * violated is never read. `plan/ux.md` §6: a disabled control always carries
   * a reason a hovering or screen-reader user can reach.
   */
  confirmDescribedBy?: string
  busy: boolean
  error: string | null
  onConfirm: () => void
  children?: ReactNode
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A request in flight must not be dismissed out from under itself —
        // the outcome would land with nothing on screen to report it.
        if (!busy) {
          onOpenChange(next)
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <FormError message={error} />
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            disabled={busy || confirmDisabled}
            aria-describedby={confirmDescribedBy}
            onClick={onConfirm}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
