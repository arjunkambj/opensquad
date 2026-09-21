import type { ErrorComponentProps } from "@tanstack/react-router"
import { ErrorState } from "@/components/states/states"
import { errorMessage } from "@/lib/convex-error"

/** Keep the last-resort boundary above auth, Convex and route rendering. */
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
