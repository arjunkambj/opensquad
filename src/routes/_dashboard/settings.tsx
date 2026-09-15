import { useUser } from "@hexclave/react"
import { createFileRoute } from "@tanstack/react-router"
import { optionalOneOf } from "@/lib/search-params"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"
import { SettingsSections } from "@/components/settings/SettingsSections"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/**
 * `?section=` rather than seven route files. The requirement is a deep link: a
 * `connection_required` decision must be able to point at the runtime
 * controls, and a send blocked by the policy window at the sending policy.
 * One `validateSearch` delivers that; seven route files deliver the same thing
 * and a week we do not have.
 */
export const SETTINGS_SECTIONS = [
  "account",
  "workspace",
  "sending",
  "automation",
  "members",
  "runtime",
  "integrations",
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const DEFAULT_SETTINGS_SECTION: SettingsSection = "workspace"

export const Route = createFileRoute("/_dashboard/settings")({
  validateSearch: (search): { section?: SettingsSection } => ({
    section: optionalOneOf(SETTINGS_SECTIONS, search.section),
  }),
  component: SettingsPage,
})

function SettingsPage() {
  const user = useUser()

  if (!user) {
    return null
  }

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Settings"
        description="Your profile and workspace preferences."
      />
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Your sign-in identity, managed by Hexclave.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="display-name">Name</FieldLabel>
              <Input
                id="display-name"
                readOnly
                value={user.displayName ?? ""}
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      <SettingsSections />
    </div>
  )
}
