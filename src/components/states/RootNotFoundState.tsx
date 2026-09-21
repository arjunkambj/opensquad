import { Link } from "@tanstack/react-router"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"

export function RootNotFoundState() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <EmptyState
        className="w-full max-w-md"
        title="Page not found"
        description="The page you're looking for doesn't exist."
        action={
          <Button render={<Link to="/overview" />}>Back to Overview</Button>
        }
      />
    </div>
  )
}
