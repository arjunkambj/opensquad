/**
 * The five stages of the loop, in the order they happen.
 *
 * `you` and `agent` are the real split the app enforces: the agent never
 * marks a meeting booked, and in Review mode it never sends. `cost` quotes
 * the trial credit prices.
 */
export const stages = [
  {
    title: "Set up once",
    description:
      "You give it your website. It reads the site and drafts your company profile, who you sell to, and a handful of named searches — each with a live count of how many people match before a single credit is spent. Everything it drafts is editable.",
    you: "Paste a URL, then correct what it got wrong.",
    agent: "Reads your site and proposes the profile, the fit and the searches.",
    cost: "Free the first time through. Re-running a step costs 3 credits.",
  },
  {
    title: "Find on intent, not lists",
    description:
      "Each search is one buying signal crossed with your own fit: recently funded, hiring for a team, growing headcount, spending on ads, already using a tool, the shape of their team, or a keyword you care about. Every lead keeps the signals that found it, so a search that brings nothing useful is one switch away from off.",
    you: "Pick the signals worth watching, and turn off the ones that are not.",
    agent: "Runs each search on its own schedule and tags what it finds.",
    cost: "2 credits per page of results, up to 25 people. Match counts are free.",
  },
  {
    title: "Research and score",
    description:
      "Before anyone is contacted, the agent reads the company's own site and writes a short note on why this lead is worth an email, then scores them 1 to 3. The best ones are researched first; the rest sit in your table with a Research button and cost nothing until you press it.",
    you: "Read the note. Approve the lead, or reject it.",
    agent: "Researches the strongest leads first, then a few more each day.",
    cost: "3 credits per lead researched and scored.",
  },
  {
    title: "Contact from your own inbox",
    description:
      "One email written for that one person, then two follow-ups if they stay quiet. It sends from the inbox you connected, inside the days and hours you set, under a daily cap — and every send carries an opt-out line and is checked against your blocklist first.",
    you: "Approve the email, or switch the agent to Autopilot and let it send.",
    agent: "Finds the address, writes the email, sends it and follows up.",
    cost: "15 credits to find an address, 1 credit per email written.",
  },
  {
    title: "Close the reply",
    description:
      "A reply cancels the follow-ups for that lead in the same step that stores it. The agent reads what came back, answers the question or handles the objection, and proposes a time or shares your booking link. Marking a meeting as booked is yours alone — a model saying they agreed is not a meeting.",
    you: "Mark the meeting booked. Only you can.",
    agent: "Reads the reply, drafts the answer, proposes the meeting.",
    cost: "1 credit per reply read and answered.",
  },
] as const
