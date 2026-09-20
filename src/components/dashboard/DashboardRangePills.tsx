/**
 * The range pills of reference 20 — 7 days / 30 days / 3 months / This month.
 *
 * They write the route's search params rather than component state, so the
 * window survives a reload and a pasted link reopens the same one. A window
 * none of the four names (an absolute range from an older link) lights no
 * pill instead of lighting the wrong one.
 */
import { Button } from "@/components/ui/button"
import {
  DASHBOARD_RANGE_LABEL,
  DASHBOARD_RANGE_PILLS,
  type DashboardRangePill,
} from "@/components/dashboard/dashboard-range"

export function DashboardRangePills({
  active,
  onSelect,
}: {
  active: DashboardRangePill | null
  onSelect: (pill: DashboardRangePill) => void
}) {
  return (
    <div
      role="group"
      aria-label="Date range"
      className="flex flex-wrap items-center gap-1.5"
    >
      {DASHBOARD_RANGE_PILLS.map((pill) => (
        <Button
          key={pill}
          size="sm"
          variant={pill === active ? "default" : "ghost"}
          aria-pressed={pill === active}
          onClick={() => onSelect(pill)}
        >
          {DASHBOARD_RANGE_LABEL[pill]}
        </Button>
      ))}
    </div>
  )
}
