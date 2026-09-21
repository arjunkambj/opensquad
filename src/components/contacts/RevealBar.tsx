import { Mail01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Hint } from "@/components/kit/Hint"
import { Button } from "@/components/ui/button"
import type { SpendContext } from "@/components/leads/leads-model"

export function RevealBar({
  count,
  busy,
  spend,
  price,
  onReveal,
  onClear,
}: {
  count: number
  busy: boolean
  spend: SpendContext
  price: number
  onReveal: () => void
  onClear: () => void
}) {
  const covered =
    spend.remaining === null ? count : Math.floor(spend.remaining / price)

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted px-3 py-2">
      <p className="mr-auto text-sm font-medium text-foreground">
        {count} {count === 1 ? "contact" : "contacts"} selected
      </p>
      <Hint
        content={
          covered === 0
            ? "Not enough credits left."
            : `Finds each selected person's work email. ${price} credits each; your credits cover ${Math.min(covered, count)} of ${count}. Bulk reveals skip anyone scored below 2.`
        }
      >
        <Button size="sm" disabled={busy || covered === 0} onClick={onReveal}>
          <HugeiconsIcon icon={Mail01Icon} strokeWidth={2} />
          Reveal emails
          <span className="opacity-70">· {price} cr each</span>
        </Button>
      </Hint>
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}
