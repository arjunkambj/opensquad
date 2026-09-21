export const SETTINGS_TABS = [
  "company",
  "outreach",
  "blocklist",
  "sending",
  "account",
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const DEFAULT_SETTINGS_TAB: SettingsTab = "company"

export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  company: "Company",
  outreach: "Outreach",
  blocklist: "Blocklist",
  sending: "Sending",
  account: "Account",
}

export const SETTINGS_TAB_DESCRIPTION: Record<SettingsTab, string> = {
  company: "The company your agent sells for. Analyzing your site again rewrites it.",
  outreach:
    "How your agent writes. An agent with its own instructions uses those instead.",
  blocklist: "Addresses and domains your agent may never contact.",
  sending: "The days, hours and daily ceiling your agent may send within.",
  account: "The account you are signed in as.",
}
