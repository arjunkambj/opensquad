import {
  DASHBOARD_RANGE_LABEL,
  DASHBOARD_RANGE_PILLS,
  type DashboardRangePill,
} from "@/components/dashboard/dashboard-range"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

/** `active` is null for a custom window, which leaves no tab selected. */
export function DashboardRangePills({
  active,
  onSelect,
}: {
  active: DashboardRangePill | null
  onSelect: (pill: DashboardRangePill) => void
}) {
  return (
    <Tabs value={active} onValueChange={(pill: DashboardRangePill) => onSelect(pill)}>
      <TabsList aria-label="Date range">
        {DASHBOARD_RANGE_PILLS.map((pill) => (
          <TabsTrigger key={pill} value={pill}>
            {DASHBOARD_RANGE_LABEL[pill]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
