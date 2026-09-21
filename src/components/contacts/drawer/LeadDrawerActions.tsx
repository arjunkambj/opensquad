/** Lead approval authorizes address lookup and drafting; it does not authorize sending. */
import { Mail01Icon, Refresh01Icon, Target02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@/components/ui/button"
import {
  decisionDisabledReason,
  emailDisabledReason,
  LEAD_ERROR_COPY,
  researchDisabledReason,
  retryAction,
  type ContactDetailData,
  type SpendContext,
} from "../contacts-model"

export function LeadDrawerActions({
  lead,
  busy,
  spend,
  prices,
  onApprove,
  onReject,
  onGetEmail,
  onResearch,
}: {
  lead: ContactDetailData["lead"]
  busy: boolean
  spend: SpendContext
  prices: { email: number; research: number }
  onApprove: () => void
  onReject: () => void
  onGetEmail: () => void
  onResearch: () => void
}) {
  const emailReason = emailDisabledReason(lead, prices.email, spend)
  const researchReason = researchDisabledReason(lead, prices.research, spend)
  const approveReason = decisionDisabledReason(lead, "approved")
  const rejectReason = decisionDisabledReason(lead, "rejected")
  const parked = lead.stage === "needs_attention"
  const retry = retryAction(lead, prices.research, spend)

  return (
    <div className="flex flex-col gap-3">
      {parked ? (
        <div className="rounded-2xl border border-destructive/40 px-4 py-3">
          <p className="text-sm text-destructive">
            {lead.lastErrorCode === undefined
              ? (lead.stageReason ?? "A step kept failing for this lead.")
              : LEAD_ERROR_COPY[lead.lastErrorCode]}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={busy || retry.disabled !== null}
            title={
              retry.disabled ??
              (retry.price === 0
                ? "Puts this lead back in the queue at no cost"
                : `Costs ${retry.price} credits`)
            }
            onClick={onResearch}
          >
            <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
            {retry.label}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || approveReason !== null}
          title={approveReason ?? "Authorises finding an email and drafting"}
          onClick={onApprove}
        >
          Approve for outreach
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || rejectReason !== null}
          title={rejectReason ?? undefined}
          onClick={onReject}
        >
          Reject
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || emailReason !== null}
          title={emailReason ?? `Costs ${prices.email} credits`}
          onClick={onGetEmail}
        >
          <HugeiconsIcon icon={Mail01Icon} strokeWidth={2} />
          Get email · {prices.email} credits
        </Button>
        {parked ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || researchReason !== null}
            title={researchReason ?? `Costs ${prices.research} credits`}
            onClick={onResearch}
          >
            <HugeiconsIcon icon={Target02Icon} strokeWidth={2} />
            Research · {prices.research} credits
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Approving a lead is not approving a message. Nothing is sent until an
        email itself is approved.
      </p>
    </div>
  )
}
