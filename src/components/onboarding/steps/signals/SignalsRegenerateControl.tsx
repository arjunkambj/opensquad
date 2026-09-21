import { Hint } from "@/components/kit/Hint"
import { Button } from "@/components/ui/button"

export type SignalsRegenerateControlProps = {
  label: string
  /** Credits this run costs; `0` while the free first run is still there. */
  price: number
  blockedReason: string | null
  disabled: boolean
  onRun: () => void
}

export function SignalsRegenerateControl({
  label,
  price,
  blockedReason,
  disabled,
  onRun,
}: SignalsRegenerateControlProps) {
  const note =
    blockedReason ??
    (price > 0
      ? `Costs ${price} credits and replaces these signals.`
      : "Free, and only counts once it works.")

  return (
    <Hint content={note}>
      <Button
        disabled={disabled || blockedReason !== null}
        onClick={onRun}
        type="button"
        variant="outline"
      >
        {label}
      </Button>
    </Hint>
  )
}
