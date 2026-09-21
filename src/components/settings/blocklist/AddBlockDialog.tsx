/** Manual entries always use the manual reason; unsubscribe and bounce evidence comes from the backend. */
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"

export type AddBlockDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  error: string | null
  onSubmit: (entry: { kind: "email" | "domain"; value: string }) => void
}

export function AddBlockDialog({
  open,
  onOpenChange,
  busy,
  error,
  onSubmit,
}: AddBlockDialogProps) {
  const [kind, setKind] = useState<"email" | "domain">("email")
  const [value, setValue] = useState("")
  const [wasOpen, setWasOpen] = useState(open)

  // Reset on OPEN, not on close: the container closes this dialog itself once
  // the add succeeds, so clearing only in `onOpenChange` would leave the last
  // address sitting in the field the next time it is opened.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setValue("")
    }
  }

  const submit = () => {
    const trimmed = value.trim()
    if (trimmed === "" || busy) {
      return
    }
    onSubmit({ kind, value: trimmed })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to the blocklist</DialogTitle>
          <DialogDescription>
            Nothing is ever sent to an entry on this list. The check runs
            before every send and before a paused conversation resumes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel>What to block</FieldLabel>
            <ToggleGroup
              disabled={busy}
              size="sm"
              value={[kind]}
              variant="outline"
              onValueChange={(next) => {
                const picked = next.at(-1)
                if (picked === "email" || picked === "domain") {
                  setKind(picked)
                }
              }}
            >
              <ToggleGroupItem value="email">One address</ToggleGroupItem>
              <ToggleGroupItem value="domain">Whole domain</ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <Field>
            <FieldLabel htmlFor="blocklist-value">
              {kind === "email" ? "Email address" : "Domain"}
            </FieldLabel>
            <Input
              autoFocus
              disabled={busy}
              id="blocklist-value"
              placeholder={
                kind === "email" ? "name@example.com" : "example.com"
              }
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  submit()
                }
              }}
            />
            <FieldDescription>
              {kind === "email"
                ? "Case and dots are normalised, so adding the same address twice changes nothing."
                : "A domain blocks every address on it — use it only when no mail to that company should ever go out."}
            </FieldDescription>
          </Field>

          <FormError message={error} />
        </div>

        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={busy || value.trim() === ""}
            onClick={submit}
            type="button"
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Add to blocklist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
