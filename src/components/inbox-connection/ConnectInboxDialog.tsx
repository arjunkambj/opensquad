import type { Id } from "../../../convex/_generated/dataModel"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InboxConnection } from "./InboxConnection"

/** The whole connect flow — key, then inbox choice — in a dialog. Once the
 *  inbox connects, the screen that opened it stops rendering it. */
export function ConnectInboxDialog({
  orgId,
  reconnect,
  open,
  onOpenChange,
}: {
  orgId: Id<"orgs">
  reconnect: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {reconnect ? "Reconnect your inbox" : "Connect your inbox"}
          </DialogTitle>
          <DialogDescription>
            {reconnect
              ? "Paste a current key from the same AgentMail account."
              : "Paste your AgentMail API key to get started."}
          </DialogDescription>
        </DialogHeader>
        <InboxConnection orgId={orgId} />
      </DialogContent>
    </Dialog>
  )
}
