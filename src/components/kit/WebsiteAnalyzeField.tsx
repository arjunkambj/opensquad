import { Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"

export type WebsiteAnalyzeFieldProps = {
  value: string
  onChange: (next: string) => void
  onAnalyze: () => void
  /** What the button offers: a first read, or another one at full price. */
  intent: "analyze" | "regenerate"
  /** A run is in flight. */
  analyzing: boolean
  /** Credits this run costs. `0` while the free first run is still unused. */
  price: number
  /** Our own sentence for why the button is off, or `null` when it is on. */
  blockedReason: string | null
  /** Off when the surrounding flow starts the read itself (onboarding's Next). */
  withButton?: boolean
  /** The surrounding section already says "Website". */
  hideLabel?: boolean
}

export function WebsiteAnalyzeField({
  value,
  onChange,
  onAnalyze,
  intent,
  analyzing,
  price,
  blockedReason,
  withButton = true,
  hideLabel = false,
}: WebsiteAnalyzeFieldProps) {
  const label = intent === "regenerate" ? "Regenerate" : "Analyze"
  const noteId = "company-website-note"
  const disabled = analyzing || blockedReason !== null || value.trim() === ""

  const note =
    blockedReason ??
    (analyzing
      ? "Reading your website and writing your profile. This takes up to a minute."
      : price > 0
        ? `Reading your site again costs ${price} credits and replaces what is below.`
        : "Your first website analysis is free, and only counts once it works.")

  return (
    <Field>
      <FieldLabel className={hideLabel ? "sr-only" : undefined} htmlFor="company-website">
        Website
      </FieldLabel>
      <InputGroup>
        <InputGroupInput
          aria-describedby={noteId}
          autoComplete="url"
          disabled={analyzing}
          id="company-website"
          inputMode="url"
          placeholder="yourcompany.com"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !disabled) {
              event.preventDefault()
              onAnalyze()
            }
          }}
        />
        {withButton ? (
          <InputGroupAddon align="inline-end">
            <Button
              disabled={disabled}
              onClick={onAnalyze}
              size="sm"
              type="button"
            >
              {analyzing ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <HugeiconsIcon
                  aria-hidden="true"
                  data-icon="inline-start"
                  icon={Search01Icon}
                  strokeWidth={2}
                />
              )}
              {analyzing ? "Analyzing…" : label}
            </Button>
          </InputGroupAddon>
        ) : null}
      </InputGroup>

      <FieldDescription id={noteId}>{note}</FieldDescription>
    </Field>
  )
}
