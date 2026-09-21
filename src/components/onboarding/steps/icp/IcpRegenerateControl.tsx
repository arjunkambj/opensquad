import { Hint } from "@/components/kit/Hint"
import { Button } from "@/components/ui/button"

export type IcpRegenerateControlProps = {
  label: string
  /** Credits this run costs; `0` while the free first run is still there. */
  price: number
  blockedReason: string | null
  disabled: boolean
  onRun: () => void
}

export function IcpRegenerateControl({
  label,
  price,
  blockedReason,
  disabled,
  onRun,
}: IcpRegenerateControlProps) {
  const note =
    blockedReason ??
    (price > 0
      ? `Costs ${price} credits and replaces what is on these three screens.`
      : "This run is free, and only counts once it works.")

  return (
    <Hint content={note}>
      <Button
        disabled={disabled || blockedReason !== null}
        onClick={onRun}
        type="button"
        variant="ghost"
      >
        {label}
      </Button>
    </Hint>
  )
}
