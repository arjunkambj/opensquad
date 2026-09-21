/** Read the uncontrolled key once on submit and clear the DOM value immediately.
 * Never retain it in React state or logs. */
import { useRef, useState } from "react"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

export type InboxKeyFormProps = {
  id: string
  label: string
  description: string
  submitLabel: string
  busy: boolean
  /** Called with the pasted key, which the caller must not retain either. */
  onSubmit: (apiKey: string) => void
  error: string | null
  onCancel?: () => void
  cancelLabel?: string
  disabled?: boolean
}

export function InboxKeyForm({
  id,
  label,
  description,
  submitLabel,
  busy,
  onSubmit,
  error,
  onCancel,
  cancelLabel = "Cancel",
  disabled = false,
}: InboxKeyFormProps) {
  const field = useRef<HTMLInputElement>(null)
  const [filled, setFilled] = useState(false)

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        const node = field.current
        if (node === null) {
          return
        }
        const apiKey = node.value.trim()
        if (apiKey.length === 0) {
          return
        }
        node.value = ""
        setFilled(false)
        onSubmit(apiKey)
      }}
    >
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          ref={field}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste your AgentMail API key"
          disabled={disabled || busy}
          onChange={(event) => {
            setFilled(event.target.value.trim().length > 0)
          }}
        />
        <FieldDescription>{description}</FieldDescription>
      </Field>
      <FormError message={error} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="cta" disabled={disabled || busy || !filled}>
          {submitLabel}
          {busy ? <Spinner className="size-4" /> : null}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="cta"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
