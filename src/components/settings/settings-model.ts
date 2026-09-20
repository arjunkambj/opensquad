/**
 * The settings tab vocabulary (PLAN §5).
 *
 * Shared by the route's `?tab=` contract and by the tab renderers, so adding
 * a tab is one edit and the two can never disagree.
 */
export const SETTINGS_TABS = [
  "company",
  "inbox",
  "outreach",
  "blocklist",
  "sending",
  "usage",
  "account",
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const DEFAULT_SETTINGS_TAB: SettingsTab = "company"

/** The tab bar's labels, in the order PLAN §5 lists them. */
export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  company: "Company",
  inbox: "Inbox",
  outreach: "Outreach",
  blocklist: "Blocklist",
  sending: "Sending",
  usage: "Usage",
  account: "Account",
}
