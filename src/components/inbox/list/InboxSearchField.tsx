/** Commit search on submit to avoid a history entry per keystroke.
 * The parent keys this field on q so Back restores the URL's value. */
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
