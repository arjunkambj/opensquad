import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InboxKeyForm } from "./InboxKeyForm"

export function ReplaceKeyDialog({
  open,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean
  busy: boolean
  error: string | null
  onSubmit: (apiKey: string) => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          onCancel()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace the AgentMail key</DialogTitle>
          <DialogDescription>
            Your inbox stays connected.
          </DialogDescription>
        </DialogHeader>
        <InboxKeyForm
          id="inbox-rotate-key"
          label="New AgentMail API key"
          description="Must be from the same account."
          submitLabel="Replace key"
          busy={busy}
          error={error}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </DialogContent>
    </Dialog>
  )
}
