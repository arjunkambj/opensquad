import { useUser } from "@hexclave/react"
import { createFileRoute } from "@tanstack/react-router"
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

export const Route = createFileRoute("/_dashboard/settings")({
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
