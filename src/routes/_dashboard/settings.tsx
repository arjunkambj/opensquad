import { createFileRoute } from "@tanstack/react-router"
import { SettingsPage } from "@/components/settings/SettingsPage"
import { SETTINGS_TABS } from "@/components/settings/settings-model"
import type { SettingsTab } from "@/components/settings/settings-model"
import { optionalOneOf } from "@/lib/search-params"

export const Route = createFileRoute("/_dashboard/settings")({
  validateSearch: (search): { tab?: SettingsTab } => ({
    tab: optionalOneOf(SETTINGS_TABS, search.tab),
  }),
  component: SettingsPage,
})
