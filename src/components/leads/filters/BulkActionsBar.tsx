import { Mail01Icon, Target02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Hint } from "@/components/kit/Hint"
import { Button } from "@/components/ui/button"
import type { SpendContext } from "../leads-model"

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
  const covered = (price: number) =>
    spend.remaining === null ? count : Math.floor(spend.remaining / price)

  const paidReason = (price: number) =>
    covered(price) === 0 ? "Not enough credits left." : null

  const emailsCovered = covered(prices.email)
  const researchCovered = covered(prices.research)

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted px-3 py-2">
      <p className="mr-auto text-sm text-foreground">
        <span className="font-medium">
          {count} {count === 1 ? "lead" : "leads"} selected
        </span>
      </p>

      <Hint
        content={
          paidReason(prices.email) ??
          `Finds each selected person's work email. ${prices.email} credits each; your credits cover ${Math.min(emailsCovered, count)} of ${count}.`
        }
      >
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || paidReason(prices.email) !== null}
          onClick={onGetEmails}
        >
          <HugeiconsIcon icon={Mail01Icon} strokeWidth={2} />
          Get emails
          <span className="text-muted-foreground">· {prices.email} cr</span>
        </Button>
      </Hint>

      <Hint
        content={
          paidReason(prices.research) ??
          `Researches each selected company and scores its fit. ${prices.research} credits each; your credits cover ${Math.min(researchCovered, count)} of ${count}.`
        }
      >
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || paidReason(prices.research) !== null}
          onClick={onResearch}
        >
          <HugeiconsIcon icon={Target02Icon} strokeWidth={2} />
          Research
          <span className="text-muted-foreground">· {prices.research} cr</span>
        </Button>
      </Hint>

      <Hint
        content={`Lets your agent find any missing email (${prices.email} credits each) and draft outreach for you to review. Nothing is sent yet.`}
      >
        <Button size="sm" disabled={busy} onClick={onApprove}>
          Approve
        </Button>
      </Hint>

      <Hint content="Skip the selected leads. Your agent won't research or contact them.">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onReject}>
          Reject
        </Button>
      </Hint>

      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}
