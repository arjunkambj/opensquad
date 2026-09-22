# OpenIntent demo — recorded cut and voiceover

Landscape 1920 × 1080, 30 fps. 2 minutes 50 seconds. Light mode throughout: off-white #fafafa, charcoal #27272a, peach #fce1d3. OpenIntent is the product. AdMiro is only the website entered during setup; do not call it an example business.

Read only the blockquotes. First person, conversational, as if telling a colleague what happened. Use a relaxed pace and leave space for clicks. The video is a picture edit with captions; the voiceover is generated in ElevenLabs from the blockquotes.

## 0:00–0:11 — Opening, title and homepage

**Visual:** Light OpenIntent title, then real homepage movement: “See how it works” and a short scroll. Use `07-home-scroll-browser.mp4`. Avoid holding an idle homepage for the whole introduction. The landing-page illustrations are not customer results.

> Last week I finished a product. Then I opened a blank spreadsheet and stared at it. I had no idea who to email first. That's the problem OpenIntent is built for.

## 0:11–0:17 — Sign in, `/sign-in`

**Visual:** `08-sign-in-browser.mp4`, a full-browser recording switching between sign-in options. No credentials or account chooser. Label: “Hexclave · Sign in to your team.”

> I sign in with my team through Hexclave.

## 0:17–0:52 — Website and customer, `/onboarding`

**Visual:** `03-onboarding-browser.mp4`: website typing, completed profile, suggested roles, company filters, keywords. Loading time is cut. The original narrow-panel recording is cropped only to remove Codex chat, then fitted proportionally; no app content is zoomed or stretched. Labels: “Hexclave · Sign-in and teams”; “Firecrawl · Website research”; “Convex AI Gateway · GPT 5.6 Sol · Profile and customer suggestions.”

> I paste in my website and that's the whole setup. Firecrawl reads the site, and the Convex AI Gateway, running GPT 5.6 Sol, figures out what I sell and who usually buys it. Then I go through it and fix what it got wrong, because I know my company better than the model does. I pick the roles I want, the kinds of companies, and the ones I want to skip.

## 0:52–1:00 — Signals, `/signals`

**Visual:** Signal table from `04-connected-workflow-browser.mp4`. Show actual hiring and growth match counts. Label: “Enrich · Lead search and match counts.” These are matching people, not leads already imported.

> Then I choose a signal instead of scraping a big list. Companies that are hiring for this, or companies that just grew. Enrich tells me how many people match before I spend any credits.

## 1:00–1:51 — Research and review, `/leads`, `/autopilot`, `/billing`

**Visual:** `05-product-walkthrough-browser.mp4`: connected AgentMail integration, leads arriving, real table scrolling, research drawer, sources, Review mode, lead approval, lower details, and the Billing Usage tab. Keep the whole browser frame and one recorded cursor. No mock product screens. Labels: “AgentMail · Connected inbox”; “Firecrawl + AI Gateway · Research and fit”; “Convex · Live updates and credit usage.”

> Leads start showing up while I'm watching. I open one and there's a score, but what I actually read is the reason behind it and the sources it came from. When it isn't sure, it tells me. I'm in Review mode, so nothing happens unless I say so. I approve the ones I'd want to talk to, and still no email has gone out. In Billing I can see what each step cost.

## 1:51–2:05 — Contact lookup, `/contacts`, `/leads`

**Visual:** Successful Kirsty McGowan lookup in `06-contact-draft-browser.mp4`, trimmed to research/approval and the found work email. Do not imply this is the same person as every earlier research shot. Do not show unrelated imported test messages. Label: “Enrich · Work-email lookup.”

> For this lead, Enrich found a work email.

## 2:05–2:24 — Review and approve, `/inbox/$conversationId`

**Visual:** `09-draft-review-browser.mp4`: original generated draft, Edit draft, saved revision, approval. Keep “Controlled demo inbox” visible when the recipient is changed. The outgoing message is queued; do not label it delivered. Label: “Convex AI Gateway · GPT 5.6 Sol · First draft.”

> It writes a first message from the research, again through the gateway with GPT 5.6 Sol. I read it, change a couple of lines, and approve it. It goes out during my sending hours after the usual checks. This is a demo inbox, so for now it just waits in the queue.

## 2:24–2:32 — Incoming conversation, `/inbox`

