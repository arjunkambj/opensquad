import { createFileRoute } from "@tanstack/react-router"
import { SettingsPage } from "@/components/settings/SettingsPage"
import { SETTINGS_SECTIONS } from "@/components/settings/settings-model"
import type { SettingsSection } from "@/components/settings/settings-model"
import { optionalOneOf } from "@/lib/search-params"

/**
 * `?section=` rather than six route files. The requirement is a deep link: a
 * send blocked by the policy window must be able to point at the sending
 * policy. One `validateSearch` delivers that.
 */
export const Route = createFileRoute("/_dashboard/settings")({
  validateSearch: (search): { section?: SettingsSection } => ({
    section: optionalOneOf(SETTINGS_SECTIONS, search.section),
  }),
  component: SettingsPage,
})
