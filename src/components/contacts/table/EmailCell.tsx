/**
 * The email column (ref 23's Enrich Email button, in our words).
 *
 * Four states, never three: `locked` is "nobody has paid to find this yet",
 * `not_found` is "we paid and there is none on file" — an address we do not
 * have and an address that does not exist are different facts, and only one of
 * them is worth spending credits on again.
 *
 * The button states its price, and says why it is disabled rather than simply
 * being grey.
 */
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
  /** Why Get email cannot run, or `null` when it can. */
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
