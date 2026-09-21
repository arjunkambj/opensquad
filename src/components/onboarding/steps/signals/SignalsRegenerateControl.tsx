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
      ? `Costs ${price} credits and replaces the signals on this screen.`
      : "This run is free, and only counts once it works.")

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={disabled || blockedReason !== null}
        onClick={onRun}
        size="sm"
        type="button"
        variant="outline"
      >
        {label}
      </Button>
      <p className="max-w-xs text-right text-xs text-muted-foreground">
        {note}
      </p>
    </div>
  )
}
