import { Link } from "@tanstack/react-router"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"

/** Not-found outside the signed-in shell — no sidebar exists to keep. */
export function RootNotFoundState() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <EmptyState
        className="w-full max-w-md"
        title="Page not found"
        description="The page you're looking for doesn't exist."
        action={<Button render={<Link to="/leads" />}>Back to your leads</Button>}
      />
    </div>
  )
}
