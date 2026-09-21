import { RowListField } from "@/components/kit/RowListField"
import { COMPANY_FIELD_LIMITS, industryOptions } from "@/lib/company-form"
import type { CompanyForm } from "@/lib/company-form"
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
  const industries = industryOptions(value.industry)

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
            maxLength={COMPANY_FIELD_LIMITS.name}
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
            {industries.map((industry) => (
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
          maxLength={COMPANY_FIELD_LIMITS.description}
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
        maxCount={COMPANY_FIELD_LIMITS.listItems}
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
        maxCount={COMPANY_FIELD_LIMITS.listItems}
        onChange={(socialProof) => onChange({ socialProof })}
        removeLabel={(index) => `Remove social proof ${index + 1}`}
        rowLabel={(index) => `Social proof ${index + 1}`}
        values={value.socialProof}
      />
    </FieldGroup>
  )
}
