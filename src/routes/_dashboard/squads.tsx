import { createFileRoute } from "@tanstack/react-router"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const Route = createFileRoute("/_dashboard/squads")({
  component: SquadsPage,
})

function SquadsPage() {
  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Squads"
        description="People you build with."
      />
      <Card>
        <CardHeader>
          <CardTitle>Your squads</CardTitle>
          <CardDescription>
            Invite teammates when you are ready to collaborate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No squads yet.</p>
        </CardContent>
      </Card>
    </div>
  )
}
