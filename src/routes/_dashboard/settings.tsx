import { useHexclaveApp, useUser } from "@hexclave/react"
import { createFileRoute } from "@tanstack/react-router"
import { optionalOneOf } from "@/lib/search-params"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"
import {
  SettingsSections,
  settingsSectionId,
} from "@/components/settings/SettingsSections"
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
  const app = useHexclaveApp()

  // The workspace sections must not wait on the user object — a `return null`
  // here blanked the whole page, which is never a page-level outcome. The
  // Account card is the only part that needs it.
  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Settings"
        description="Your profile and workspace preferences."
      />
      {user ? (
        <Card
          className="max-w-3xl scroll-mt-6"
          id={settingsSectionId("account")}
        >
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              Your sign-in identity, managed by Hexclave.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {user.displayName === null ? (
                // An empty readOnly input renders identical to a loading
                // skeleton — a box that says nothing about an unset name. The
                // email is the identity; the hint names what is missing and
                // where it can actually be changed.
                <Field>
                  <FieldLabel>Email</FieldLabel>
                  <p className="text-sm text-foreground">
                    {user.primaryEmail ?? "—"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    No display name set.{" "}
                    <a
                      className="font-medium text-foreground underline underline-offset-2"
                      href={app.urls.accountSettings}
                    >
                      Manage your account
                    </a>{" "}
                    to add one.
                  </p>
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor="display-name">Name</FieldLabel>
                  <Input
                    id="display-name"
                    readOnly
                    value={user.displayName}
                  />
                </Field>
              )}
            </FieldGroup>
          </CardContent>
        </Card>
      ) : null}
      <SettingsSections />
    </div>
  )
}
