import { Hint } from "@/components/kit/Hint"

export function SignalCell({
  signals,
}: {
  signals: readonly { strategyId: string; title: string }[]
}) {
  const first = signals[0]
  if (first === undefined) {
    return (
      <span className="text-xs text-muted-foreground">No signal on file</span>
    )
  }
  const rest = signals.slice(1)
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate text-sm text-foreground">{first.title}</span>
      {rest.length > 0 ? (
        <Hint content={rest.map((signal) => signal.title).join(" · ")}>
          <span className="inline-flex shrink-0 items-center rounded-lg bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            +{rest.length} {rest.length === 1 ? "signal" : "signals"}
          </span>
        </Hint>
      ) : null}
    </div>
  )
}
