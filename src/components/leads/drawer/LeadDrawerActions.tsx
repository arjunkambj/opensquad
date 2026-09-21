/** Lead approval authorizes address lookup and drafting; it does not authorize sending. */
import { Mail01Icon, Refresh01Icon, Target02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Hint } from "@/components/kit/Hint"
import { Button } from "@/components/ui/button"
import {
  decisionDisabledReason,
  emailDisabledReason,
  LEAD_ERROR_COPY,
  researchDisabledReason,
  retryAction,
  type LeadDetailData,
  type SpendContext,
} from "../leads-model"

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
  lead: LeadDetailData["lead"]
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
          <Hint
            content={
              retry.disabled ??
              (retry.price === 0
                ? "Puts this lead back in the queue at no cost"
                : `Costs ${retry.price} credits`)
            }
          >
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={busy || retry.disabled !== null}
              onClick={onResearch}
            >
              <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
              {retry.label}
            </Button>
          </Hint>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Hint
          content={
            approveReason ?? "Lets your agent find this person's email and draft an outreach email for you to review. Nothing is sent yet."
          }
        >
          <Button
            size="sm"
            disabled={busy || approveReason !== null}
            onClick={onApprove}
          >
            Approve for outreach
          </Button>
        </Hint>
        <Hint
          content={
            rejectReason ?? "Skip this lead. Your agent won't research or contact them."
          }
        >
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || rejectReason !== null}
            onClick={onReject}
          >
            Reject
          </Button>
        </Hint>
        <Hint
          content={
            emailReason ?? `Looks up and verifies this person's work email. Costs ${prices.email} credits.`
          }
        >
          <Button
            size="sm"
            variant="outline"
            disabled={busy || emailReason !== null}
            onClick={onGetEmail}
          >
            <HugeiconsIcon icon={Mail01Icon} strokeWidth={2} />
            Get email · {prices.email} credits
          </Button>
        </Hint>
        {parked ? null : (
          <Hint
            content={
              researchReason ?? `Researches this company and scores how good a fit it is. Costs ${prices.research} credits.`
            }
          >
            <Button
              size="sm"
              variant="outline"
              disabled={busy || researchReason !== null}
              onClick={onResearch}
            >
              <HugeiconsIcon icon={Target02Icon} strokeWidth={2} />
              Research · {prices.research} credits
            </Button>
          </Hint>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Approving a lead is not approving a message. Nothing is sent until an
        email itself is approved.
      </p>
    </div>
  )
}
