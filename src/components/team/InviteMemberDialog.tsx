import { Add01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { CurrentUser, Team } from "@hexclave/react"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"

/** Owns its open state so the page header can host it without lifting the permission check out of Suspense. */
export function InviteMemberButton({
  team,
  user,
}: {
  team: Team
  user: CurrentUser
}) {
  const canInvite = user.usePermission(team, "$invite_members") !== null
  const [open, setOpen] = useState(false)

  if (!canInvite) {
    return null
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} type="button">
        <HugeiconsIcon
          aria-hidden="true"
          data-icon="inline-start"
          icon={Add01Icon}
          strokeWidth={2}
        />
        Invite teammate
      </Button>
      <InviteMemberDialog onOpenChange={setOpen} open={open} team={team} />
    </>
  )
}

function InviteMemberDialog({
  team,
  open,
  onOpenChange,
}: {
  team: Team
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [email, setEmail] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)

  // Reset on open: a successful send closes the dialog from here, so a close-time reset would race it.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setEmail("")
      setError(null)
    }
  }

  const submit = async () => {
    const address = email.trim()
    if (address === "" || pending) {
      return
    }
    setPending(true)
    setError(null)
    try {
      await team.inviteUser({ email: address })
      onOpenChange(false)
      toast.add({ title: `Invitation sent to ${address}`, type: "success" })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invitation could not be sent.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          onOpenChange(next)
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They get an email with a link that adds them to {team.displayName}.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          id="invite-member-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field>
            <FieldLabel htmlFor="invite-member-email">Email address</FieldLabel>
            <Input
              autoComplete="off"
              autoFocus
              disabled={pending}
              id="invite-member-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              type="email"
              value={email}
            />
          </Field>
          <FormError message={error} />
        </form>

        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={pending || email.trim() === ""}
            form="invite-member-form"
            type="submit"
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
