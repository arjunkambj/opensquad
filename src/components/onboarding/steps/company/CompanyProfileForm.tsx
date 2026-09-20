/**
 * The editable company profile (reference 02).
 *
 * Presentational: it holds no Convex call and no state of its own. The step
 * container owns the values, the save and the analysis that fills them in.
 *
 * Everything the analysis writes is editable, and the required markers name
 * exactly the four fields the rest of the product cannot run without — social
 * proof is not one of them, because a young company honestly has none and an
 * invented proof is worse than a blank field.
 */
import { COMPANY_INDUSTRIES } from "../../../../../convex/ai/analyzeWebsite"
import {
  COMPANY_DESCRIPTION_MAX_LENGTH,
  COMPANY_LIST_MAX_ITEMS,
  COMPANY_NAME_MAX_LENGTH,
} from "../../../../../convex/lib/validators"
import type { CompanyForm } from "@/components/onboarding/steps/company/company-form"
import { RowListField } from "@/components/onboarding/steps/company/RowListField"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"

export type CompanyProfileFormProps = {
  value: CompanyForm
  onChange: (patch: Partial<CompanyForm>) => void
  disabled?: boolean
}

function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-destructive">
      *
    </span>
  )
}

export function CompanyProfileForm({
  value,
  onChange,
  disabled = false,
}: CompanyProfileFormProps) {
  // A stored industry from an older list (or typed by hand) stays selectable
  // rather than being silently swapped for the first option.
  const industryOptions =
    value.industry !== "" &&
    !(COMPANY_INDUSTRIES as readonly string[]).includes(value.industry)
      ? [value.industry, ...COMPANY_INDUSTRIES]
      : COMPANY_INDUSTRIES

  return (
    <FieldGroup className="gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel className="gap-1" htmlFor="company-name">
            Company name
            <RequiredMark />
          </FieldLabel>
          <Input
            className="h-10"
            disabled={disabled}
            id="company-name"
            maxLength={COMPANY_NAME_MAX_LENGTH}
            required
            value={value.companyName}
            onChange={(event) => onChange({ companyName: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel className="gap-1" htmlFor="company-industry">
            Industry
            <RequiredMark />
          </FieldLabel>
          <NativeSelect
            className="h-10"
            disabled={disabled}
            id="company-industry"
            required
            value={value.industry}
            onChange={(event) => onChange({ industry: event.target.value })}
          >
            <option value="">Choose an industry</option>
            {industryOptions.map((industry) => (
              <option key={industry} value={industry}>
                {industry}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field>
        <FieldLabel className="gap-1" htmlFor="company-description">
          What you do and why it is worth buying
          <RequiredMark />
        </FieldLabel>
        <Textarea
          className="min-h-28"
          disabled={disabled}
          id="company-description"
          maxLength={COMPANY_DESCRIPTION_MAX_LENGTH}
          required
          value={value.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
        <FieldDescription>
          Every email your agent writes is built from this. Two or three plain
          sentences work better than a tagline.
        </FieldDescription>
      </Field>

      <RowListField
        addPlaceholder="Add a key feature…"
        description="What your product actually does. Your agent may only claim what is on this list."
        disabled={disabled}
        label="Key features"
        maxCount={COMPANY_LIST_MAX_ITEMS}
        onChange={(keyFeatures) => onChange({ keyFeatures })}
        removeLabel={(index) => `Remove key feature ${index + 1}`}
        required
        rowLabel={(index) => `Key feature ${index + 1}`}
        values={value.keyFeatures}
      />

      <RowListField
        addPlaceholder="Add a customer, result or number…"
        description="Named customers, results or credentials you can stand behind. Leave it empty rather than inventing one."
        disabled={disabled}
        label="Social proof"
        maxCount={COMPANY_LIST_MAX_ITEMS}
        onChange={(socialProof) => onChange({ socialProof })}
        removeLabel={(index) => `Remove social proof ${index + 1}`}
        rowLabel={(index) => `Social proof ${index + 1}`}
        values={value.socialProof}
      />
    </FieldGroup>
  )
}
