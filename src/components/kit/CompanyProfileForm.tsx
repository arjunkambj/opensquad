import { RowListField } from "@/components/kit/RowListField"
import { COMPANY_FIELD_LIMITS, industryOptions } from "@/lib/company-form"
import type { CompanyForm } from "@/lib/company-form"
import {
  Field,
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

export function CompanyProfileForm({
  value,
  onChange,
  disabled = false,
}: CompanyProfileFormProps) {
  const industries = industryOptions(value.industry)

  return (
    <FieldGroup>
      <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="company-name">
            Company name
          </FieldLabel>
          <Input
            disabled={disabled}
            id="company-name"
            maxLength={COMPANY_FIELD_LIMITS.name}
            required
            value={value.companyName}
            onChange={(event) => onChange({ companyName: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="company-industry">
            Industry
          </FieldLabel>
          <NativeSelect
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
        <FieldLabel htmlFor="company-description">
          What you do
        </FieldLabel>
        <Textarea
          className="min-h-24"
          disabled={disabled}
          id="company-description"
          maxLength={COMPANY_FIELD_LIMITS.description}
          placeholder="What you sell, who it's for and why it matters."
          required
          value={value.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </Field>

      <RowListField
        addPlaceholder="Add a feature, then press Enter"
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
        addPlaceholder="A customer, result or number"
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
