import { createFileRoute } from "@tanstack/react-router"
import { SettingsPage } from "@/components/settings/SettingsPage"
import { SETTINGS_TABS } from "@/components/settings/settings-model"
import type { SettingsTab } from "@/components/settings/settings-model"
import { optionalOneOf } from "@/lib/search-params"

/**
 * `?tab=` rather than seven route files. The requirement is a deep link: a
 * send blocked by the policy window must be able to point at the sending
 * policy, and the sidebar's inbox status at the inbox connection. One
 * `validateSearch` delivers that, and an unknown tab falls back to the
 * default rather than throwing.
 */
export const Route = createFileRoute("/_dashboard/settings")({
  validateSearch: (search): { tab?: SettingsTab } => ({
    tab: optionalOneOf(SETTINGS_TABS, search.tab),
  }),
  component: SettingsPage,
})
