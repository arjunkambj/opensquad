/**
 * The 30-day import's progress line (PLAN §4 "Manage inbox" step 5).
 *
 * Four states, all designed: preparing, "Syncing n threads…", synced, and a
 * failed import that offers to resume. A failed import never reads as an
 * outage — new mail keeps arriving through the webhook either way, and the
 * line says so.
 */
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { InboxSyncView } from "./inbox-connection-model"
import { syncLabel } from "./inbox-connection-model"

export function InboxSyncStatus({
  sync,
  onRetry,
  retrying = false,
}: {
  sync: InboxSyncView
  /** Resume a failed import. Omit where the caller cannot run it. */
  onRetry?: () => void
  retrying?: boolean
}) {
  const running = sync.state === "idle" || sync.state === "importing"
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {running ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
        <p
          className={
            sync.state === "failed"
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
          role={running ? "status" : undefined}
          aria-live={running ? "polite" : undefined}
        >
          {syncLabel(sync)}
        </p>
      </div>
      {sync.state === "failed" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">
            New mail still arrives normally; only the older history is
            incomplete.
          </p>
          {onRetry ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={retrying}
              onClick={onRetry}
            >
              Resume import
              {retrying ? <Spinner className="size-3.5" /> : null}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