**Visual:** `10-incoming-browser.mp4`: open the newly received controlled message. Label: “AgentMail · Incoming conversations” and “Controlled demo inbox.” This is a separately sent demonstration message, not a reply from the researched prospect.

> When someone replies, it shows up in the same place. AgentMail brings it in through a Convex webhook.

## 2:32–2:44 — Infrastructure, generated Remotion clip

**Visual:** `openintent-infrastructure.mp4`, light cards naming the actual integration roles. Keep the words readable; no code screenshot needed.

> Underneath all of this is Convex. It holds the data, runs the scheduled jobs, tracks the credits, rate limits anything that costs money, and hosts the app.

## 2:44–2:50 — Close, generated Remotion clip

**Visual:** `openintent-outro.mp4`: OpenIntent, “Find your next customer,” public product URL, Convex All Gas Hackathon. Peach accent, light background.

> That's OpenIntent. You start from your website, find someone who might need what you built, and send them one good email.

## ElevenLabs paste — not spoken as headings

Paste the block below as one document. Paragraph breaks are the section pauses. If “5.6” is read oddly, write “five point six”. Spell “Hex-clave” or “Con-vex” phonetically if a voice mispronounces them.

```text
Last week I finished a product. Then I opened a blank spreadsheet and stared at it. I had no idea who to email first. That's the problem OpenIntent is built for.

I sign in with my team through Hexclave.

I paste in my website and that's the whole setup. Firecrawl reads the site, and the Convex AI Gateway, running GPT 5.6 Sol, figures out what I sell and who usually buys it. Then I go through it and fix what it got wrong, because I know my company better than the model does. I pick the roles I want, the kinds of companies, and the ones I want to skip.

Then I choose a signal instead of scraping a big list. Companies that are hiring for this, or companies that just grew. Enrich tells me how many people match before I spend any credits.

Leads start showing up while I'm watching. I open one and there's a score, but what I actually read is the reason behind it and the sources it came from. When it isn't sure, it tells me. I'm in Review mode, so nothing happens unless I say so. I approve the ones I'd want to talk to, and still no email has gone out. In Billing I can see what each step cost.

For this lead, Enrich found a work email.

It writes a first message from the research, again through the gateway with GPT 5.6 Sol. I read it, change a couple of lines, and approve it. It goes out during my sending hours after the usual checks. This is a demo inbox, so for now it just waits in the queue.

When someone replies, it shows up in the same place. AgentMail brings it in through a Convex webhook.

Underneath all of this is Convex. It holds the data, runs the scheduled jobs, tracks the credits, rate limits anything that costs money, and hosts the app.

That's OpenIntent. You start from your website, find someone who might need what you built, and send them one good email.
```

## Capture record and limits — not spoken

- Project and media: `/Users/honey/Code/opensquad-demo-video`. Trimmed clips live in `clips/`; raw Cap captures in `captures/`; Remotion renders in `out/`.
- Public product: https://proficient-porcupine-63.convex.site/ . Signed-in capture used `http://localhost:5173`.
- Cap Studio captures are local, camera/microphone/system audio off. Nothing uploaded.
- Source window footage is 3840 × 2160. Final edits are 1920 × 1080 at 30 fps. Full-window captures began after expanding the browser; earlier onboarding footage has off-white side padding to preserve its proportions.
- Do not include API-key screens or the Codex chat sidebar. The entire provider-key-page interval in capture 03 is excluded, along with the sidebar. Credentials were entered with recording stopped.
- Normalize Cap variable-frame footage to 30 fps before timestamp trims so holds do not collapse.
- Model: both AI gateway tiers are pinned to `openai/gpt-5.6-sol` in `convex/ai/models.ts`. If that pin changes, update the narration and labels.
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
| Convex AI Gateway (GPT 5.6 Sol) | Profile/research; generated draft | Company analysis, fit scoring, draft generation |
| AgentMail | Connected integration; approval and incoming mail | Sending inbox and incoming replies |
| Convex | Live leads, Billing Usage, infrastructure | Data, subscriptions, scheduled jobs, credit ledger |
| Convex rate limiter | Infrastructure/narration | Limits paid-action requests |
| Convex static hosting | Infrastructure/narration | Hosts the public frontend; captured walkthrough runs locally |
