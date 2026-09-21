/**
 * The questions people actually ask before signing up, answered from what the
 * product does today. Nothing here promises a feature that is not built.
 */
export const faqItems = [
  {
    title: "What does it cost during the trial?",
    content:
      "There is one plan and no billing. You get 300 credits once, when you start, and there is no refill and nothing to upgrade to. Finding leads, researching them, finding an address and writing an email each have a credit price; setup, match counts, browsing, approving, sending and opt-out handling cost nothing. When the credits are gone the paid buttons stop and explain themselves, and the rest of the app keeps working.",
  },
  {
    title: "Whose inbox does it send from?",
    content:
      "Yours. You connect your own AgentMail inbox — that is the one outside service you bring a key for — during setup or later from settings, and every email leaves from that address with replies coming back to it. Until an inbox is connected the agent stays in Sourcing only: it finds and researches leads and contacts nobody.",
  },
  {
    title: "Can I review everything before it sends?",
    content:
      "Yes. A new agent starts in Sourcing only — finding and researching, contacting nobody — and stays there until you connect an inbox and pick a sending mode yourself. Review is the mode that keeps every email waiting for you: nothing leaves without two separate approvals, yours on the lead, which allows finding their address and drafting, and yours on the specific email text. Autopilot is the other choice, and it only starts after you accept a dialog spelling out what it will do; even then it goes through the same blocklist, sending window, daily limit and credit checks as a manual send. Paused stops everything.",
  },
  {
    title: "How do opt-outs work?",
    content:
      "Every email the agent sends carries an opt-out line. Anyone who asks to stop is suppressed immediately and never contacted again, and you can add addresses and whole domains to a blocklist yourself. The list is checked before every single send, including follow-ups and replies — not once at the start of a sequence.",
  },
  {
    title: "What data does it use?",
    content:
      "Your own website, read once at setup to draft your profile and who you sell to. Public professional data about the people and companies its searches match. The public homepage of a lead's company, read at research time to write the note behind their score. And the mail in the inbox you connected, so it can work the replies.",
  },
  {
    title: "Does it book the meeting?",
    content:
      "It proposes times or shares your booking link, and it will tell you when a reply looks like agreement. Marking a meeting as booked is yours alone — a model saying someone agreed is not a meeting, so the number on your dashboard only counts the ones you confirmed.",
  },
  {
    title: "What happens if I close the browser?",
    content:
      "Nothing stops. The agent runs on a schedule on the server: it searches, researches, sends inside your window and handles replies while you are elsewhere. Anything that needs your approval waits for you instead of going ahead.",
  },
  {
    title: "What does it run on?",
    content:
      "Language models, called from our own backend on your team's data — your browser never talks to anyone but us. Which services we buy underneath is ours to choose and ours to change, and none of it is something you sign up for or pay separately for. What it is asked to do is the part that matters: every email is written for one person from the research on that person, so nothing is a template with a name dropped in.",
  },
] as const
