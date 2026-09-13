import type { SourceConfig } from "../../../convex/lib/validators"

const SOURCE_LABELS: Record<SourceConfig["source"], string> = {
  apollo: "Apollo — company search",
  yc: "Y Combinator directory",
  trustmrr: "TrustMRR revenue index",
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  )
}

function joinOr(value: string[] | undefined): string {
  return value !== undefined && value.length > 0
    ? value.join(", ")
    : "Any"
}

/**
 * Read-only rendering of the typed source plan exactly as it will be stored —
 * the "interpreted" view the owner confirms before anything may run (V03).
 */
export function SourcePlanSummary({ sources }: { sources: SourceConfig[] }) {
  return (
    <div className="flex flex-col gap-3">
      {sources.map((config) => (
        <div
          key={config.source}
          className="rounded-2xl border border-border px-4 py-3"
        >
          <p className="pb-1 text-sm font-medium">
            {SOURCE_LABELS[config.source]}
          </p>
          {config.source === "apollo" ? (
            <>
              <Row label="Locations" value={joinOr(config.filters.locations)} />
              <Row
                label="Categories"
                value={joinOr(config.filters.categories)}
              />
              <Row
                label="Employees"
                value={
                  config.filters.employeeCount !== undefined
                    ? `${config.filters.employeeCount.min} – ${config.filters.employeeCount.max}`
                    : "Any"
                }
              />
            </>
          ) : null}
          {config.source === "yc" ? (
            <>
              <Row label="Batch" value={config.filters.batch ?? "Any"} />
              <Row
                label="Categories"
                value={joinOr(config.filters.categories)}
              />
              <Row label="Locations" value={joinOr(config.filters.locations)} />
            </>
          ) : null}
          {config.source === "trustmrr" ? (
            <>
              <Row
                label="Metric"
                value={`${config.filters.metric} (${config.filters.currency}, ${config.filters.period})`}
              />
              <Row
                label="Bounds"
                value={
                  config.filters.min !== undefined ||
                  config.filters.max !== undefined
                    ? `${config.filters.min ?? "–"} to ${config.filters.max ?? "–"}`
                    : "Any"
                }
              />
            </>
          ) : null}
          <Row
            label="Max results"
            value={config.maxResults !== undefined ? String(config.maxResults) : "Unbounded (≤25 enforced)"}
          />
        </div>
      ))}
    </div>
  )
}
