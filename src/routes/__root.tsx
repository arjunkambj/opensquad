import { Link, Outlet, createRootRoute } from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"
import { EmptyState, ErrorState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { errorMessage } from "@/lib/convex-error"

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootError,
  notFoundComponent: RootNotFound,
})

function RootLayout() {
  return (
    <>
      <Outlet />
      {import.meta.env.DEV ? <TanStackRouterDevtools /> : null}
    </>
  )
}

/**
 * Last-resort boundary — a thrown query (transient auth, role revocation
 * mid-session, NOT_FOUND) unmounts everything below it, so the boundary
 * lives on the root rather than per-page.
 */
function RootError({ error, reset }: ErrorComponentProps) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <ErrorState
        className="w-full max-w-md"
        title="Something went wrong"
        description={errorMessage(error, "An unexpected error occurred.")}
        onRetry={reset}
      />
    </div>
  )
}

function RootNotFound() {
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
