/**
 * Settings → Company, the profile card: the same fields and the same
 * completeness rule as onboarding dot 1, with a Save instead of a Next.
 *
 * Presentational — it renders the shared form and the save row, and says in
 * one line why Save is off when the form is short of what the rest of the
 * product needs.
 */
import type { CompanyForm } from "@/components/onboarding/steps/company/company-form"
import { CompanyProfileForm } from "@/components/onboarding/steps/company/CompanyProfileForm"
import { FormError, PermissionNote } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import type { WorkspaceRole } from "@/lib/workspace-role"

export type CompanyProfileCardProps = {
  value: CompanyForm
  onChange: (patch: Partial<CompanyForm>) => void
  onSave: () => void
  role: WorkspaceRole
  canEdit: boolean
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
  role,
  canEdit,
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
          disabled={analyzing || !canEdit}
          onChange={onChange}
          value={value}
        />
        <FormError message={error} />
        {canEdit ? (
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
        ) : (
          <PermissionNote role={role} action="edit the company profile" />
        )}
      </CardContent>
    </Card>
  )
}
