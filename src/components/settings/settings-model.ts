/**
 * The settings section vocabulary.
 *
 * Shared by the route's `?section=` contract and by the section renderers, so
 * adding a section is one edit and the two can never disagree.
 */
export const SETTINGS_SECTIONS = [
  "account",
  "workspace",
  "sending",
  "automation",
  "members",
  "integrations",
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const DEFAULT_SETTINGS_SECTION: SettingsSection = "workspace"
