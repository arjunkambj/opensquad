/**
 * The search control beside the Conversations header.
 *
 * It searches ONE thing and says so: the company name of the lead a thread
 * belongs to, which is the only text the backend has an index for. Offering a
 * box that looks like full-text search over messages would promise a result
 * the query cannot produce.
 *
 * The text is committed on submit rather than on every keystroke: the value
 * lives in the URL, and a navigation per character would fill the history.
 * The URL stays the source of truth — the parent keys this field on `q`, so a
 * Back that drops the filter mounts a fresh, empty box rather than leaving a
 * filter on screen that is no longer applied.
 */
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function InboxSearchField({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (value: string | undefined) => void
}) {
  const [open, setOpen] = useState(value !== undefined)
  const [text, setText] = useState(value ?? "")
  const inputRef = useRef<HTMLInputElement>(null)

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Search conversations by company"
        onClick={() => {
          setOpen(true)
          window.requestAnimationFrame(() => inputRef.current?.focus())
        }}
      >
        <HugeiconsIcon icon={Search01Icon} strokeWidth={2} aria-hidden="true" />
      </Button>
    )
  }

  return (
    <form
      className="flex min-w-0 items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = text.trim()
        onChange(trimmed.length === 0 ? undefined : trimmed)
      }}
    >
      <Input
        ref={inputRef}
        value={text}
        aria-label="Search conversations by company"
        placeholder="Company name"
        className="h-8 w-36 text-sm"
        onChange={(event) => setText(event.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Close search"
        onClick={() => {
          setText("")
          setOpen(false)
          onChange(undefined)
        }}
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden="true" />
      </Button>
    </form>
  )
}
