import { createFileRoute } from "@tanstack/react-router"
import { DashboardNotFound } from "@/components/layout/DashboardNotFound"

/**
 * `_dashboard` is a pathless layout, so this splat matches any unrouted path
 * and — because a splat has the lowest match priority — only after every real
 * route has declined it.
 */
export const Route = createFileRoute("/_dashboard/$")({
  component: DashboardNotFound,
})
