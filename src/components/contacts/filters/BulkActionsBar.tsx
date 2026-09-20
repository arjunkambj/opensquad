/**
 * Bulk actions (ref 23, top right of the table).
 *
 * Every button says what it will do to how many leads and what that costs,
 * and a button that cannot run is disabled with the reason ON it rather than
 * greyed out in silence. The two paid ones also say how far the credit
 * balance actually reaches — "Get emails" on nine leads with credits for four
 * is honest about the four before it is pressed, not afterwards.
 */
import { Mail01Icon, Target02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@/components/ui/button"
import type { SpendContext } from "../contacts-model"

export function BulkActionsBar({
  count,
  busy,
  spend,
  prices,
  onGetEmails,
  onResearch,
  onApprove,
  onReject,
  onClear,
}: {
  count: number
  busy: boolean
  spend: SpendContext
  prices: { email: number; research: number }
  onGetEmails: () => void
  onResearch: () => void
  onApprove: () => void
  onReject: () => void
  onClear: () => void
}) {
  const none = count === 0
  const roleReason = spend.canAct ? null : "Your role cannot change leads."
  const selectReason = none ? "Select at least one contact." : null
  const covered = (price: number) =>
    spend.remaining === null ? count : Math.floor(spend.remaining / price)

  const paidReason = (price: number) =>
    roleReason ??
    selectReason ??
    (covered(price) === 0 ? "Not enough credits left." : null)

  const emailsCovered = covered(prices.email)
  const researchCovered = covered(prices.research)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex flex-col">
        <p className="text-sm font-medium text-foreground">
          {none
            ? "No contacts selected"
            : `${count} ${count === 1 ? "contact" : "contacts"} selected`}
        </p>
        <p className="text-xs text-muted-foreground">
          Approving authorises finding an email and drafting — it sends
          nothing.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || paidReason(prices.email) !== null}
          title={
            paidReason(prices.email) ??
            `${prices.email} credits each · credits cover ${Math.min(emailsCovered, count)} of ${count}`
          }
          onClick={onGetEmails}
        >
          <HugeiconsIcon icon={Mail01Icon} strokeWidth={2} />
          Get emails
          {none ? null : (
            <span className="text-muted-foreground">
              · {prices.email} credits each
            </span>
          )}
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={busy || paidReason(prices.research) !== null}
          title={
            paidReason(prices.research) ??
            `${prices.research} credits each · credits cover ${Math.min(researchCovered, count)} of ${count}`
          }
          onClick={onResearch}
        >
          <HugeiconsIcon icon={Target02Icon} strokeWidth={2} />
          Research
          {none ? null : (
            <span className="text-muted-foreground">
              · {prices.research} credits each
            </span>
          )}
        </Button>

        <Button
          size="sm"
          disabled={busy || roleReason !== null || none}
          title={roleReason ?? selectReason ?? undefined}
          onClick={onApprove}
        >
          Approve
        </Button>

        <Button
          size="sm"
          variant="ghost"
          disabled={busy || roleReason !== null || none}
          title={roleReason ?? selectReason ?? undefined}
          onClick={onReject}
        >
          Reject
        </Button>

        {none ? null : (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}
