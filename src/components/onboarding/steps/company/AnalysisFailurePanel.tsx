/**
 * What a failed website analysis looks like (PLAN §5 "Onboarding edge cases").
 *
 * It keeps the address, says in our own words what happened, and offers the
 * two ways forward the plan requires: try again, or write the profile by hand.
 * The wording arrives already chosen (`analysis-copy.ts`) — nothing here reads
 * a provider's error.
 */
import { Alert02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { AnalysisMessage } from "@/components/onboarding/steps/company/analysis-copy"
import { Button } from "@/components/ui/button"

export type AnalysisFailurePanelProps = {
  message: AnalysisMessage
  onRetry: () => void
  retryDisabled?: boolean
  /** Absent once the form is already open. */
  onFillManually?: () => void
}

export function AnalysisFailurePanel({
  message,
  onRetry,
  retryDisabled = false,
  onFillManually,
}: AnalysisFailurePanelProps) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <HugeiconsIcon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-destructive"
          icon={Alert02Icon}
          strokeWidth={2}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{message.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {message.description}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-6">
        <Button
          disabled={retryDisabled}
          onClick={onRetry}
          size="sm"
          type="button"
          variant="outline"
        >
          Try again
        </Button>
        {onFillManually !== undefined ? (
          <Button
            onClick={onFillManually}
            size="sm"
            type="button"
            variant="ghost"
          >
            Fill it in myself
          </Button>
        ) : null}
      </div>
    </div>
  )
}
