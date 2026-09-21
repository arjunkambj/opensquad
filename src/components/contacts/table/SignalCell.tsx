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
      <span className="truncate text-sm text-foreground" title={first.title}>
        {first.title}
      </span>
      {rest.length > 0 ? (
        <span
          title={rest.map((signal) => signal.title).join(" · ")}
          className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
        >
          +{rest.length} {rest.length === 1 ? "signal" : "signals"}
        </span>
      ) : null}
    </div>
  )
}
