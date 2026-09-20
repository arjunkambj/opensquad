import { createFileRoute } from "@tanstack/react-router"
import { MarketingHome } from "@/components/marketing/MarketingHome"

export const Route = createFileRoute("/_marketing/")({
  component: MarketingHome,
})
