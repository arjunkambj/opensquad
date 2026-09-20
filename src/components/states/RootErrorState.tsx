import type { ErrorComponentProps } from "@tanstack/react-router"
import { ErrorState } from "@/components/states/states"
import { errorMessage } from "@/lib/convex-error"

/**
 * Last-resort boundary — a thrown query (transient auth, role revocation
 * mid-session, NOT_FOUND) unmounts everything below it, so the boundary
 * lives on the root rather than per-page.
 */
export function RootErrorState({ error, reset }: ErrorComponentProps) {
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
