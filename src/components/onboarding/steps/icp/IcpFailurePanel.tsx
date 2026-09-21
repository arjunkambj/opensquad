import { Alert02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { IcpMessage } from "@/components/onboarding/steps/icp/icp-copy"
import { Button } from "@/components/ui/button"

export type IcpFailurePanelProps = {
  message: IcpMessage
  onRetry: () => void
  retryDisabled?: boolean
  retryBlockedReason?: string | null
  onFillManually: () => void
}

export function IcpFailurePanel({
  message,
  onRetry,
  retryDisabled = false,
  retryBlockedReason = null,
  onFillManually,
}: IcpFailurePanelProps) {
  return (
    <div
      className="flex flex-col gap-3 rounded-lg bg-destructive/5 px-4 py-3"
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
      <div className="flex flex-wrap gap-2 pl-6">
        <Button
          disabled={retryDisabled}
          onClick={onRetry}
          type="button"
          variant="outline"
        >
          Try again
        </Button>
        <Button onClick={onFillManually} type="button" variant="ghost">
          Fill it in myself
        </Button>
      </div>
    </div>
  )
}
