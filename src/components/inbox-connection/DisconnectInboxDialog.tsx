/**
 * Disconnect confirmation (PLAN §4 "Manage inbox" step 7).
 *
 * It spells out the three consequences rather than asking "are you sure?":
 * inbound mail stops, the stored key is wiped, and the agent stops sending.
 * Nothing here is reversible by pressing Back, so the dialog is the last
 * place to say what happens.
 */
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
import { FormError } from "@/components/states/states"

export function DisconnectInboxDialog({
  open,
  onOpenChange,
  inboxAddress,
  busy,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  inboxAddress: string | undefined
  busy: boolean
  error: string | null
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect the sending inbox?</DialogTitle>
          <DialogDescription>
            {inboxAddress === undefined
              ? "This workspace will stop sending and receiving mail."
              : `${inboxAddress} will stop serving this workspace.`}
          </DialogDescription>
        </DialogHeader>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
          <li>Inbound mail stops: the webhook on your account is removed.</li>
          <li>Your stored key and its webhook secret are wiped.</li>
          <li>
            The agent is paused, so nothing is sent until an inbox is connected
            again. Leads, drafts and past conversations are kept.
          </li>
        </ul>
        <FormError message={error} />
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              onOpenChange(false)
            }}
          >
            Keep it connected
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={onConfirm}
          >
            Disconnect
            {busy ? <Spinner className="size-4" /> : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
