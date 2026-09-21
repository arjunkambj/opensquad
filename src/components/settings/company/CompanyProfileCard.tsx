import { CompanyProfileForm } from "@/components/kit/CompanyProfileForm"
import { PageSection } from "@/components/kit/PageSection"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { CompanyForm } from "@/lib/company-form"

export type CompanyProfileCardProps = {
  value: CompanyForm
  onChange: (patch: Partial<CompanyForm>) => void
  onSave: () => void
  analyzing: boolean
  complete: boolean
  dirty: boolean
  saving: boolean
  error: string | null
}

export function CompanyProfileCard({
  value,
  onChange,
  onSave,
  analyzing,
  complete,
  dirty,
  saving,
  error,
}: CompanyProfileCardProps) {
  return (
    <PageSection title="Company profile">
      <CompanyProfileForm disabled={analyzing} onChange={onChange} value={value} />
      <FormError message={error} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {complete ? null : (
          <p className="mr-auto text-sm text-muted-foreground">
            Fill in the required fields to save.
          </p>
        )}
        <Button
          disabled={!dirty || !complete || analyzing || saving}
          onClick={onSave}
          type="button"
        >
          {saving ? <Spinner data-icon="inline-start" /> : null}
          Save profile
        </Button>
      </div>
    </PageSection>
  )
}
