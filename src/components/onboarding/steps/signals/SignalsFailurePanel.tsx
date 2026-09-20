/**
 * What a failed recommendation looks like (PLAN §5 "Onboarding edge cases").
 *
 * It says in our own words what happened and offers the one thing that can
 * actually help: run it again. There is deliberately no "do it myself" escape
 * here — a strategy is a real query with a real match count behind it, so a
 * hand-written one would be a number nobody counted (PLAN §2).
 *
 * The wording arrives already chosen (`signals-copy.ts`); nothing here reads
 * a provider's error.
 */
import { Alert02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { SignalsMessage } from "@/components/onboarding/steps/signals/signals-copy"
import { Button } from "@/components/ui/button"

export type SignalsFailurePanelProps = {
  message: SignalsMessage
  onRetry: () => void
  retryDisabled?: boolean
  /** Why Try again can't run, when it can't. */
  retryBlockedReason?: string | null
}

export function SignalsFailurePanel({
  message,
  onRetry,
  retryDisabled = false,
  retryBlockedReason = null,
}: SignalsFailurePanelProps) {
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3"
      role="alert"
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
          {retryBlockedReason !== null ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {retryBlockedReason}
            </p>
          ) : null}
        </div>
      </div>
      <div className="pl-6">
        <Button
          disabled={retryDisabled || retryBlockedReason !== null}
          onClick={onRetry}
          size="sm"
          type="button"
          variant="outline"
        >
          Try again
        </Button>
      </div>
    </div>
  )
}
