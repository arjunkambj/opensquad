import { useState } from "react"
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
import { toast } from "@/components/ui/toast"

export type MemberToRemove = { name: string; remove: () => Promise<void> }

export function RemoveMemberDialog({
  member,
  onClose,
}: {
  member: MemberToRemove | null
  onClose: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    if (member === null || pending) {
      return
    }
    setPending(true)
    setError(null)
    try {
      await member.remove()
      onClose()
      toast.add({ title: `${member.name} removed`, type: "success" })
    } catch (cause) {
      // Keep the provider's reason — "the last owner cannot be removed" is the
      // only thing that tells the user why, and a generic line would hide it.
      setError(
        cause instanceof Error && cause.message !== ""
          ? cause.message
          : `Could not remove ${member.name}.`,
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(next) => {
        if (!next && !pending) {
          setError(null)
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {member?.name ?? "this member"}?</DialogTitle>
          <DialogDescription>
            They lose access to this organization's agent, leads and inbox
            straight away. You can invite them again later.
          </DialogDescription>
        </DialogHeader>

        <FormError message={error} />

        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => {
              setError(null)
              onClose()
            }}
            type="button"
            variant="ghost"
          >
            Keep them
          </Button>
          <Button
            disabled={pending}
            onClick={() => void confirm()}
            type="button"
            variant="destructive"
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Remove member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
