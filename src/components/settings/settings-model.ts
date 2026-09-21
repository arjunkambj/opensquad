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

export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  company: "Company",
  inbox: "Inbox",
  outreach: "Outreach",
  blocklist: "Blocklist",
  sending: "Sending",
  usage: "Usage",
  account: "Account",
}

export const SETTINGS_TAB_DESCRIPTION: Record<SettingsTab, string> = {
  company:
    "The company your agent sells for, and the website it was written from.",
  inbox: "The inbox your outreach is sent from and replies come back to.",
  outreach: "The default instructions your agent writes from.",
  blocklist: "Addresses and domains your agent may never contact.",
  sending: "The days, hours and daily ceiling your agent may send within.",
  usage: "What your credits have been spent on.",
  account: "The account you are signed in as.",
}
