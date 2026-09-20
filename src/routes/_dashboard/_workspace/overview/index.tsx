import { createFileRoute } from "@tanstack/react-router"
import { OverviewPage } from "@/components/overview/OverviewPage"

/**
 * Overview. The URL contract lives one level up, on `overview.tsx`, so this
 * route and anything added beside it share one definition and cannot drift.
 */
export const Route = createFileRoute("/_dashboard/_workspace/overview/")({
  component: OverviewPage,
})
