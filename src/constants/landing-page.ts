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
    description: "For one person running one campaign to see if it fits.",
    priceAmount: 99,
    periodLabel: "/mo",
    ctaLabel: "Choose Starter",
    features: [
      "One campaign at a time, five companies each",
      "Every company researched, with sources you can check",
      "Emails written for one person, sent from your inbox",
      "Replies land in one inbox with a drafted answer",
      "Your OK on each email, in seconds",
    ],
  },
  {
    key: "agency",
    name: "Agency",
    description: "For a small agency running a few campaigns at once, as a team.",
    priceAmount: 199,
    periodLabel: "/mo",
    ctaLabel: "Choose Agency",
    isPopular: true,
    features: [
      "Everything in Starter",
      "Several campaigns running at once",
      "Your whole team in, with owner, editor and viewer roles",
      "Emails only go out in the hours you set",
      "Anyone who says stop is never emailed again",
      "A dated record of who did what, on every lead",
    ],
  },
  {
    key: "studio",
    name: "Studio",
    description: "For studios that need more workspaces and want things done faster.",
    priceAmount: null,
    priceLabel: "Custom",
    ctaLabel: "Talk to us",
    features: [
      "Everything in Agency",
      "More workspaces, kept apart from each other",
      "Your work goes first in the queue",
      "We set up your first campaigns with you",
    ],
  },
]

export const faqItems = [
  {
    content:
      "Every email gets a quick OK from someone on your team before it goes out from your inbox. It takes a few seconds and keeps the squad in your voice. Replies work the same way.",
    title: "Does anything send without my approval?",
  },
  {
    content:
      "Researcher reads the company's public website and links to the page behind each claim. Open the link and check it yourself before you approve a draft.",
    title: "Where does the research evidence come from?",
  },
  {
    content:
      "Each campaign finds and works up to five companies. The limit keeps the research deep and the approvals quick. Start another campaign when you want more.",
    title: "What does the five-lead limit mean?",
  },
  {
    content:
      "Replies land in one shared inbox, where Outreach drafts an answer for you to approve. If someone asks you to stop, they go on your do-not-email list and are never emailed again.",
    title: "How are replies and opt-outs handled?",
  },
  {
    content:
      "Not yet. Outreach can suggest times or share your booking link. Once a time is agreed, someone on your team marks the meeting on the lead.",
    title: "Does it sync with my calendar?",
  },
  {
    content:
      "They run on your own Codex or OpenAI plan, inside a private space for your workspace. Your work never mixes with another team's.",
    title: "What do the agents run on?",
  },
  {
    content:
      "The work keeps going. Anything that needs your OK waits in your queue until you are back.",
    title: "What happens if I close the browser?",
  },
  {
    content:
      "Everyone is an owner, editor or viewer. Owners manage the team and the rules, editors run campaigns and approve emails, and viewers can follow along without changing anything.",
    title: "How do team roles work?",
  },
] as const
