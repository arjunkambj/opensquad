import { useUser } from "@hexclave/react"
import { createFileRoute } from "@tanstack/react-router"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"
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
      <FieldGroup className="max-w-md">
        <Field>
          <FieldLabel htmlFor="display-name">Name</FieldLabel>
          <Input
            id="display-name"
            readOnly
            value={user.displayName ?? ""}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            readOnly
            value={user.primaryEmail ?? ""}
          />
        </Field>
      </FieldGroup>
    </div>
  )
}
