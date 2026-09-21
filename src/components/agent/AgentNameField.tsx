import { PencilEdit02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

const UNNAMED_AGENT_LABEL = "Your agent"

export function AgentNameField({
  name,
  editing,
  saving,
  onStartEditing,
  onCancel,
  onSave,
}: {
  name: string
  editing: boolean
  saving: boolean
  onStartEditing: () => void
  onCancel: () => void
  onSave: (name: string) => void
}) {
  const [draft, setDraft] = useState(name)
  const [wasEditing, setWasEditing] = useState(editing)

  // Re-seed the field every time the editor OPENS, so an abandoned edit is
  // gone and a rename saved elsewhere is what the user starts from.
  if (editing !== wasEditing) {
    setWasEditing(editing)
    if (editing) {
      setDraft(name)
    }
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <h2 className="truncate font-heading text-base font-medium text-foreground">
          {name === "" ? UNNAMED_AGENT_LABEL : name}
        </h2>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Rename agent"
          onClick={onStartEditing}
        >
          <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
        </Button>
      </div>
    )
  }

  const submit = () => {
    const trimmed = draft.trim()
    if (trimmed === "" || trimmed === name) {
      onCancel()
      return
    }
    onSave(trimmed)
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Input
        autoFocus
        aria-label="Agent name"
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit()
          if (event.key === "Escape") onCancel()
        }}
        className="max-w-md"
      />
      <Button size="sm" disabled={saving} onClick={submit}>
        {saving ? <Spinner data-icon="inline-start" /> : null}
        Save
      </Button>
      <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
