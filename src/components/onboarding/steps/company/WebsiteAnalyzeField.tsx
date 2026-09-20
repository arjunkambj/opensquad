/**
 * The website row at the top of onboarding step 1 (references 01 and 02): one
 * address field with the action sitting inside it, the price of that action
 * underneath, and the way past it for someone who has no website.
 *
 * One button, two jobs. Before there is a profile it reads **Analyze**; once
 * the site has been read it reads **Regenerate** and carries its price, which
 * is the honest way to say that pressing it again reads the site again and
 * costs credits (PLAN §5).
 *
 * Presentational: it never calls Convex and never decides whether the user can
 * afford anything — the step container hands it the price and the reason.
 */
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
  /** Offered only before a profile exists — "I don't have a website". */
  onSkip?: () => void
}

export function WebsiteAnalyzeField({
  value,
  onChange,
  onAnalyze,
  intent,
  analyzing,
  price,
  blockedReason,
  onSkip,
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
      <FieldLabel htmlFor="company-website">Website</FieldLabel>
      <InputGroup className="h-12 rounded-2xl">
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
        <InputGroupAddon align="inline-end">
          <Button
            disabled={disabled}
            onClick={onAnalyze}
            size="sm"
            type="button"
          >
            {analyzing ? (
              <Spinner className="size-4" data-icon="inline-start" />
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
      </InputGroup>

      <FieldDescription id={noteId}>{note}</FieldDescription>

      {onSkip !== undefined ? (
        <div className="flex justify-center">
          <Button
            className="text-muted-foreground"
            disabled={analyzing}
            onClick={onSkip}
            size="sm"
            type="button"
            variant="ghost"
          >
            I don&rsquo;t have a website
          </Button>
        </div>
      ) : null}
    </Field>
  )
}
