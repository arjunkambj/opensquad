import { Mail01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { LeadEmailStatus } from "../../../../convex/lib/validators"
import { EMAIL_STATE_LABEL } from "../leads-model"
import { Hint } from "@/components/kit/Hint"
import { Button } from "@/components/ui/button"

export function EmailCell({
  emailStatus,
  email,
  price,
  disabledReason,
  pending,
  onGetEmail,
}: {
  emailStatus: LeadEmailStatus
  email?: string
  price: number
  disabledReason: string | null
  pending: boolean
  onGetEmail: () => void
}) {
  if (emailStatus === "found") {
    return (
      <Hint content={email}>
        <span className="block max-w-56 truncate text-sm text-foreground">
          {email ?? EMAIL_STATE_LABEL.found}
        </span>
      </Hint>
    )
  }
  if (emailStatus === "revealing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 animate-pulse rounded-full bg-primary"
        />
        {EMAIL_STATE_LABEL.revealing}
      </span>
    )
  }
  if (emailStatus === "not_found") {
    return (
      <span className="text-xs text-muted-foreground">
        {EMAIL_STATE_LABEL.not_found}
      </span>
    )
  }
  return (
    <Hint
      content={
        disabledReason ??
        `Looks up and verifies this person's work email. Costs ${price} credits.`
      }
    >
      <Button
        size="sm"
        variant="outline"
        disabled={pending || disabledReason !== null}
        onClick={onGetEmail}
      >
        <HugeiconsIcon icon={Mail01Icon} strokeWidth={2} />
        Get email
        <span className="text-muted-foreground">· {price} cr</span>
      </Button>
    </Hint>
  )
}
