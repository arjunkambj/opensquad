/**
 * Settings → Company, the profile card: the same fields and the same
 * completeness rule as onboarding dot 1, with a Save instead of a Next.
 *
 * Presentational — it renders the shared form and the save row, and says in
 * one line why Save is off when the form is short of what the rest of the
 * product needs.
 */
import { CompanyProfileForm } from "@/components/kit/CompanyProfileForm"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import type { CompanyForm } from "@/lib/company-form"

export type CompanyProfileCardProps = {
  value: CompanyForm
  onChange: (patch: Partial<CompanyForm>) => void
  onSave: () => void
  /** Fields are frozen while an analysis is rewriting them. */
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
    <Card>
      <CardHeader>
        <CardTitle>Company profile</CardTitle>
        <CardDescription>
          Every email your agent writes is built from these lines, so they are
          worth keeping current.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <CompanyProfileForm
          disabled={analyzing}
          onChange={onChange}
          value={value}
        />
        <FormError message={error} />
                  <div className="flex flex-wrap items-center justify-end gap-3">
            {complete ? null : (
              <p className="mr-auto text-sm text-muted-foreground">
                A company name, an industry, a description and at least one key
                feature are needed before this can be saved.
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
      </CardContent>
    </Card>
  )
}
