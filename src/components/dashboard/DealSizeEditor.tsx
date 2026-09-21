import { useState } from "react"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"

export function DealSizeEditor({
  dealSize,
  disabled,
  onSave,
}: {
  dealSize: number | null
  disabled: boolean
  onSave: (dealSize: number) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (disabled) {
    return null
  }

  const submit = async (): Promise<void> => {
    const value = Number(draft.trim())
    if (draft.trim() === "" || !Number.isFinite(value) || value < 0) {
      setError("Enter the average value of one closed deal.")
      return
    }
    // Unchanged is not a write: the card already shows this number, and a
    // no-op patch would bump the agent's `updatedAt` for nothing.
    if (value === dealSize) {
      setOpen(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(value)
      setOpen(false)
    } catch {
      setError("Could not save the deal size.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setDraft(dealSize === null ? "" : String(dealSize))
          setError(null)
        }
      }}
    >
      <PopoverTrigger
        render={<Button size="xs" variant="ghost" />}
        aria-label={dealSize === null ? "Set deal size" : "Edit deal size"}
      >
        {dealSize === null ? "Set" : "Edit"}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-3 p-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deal-size">Average deal size</Label>
            <Input
              id="deal-size"
              inputMode="decimal"
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              What one closed deal is typically worth. Pipeline is this times
              the interested leads and booked meetings in the window.
            </p>
          </div>
          {error === null ? null : <FormError message={error} />}
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <Spinner className="size-3.5" /> : null}
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
