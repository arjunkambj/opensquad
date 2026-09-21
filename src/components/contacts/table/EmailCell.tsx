import { Mail01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { LeadEmailStatus } from "../../../../convex/lib/validators"
import { EMAIL_STATE_LABEL } from "../contacts-model"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

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
      <span className="block max-w-56 truncate text-sm text-foreground" title={email}>
        {email ?? EMAIL_STATE_LABEL.found}
      </span>
    )
  }
  if (emailStatus === "revealing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
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
    <Button
      size="sm"
      variant="outline"
      disabled={pending || disabledReason !== null}
      title={disabledReason ?? `Costs ${price} credits`}
      onClick={onGetEmail}
    >
      <HugeiconsIcon icon={Mail01Icon} strokeWidth={2} />
      Get email
    </Button>
  )
}
