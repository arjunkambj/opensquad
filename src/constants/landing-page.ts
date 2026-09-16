export interface PricingPlan {
  key: "starter" | "agency" | "studio"
  name: string
  description: string
  /** A dollar amount per month, or `null` for a custom quote. */
  priceAmount: number | null
  priceLabel?: string
  periodLabel?: string
  features: string[]
  ctaLabel: string
  isPopular?: boolean
}

/**
 * OpenSquad has no billing integration yet, so every plan's call to action
 * leads to sign-in rather than a checkout.
 */
export const pricingPlans: PricingPlan[] = [
  {
    key: "starter",
    name: "Starter",
    description: "For a solo founder trying a supervised sales team on one campaign.",
    priceAmount: 0,
    periodLabel: "/mo",
    ctaLabel: "Start free",
    features: [
      "1 workspace with its own inbox",
      "1 campaign at a time",
      "Up to 5 leads per campaign",
      "Exact-draft approval before every send",
      "Shared inbox for real replies",
    ],
  },
  {
    key: "agency",
    name: "Agency",
    description: "For small agencies running outreach as a team, week after week.",
    priceAmount: 49,
    periodLabel: "/mo",
    ctaLabel: "Choose Agency",
    isPopular: true,
    features: [
      "Everything in Starter",
      "Multiple campaigns, 5 leads each",
      "Team members with owner, editor & viewer roles",
      "Sending windows, suppressions & pause automation",
      "Mission Control receipts for every step",
    ],
  },
  {
    key: "studio",
    name: "Studio",
    description: "For studios that need more workspaces and a faster runtime.",
    priceAmount: null,
    priceLabel: "Custom",
    ctaLabel: "Talk to us",
    features: [
      "Everything in Agency",
      "More workspaces, each with its own sandbox",
      "Priority agent runtime",
      "Meetings still recorded by a human",
      "No calendar sync yet",
    ],
  },
]

export const faqItems = [
  {
    content:
      "No. Outreach prepares the exact email, and a person on your team approves every word before it goes out from the workspace inbox. Replies and booking proposals wait for approval the same way.",
    title: "Does anything send without my approval?",
  },
  {
    content:
      "Researcher reads the company's public web pages and cites the sources it used for each opportunity, so you can open the page and check the claim before approving a draft.",
    title: "Where does the research evidence come from?",
  },
  {
    content:
      "Each campaign discovers and works up to five companies. The cap keeps research deep and approvals manageable; start another campaign when you want more leads.",
    title: "What does the five-lead limit mean?",
  },
  {
    content:
      "Real replies land in a shared inbox, where Outreach drafts a response for you to approve. A clear opt-out adds the contact to your suppressions, so they are not emailed again.",
    title: "How are replies and opt-outs handled?",
  },
  {
    content:
      "No. Outreach can propose a booking link or slots, but there is no calendar sync. Once a time is agreed, a person on your team records the meeting on the lead.",
    title: "Does it sync with my calendar?",
  },
  {
    content:
      "The agents run on Codex inside one isolated sandbox per workspace, so one agency's work never shares a runtime with another's.",
    title: "What runs the agents?",
  },
  {
    content:
      "Work keeps going. Campaigns run as durable workflows that survive browser and runtime restarts, and anything that needs you waits in the Decisions queue until you return.",
    title: "What happens if I close the browser?",
  },
  {
    content:
      "Every workspace member is an owner, editor, or viewer. Owners manage the team and workspace policy, editors run campaigns and approve work, and viewers can follow along without changing anything.",
    title: "How do team roles work?",
  },
] as const
