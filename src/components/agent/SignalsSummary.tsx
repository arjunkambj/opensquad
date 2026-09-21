import {
  AudioLinesIcon,
  ChartAnalysisIcon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons"
import { StatCard } from "@/components/kit/StatCard"
import type { StrategyRow } from "./agent-model"

/** Three figures over the signal list: how many run, what they found, which works best. */
export function SignalsSummary({
  strategies,
}: {
  strategies: StrategyRow[] | undefined
}) {
  const loading = strategies === undefined
  const rows = strategies ?? []
  const active = rows.filter((row) => row.enabled && row.parkedReason === undefined)
  const paused = rows.filter((row) => row.parkedReason !== undefined).length
  const leads = rows.reduce((sum, row) => sum + row.leadsFound, 0)
  // The query already sorts by leads found, most first.
  const top = rows[0]

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard
        label="Active signals"
        icon={AudioLinesIcon}
        loading={loading}
        value={`${active.length} / ${rows.length}`}
        sublabel={
          loading
            ? undefined
            : paused > 0
              ? `${paused} stopped working`
              : active.length === rows.length
                ? "All switched on"
                : `${rows.length - active.length} switched off`
        }
      />
      <StatCard
        label="Leads found"
        icon={UserMultipleIcon}
        loading={loading}
        value={leads.toLocaleString()}
        sublabel="Across every signal"
      />
      <StatCard
        label="Top signal"
        icon={ChartAnalysisIcon}
        loading={loading}
        value={top === undefined ? "—" : top.leadsFound.toLocaleString()}
        sublabel={
          loading
            ? undefined
            : top === undefined || top.leadsFound === 0
              ? "No leads found yet"
              : <span className="block truncate">{top.title}</span>
        }
      />
    </div>
  )
}
