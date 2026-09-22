# OpenIntent demo — recorded cut and voiceover

Landscape 1920 × 1080, 30 fps. 2 minutes 50 seconds. Light mode throughout: off-white #fafafa, charcoal #27272a, peach #fce1d3. OpenIntent is the product. AdMiro is only the website entered during setup; do not call it an example business.

Read only the blockquotes. Use a relaxed pace and leave space for clicks. The video is a picture edit with captions; a voiceover has not been recorded.

## 0:00–0:11 — Opening, title and homepage

**Visual:** Light OpenIntent title, then real homepage movement: “See how it works” and a short scroll. Use `07-home-scroll.cap`. Avoid holding an idle homepage for the whole introduction. The landing-page illustrations are not customer results.

> You've built your product. Now, who should you reach out to?
>
> OpenIntent starts with what you sell and helps you find people who might need it.

## 0:11–0:17 — Sign in, `/sign-in`

**Visual:** `08-sign-in-browser.mp4`, a full-browser recording switching between sign-in options. No credentials or account chooser. Label: “Hexclave · Sign in to your workspace.”

> Sign in to your team's workspace. Hexclave handles the account and team access.

## 0:17–0:52 — Website and customer, `/onboarding`

**Visual:** `03-onboarding-browser.mp4`: website typing, completed profile, suggested roles, company filters, keywords. Loading time is cut. The original narrow-panel recording is cropped only to remove Codex chat, then fitted proportionally; no app content is zoomed or stretched. Labels: “Hexclave · Sign-in and teams”; “Firecrawl · Website research”; “Convex AI Gateway · Profile and customer suggestions.”

> Give it your website. Firecrawl reads the pages, and the Convex AI Gateway helps turn that into a company profile.
>
> Check what it picked up. Then choose the people you want to reach, where they work, and who to leave out.

## 0:52–1:00 — Signals, `/signals`

**Visual:** Signal table from `04-connected-workflow-browser.mp4`. Show actual hiring and growth match counts. Label: “Enrich · Lead search and match counts.” These are matching people, not leads already imported.

> Pick a hiring or growth signal. Enrich shows how many people match before the search runs.

## 1:00–1:51 — Research and review, `/leads`, `/autopilot`, `/billing`

**Visual:** `05-product-walkthrough-browser.mp4`: connected AgentMail integration, leads arriving, real table scrolling, research drawer, sources, Review mode, lead approval, lower details, and credit history. Keep the whole browser frame and one recorded cursor. No mock product screens. Labels: “AgentMail · Connected inbox”; “Firecrawl + AI Gateway · Research and fit”; “Convex · Live updates and credit history.”

> As leads arrive, open one and read the research. You get a fit score, the reason behind it, and links to the sources.
>
> You can see where the fit is uncertain, too. That helps you decide who is worth a conversation.
>
> Switch to Review mode and approve the leads you want to explore. Approving a lead doesn't send a message.
>
> Convex keeps the screen up to date as work finishes. The credit history shows what each step used.

## 1:51–2:05 — Contact lookup, `/contacts`, `/leads`

**Visual:** Successful Kirsty McGowan lookup in `06-contact-draft.cap`, trimmed to research/approval and the found work email. Do not imply this is the same person as every earlier research shot. Do not show unrelated imported test messages. Label: “Enrich · Work-email lookup.”

> Enrich can find the work email. Here, the lookup found one for this lead.

## 2:05–2:24 — Review and approve, `/inbox/:threadId`

**Visual:** `09-draft-review-browser.mp4`: original generated draft, Edit draft, saved revision, approval. Keep “Controlled demo inbox” visible when the recipient is changed. The outgoing message is queued; do not label it delivered.

> OpenIntent writes a first draft using the research. Read it, make your changes, and approve it when you're ready.
>
> This recording uses a demo inbox. The approved message waits for the sending checks and sending hours.

## 2:24–2:32 — Incoming conversation, `/inbox`

**Visual:** `10-incoming-browser.mp4`: open the newly received controlled message. Label: “AgentMail · Incoming conversations” and “Controlled demo inbox.” This is a separately sent demonstration message, not a reply from the researched prospect.

> AgentMail brings incoming mail into the same workspace through a Convex webhook.

## 2:32–2:44 — Infrastructure, generated Remotion clip

**Visual:** `openintent-infrastructure.mp4`, light cards naming the actual integration roles. Keep the words readable; no code screenshot needed.

> Convex stores the data, runs scheduled jobs, and tracks credits. Its rate limiter controls paid-action requests, and static hosting serves the public app.

## 2:44–2:50 — Close, generated Remotion clip

**Visual:** `openintent-outro.mp4`: OpenIntent, “Find your next customer,” public product URL, Convex All Gas Hackathon. Peach accent, light background.

> That's OpenIntent. Start with your website, find a relevant person, and take the next step.

## Capture record and limits — not spoken

- Project and media: `/Users/honey/Code/opensquad-demo-video`.
- Public product: https://proficient-porcupine-63.convex.site/ . Signed-in capture used `http://localhost:5173`.
- Cap Studio captures are local, camera/microphone/system audio off. Nothing uploaded.
- Source window footage is 3840 × 2160. Final edits are 1920 × 1080 at 30 fps. Full-window captures began after expanding the browser; earlier onboarding footage has off-white side padding to preserve its proportions.
- Do not include API-key screens or the Codex chat sidebar. The entire provider-key-page interval in capture 03 is excluded, along with the sidebar. Credentials were entered with recording stopped.
- Normalize Cap variable-frame footage to 30 fps before timestamp trims so holds do not collapse.
- Real actions captured: website analysis, customer targeting, exclusions, keywords, signal counts, connection status, live lead research, scrolling, lead approval, successful work-email lookup, credit usage.
- A revised outgoing draft was approved for the owned demo inbox; delivery was not confirmed. A separate controlled message was sent from the owned probe inbox and received by the app through AgentMail. No real prospect was contacted and no booked meeting is claimed.
- Fixed the completed-onboarding Settings dead end so the existing Resume automation action is available. Resumed automation in Review mode; a real first-touch draft was generated and recorded.
- Existing imported test conversations are excluded from the final demo. They do not represent replies to this recording's outreach.
- Cap project IDs: capture 03 `815a8ffe431f`; 04 `59ee2c1878b9`; 05 `e434692eafe2`; 06 `58bb22be9551`; 07 `66f2a4c1d87c`. New captures: 08 `ecc0f8875a58`; 09 `330141848258`; 10 `6301b9e1c42e`. All were stopped with recording metadata present.

## Sponsor coverage

| Integration | Where it appears | What it does |
| --- | --- | --- |
| Hexclave | Sign-in recording; infrastructure | Sign-in and team membership |
| Firecrawl | Website profile and lead research | Reads websites for company context |
| Enrich | Signals and contact lookup | Searches people, counts matches, finds work emails |
| Convex AI Gateway | Profile/research; generated draft | Company analysis, fit scoring, draft generation |
| AgentMail | Connected integration; approval and incoming mail | Sending inbox and incoming replies |
| Convex | Live leads, Billing, infrastructure | Data, subscriptions, scheduled jobs, credit ledger |
| Convex rate limiter | Infrastructure/narration | Limits paid-action requests |
| Convex static hosting | Infrastructure/narration | Hosts the public frontend; captured walkthrough runs locally |
