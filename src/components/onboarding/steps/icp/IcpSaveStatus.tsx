import { Alert02Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { IcpSaveState } from "@/components/onboarding/steps/icp/use-icp-draft"
import { Spinner } from "@/components/ui/spinner"

export function IcpSaveStatus({ state }: { state: IcpSaveState }) {
  return (
    <p
      aria-live="polite"
      className="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
    >
      {state === "saving" ? (
        <>
          <Spinner className="size-3" />
          Saving…
        </>
      ) : null}
      {state === "saved" ? (
        <>
          <HugeiconsIcon
            aria-hidden="true"
            className="size-3"
            icon={Tick02Icon}
            strokeWidth={2.5}
          />
          Saved
        </>
      ) : null}
      {state === "error" ? (
        <span className="flex items-center gap-1.5 text-destructive">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-3"
            icon={Alert02Icon}
            strokeWidth={2}
          />
          Not saved
        </span>
      ) : null}
    </p>
  )
}
