/** A failed historical import does not stop new mail arriving through the webhook. */
import { Hint } from "@/components/kit/Hint"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { InboxSyncView } from "./inbox-connection-model"
import { syncLabel } from "./inbox-connection-model"

/** The value of the "Imported" row: progress, result, or a resume action. */
export function InboxSyncStatus({
  sync,
  onRetry,
  retrying = false,
}: {
  sync: InboxSyncView
  onRetry?: () => void
  retrying?: boolean
}) {
  const running = sync.state === "idle" || sync.state === "importing"
  const failed = sync.state === "failed"
  return (
    <span className="flex flex-wrap items-center gap-2">
      {running ? (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 animate-pulse rounded-full bg-primary"
        />
      ) : null}
      <Hint content={failed ? "New mail still arrives." : null}>
        <span
          className={failed ? "text-destructive" : undefined}
          role={running ? "status" : undefined}
          aria-live={running ? "polite" : undefined}
        >
          {syncLabel(sync)}
        </span>
      </Hint>
      {failed && onRetry ? (
        <Button
          type="button"
          variant="outline"
          disabled={retrying}
          onClick={onRetry}
        >
          {retrying ? <Spinner data-icon="inline-start" /> : null}
          Resume import
        </Button>
      ) : null}
    </span>
  )
}
