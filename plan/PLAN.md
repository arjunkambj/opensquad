# OpenIntent MVP plan

**An AI sales agent that finds and researches leads for you, contacts them for
you, and works the replies until a meeting is booked.** Email only. UI modelled
on Gojiberry AI (see §2 for the per-screen references).

Call-by-call user flow (what each screen triggers and what gets stored):
[flow.html](flow.html). How to build it, task by task: [EXECUTION.md](EXECUTION.md). Moving existing
data to the new model: [MIGRATION.md](MIGRATION.md).

## 1. The loop

```
 setup (once)            FIND               RESEARCH            CONTACT              CLOSE
website ─▶ profile ─▶ Enrich search ─▶ score + company ─▶ personalised email ─▶ classify reply
        ─▶ ICP        per recommended   research note      + 2 follow-ups        ─▶ answer / handle objection
        ─▶ strategies strategy                                                   ─▶ propose meeting ─▶ booked
        ─▶ lead preview
```

Every stage is visible per lead as a status, and the agent runs on a cron
without anyone clicking. Modes: **Sourcing only** (find and research, contact nobody — the default
until an inbox is connected), **Review** (every email waits for one-click
approval), **Autopilot** (sends on its own), **Paused**.

### In scope
Onboarding (website → profile → ICP → recommended search strategies + keywords → goal/tone → keys → real lead preview), one agent per workspace
(more allowed, not required), Contacts table, lead detail with research +
thread, Inbox, Dashboard with funnel numbers, Settings (keys, sender, booking
link, templates-as-one-instructions-field).

### Cut from MVP
Continuous social/LinkedIn activity monitoring (no data source), job-change
tracking, natural-language Search page, standalone Insights page, lists, CSV export/import, phone enrichment, LinkedIn, Copilot, members
UI, billing, multiple templates.

## 2. UI reference (build to these)

The screenshots are the design spec. Before building a screen, open its
reference image and match layout, hierarchy, component shapes, spacing and copy
tone. Images are local only (`temp-images/` is git-ignored; they show a third
party's product and real people's names, so they never get committed).

| Screen we build | Reference | What to take from it |
|---|---|---|
| Onboarding shell | [01-website-empty](../temp-images/ref/01-website-empty.png) | centred logo, 4-dot stepper with connecting lines, single rounded card on a soft warm gradient, "Step n of m" top-right |
| Dot 1 · company | [02-company-profile](../temp-images/ref/02-company-profile.png) | website + Analyze button; then company name, industry select, description, key-feature rows with delete + add, social proof |
| Dot 2 · ICP job titles | [06-icp-job-titles](../temp-images/ref/06-icp-job-titles.png) | "AI-generated" pill, outlined removable chips, dashed "+ Add" chip |
| Dot 2 · company filters | [07-icp-company-filters](../temp-images/ref/07-icp-company-filters.png) | uppercase group labels, toggle chips with an "All …" option per group: industry, location, company type, company size |
| Dot 2 · exclusions | [08-icp-exclusions](../temp-images/ref/08-icp-exclusions.png) | checkbox row + keyword chips with input and Add |
| Dot 3 · goals | [05-goals-tone](../temp-images/ref/05-goals-tone.png) | pain points textarea, two radio cards for goal, three radio cards for tone |
| Dot 3 · connect | [04-connect-accounts](../temp-images/ref/04-connect-accounts.png) | two side-by-side connect cards with benefit bullets and "Connect later"; ours is a single **Connect your sending inbox** card (paste AgentMail key + verify) with the benefit bullets, since lead data needs no connection |
| Dot 4 · strategies | [09-signals](../temp-images/ref/09-signals.png) | heading "Here are the first signals we think you should track", checkbox cards with an info tooltip; ours add the live match count and the model's one-line rationale, recommended ones pre-checked |
| Dot 4 · keywords | [10-keywords](../temp-images/ref/10-keywords.png) | selected keyword chips, "AI-suggested — click to add" dashed chips, Generate more, custom keyword input, "No keywords needed" skip |
| Dot 4 · review | [11-icp-review](../temp-images/ref/11-icp-review.png) | accordion rows (icon, uppercase label, value summary, chevron), tinted info banner, primary "Confirm & find leads" |
| App shell + Dashboard | [20-dashboard](../temp-images/ref/20-dashboard.png) | light sidebar with active pill + left accent bar, user block at bottom; welcome header, range pills, CTA card + stat cards, activity chart, "Latest hot leads" and "Latest replies" panels |
| Agent page | [21-agents](../temp-images/ref/21-agents.png) | page header with subtitle, agent card: name, mode dropdown badge, four funnel metrics, footer with channel + created date + Open |
| Contacts | [23-contacts](../temp-images/ref/23-contacts.png) | search + filters bar, bulk actions right, dense table: contact (name, title, @company), signal column (strategy that found them, "+n signals" badge), 3-flame AI score, email Enrich button, imported, approval, row menu, pagination footer |
| Inbox | [24-inbox](../temp-images/ref/24-inbox.png) | collapsed icon sidebar, conversation list with filter pills (Received / Interested / Unread / All), reading pane with connect-account empty state |
| Settings | [26-settings-templates](../temp-images/ref/26-settings-templates.png) | horizontal tab bar, stacked cards, section header card with primary action, illustrated empty state |

Not built in the MVP, kept only for context:
[03-channel-choice](../temp-images/ref/03-channel-choice.png) (we are email-only),
[22-search](../temp-images/ref/22-search.png),
[25-insights](../temp-images/ref/25-insights.png) (its "leads generated per signal" table is reused inside the Agent page).

### Element-by-element coverage
Every visible element of the reference, and what we do with it. "Cut" elements
are left out entirely — never rendered as inactive chrome.

| Reference | Element | Ours |
|---|---|---|
| 01 | website field, Analyze, "I don't have a website" | built |
| 02 | company name, industry select, description, key-feature rows, social proof, required markers | built |
| 03 | Multichannel / LinkedIn-only choice | cut — email only, step removed |
| 04 | location select for proxy, LinkedIn card | cut |
| 04 | email connect card, benefit bullets, Connect later | built as "Connect your sending inbox" |
| 05 | pain points, campaign goal, message tone | built |
| 06–08 | job titles, industry / location / company type / size chips with "All …", exclude profiles checkbox, competitors & keywords | built |
| 09 | signal checkboxes with info tooltips, "you can update this later" | built, with live counts + rationale |
| 10 | keyword chips, AI-suggested chips, Generate more, custom input, "No keywords needed" | built |
| 11 | seven-row review accordion, info banner, Confirm & preview leads | built |
| 20 | sidebar: logo, bell, collapse, nav, credits block, user block | built (bell = real activity feed) |
| 20 | sidebar: Copilot, Search, Insights, webinar card, Help, Roadmap, Referral | cut |
| 20 | header chips "n Active Signal(s)" and account connection status | built: active signals count → `/agent`; inbox status → Settings |
| 20 | range pills 7 days / 30 days / 3 months / This month | built |
| 20 | "Ready to outreach?" CTA card | built, state-aware (connect inbox → approve leads → switch to autopilot) |
| 20 | Hot opportunities · Leads engaged · Conversations | built: hot leads (score 3) · contacted · conversations |
| 20 | Pipeline generated with editable deal size | built: `dealSize` × (interested + meetings booked); "Set deal size" until set |
| 20 | Activity overview chart, Latest hot leads + View more, Latest replies + connect empty state | built |
| 21 | "n / m running agents", Create an agent | cut — one agent per trial workspace; page opens straight on the agent |
| 21 | not-connected banner with Connect link | built (inbox) |
| 21 | agent name generated from ICP ("Title · Region · Industry") | built, editable |
| 21 | mode dropdown incl. "Leads sourcing only" | built: Sourcing only / Review / Autopilot / Paused |
| 21 | Contacted n / total, Accepted, Replied, Interested | built: Contacted n / total, Replied, Interested; **Opened** only once open events are verified for the workspace (§9.6) |
| 21 | channel icons, sender account, created date, row menu | built: sender address, created date, menu (rename, pause) |
| 22 | Search page | cut |
| 23 | All contacts / Lists tabs, Add leads, Add to list, Export, phone column + Enrich Phone | cut |
| 23 | search box, filters, sortable AI score, signal column with "+n signals", profile link icon, Enrich email per row and in bulk, imported time, agent link, Reject / Approve, row menu, page size + "Showing x to y of z" | built |
| 24 | collapsed rail, Conversations count, search, Received / Interested / Unread / All, connect empty state | built |
| 24 | "All accounts" switcher | cut — one inbox |
| 25 | Insights page | cut; its "leads generated per signal" table lives on `/agent`, its daily counts feed the dashboard chart |
| 26 | tabs: Workspace, Senders Accounts, AI Outreach Templates, Organization Blocklist, Account | built as Company, Inbox, Outreach (default instructions), Blocklist, Sending, Usage, Account |
| 26 | tabs: Members, Security, Billing, API, MCP; Integrations submenu | cut |

Visual system: warm coral primary on near-white, large radii, soft shadows,
geometric sans for headings, generous whitespace. Our own name, logo and copy —
match the pattern, do not reuse their brand assets or wording verbatim.

### No placeholders, no mock data
- Every number, row, chart point and chip on screen comes from a Convex query
  over real records. No hard-coded sample leads, fake stats, lorem ipsum,
  "coming soon" tabs or buttons that do nothing.
- AI-generated fields are produced by a real gateway call on the user's real
  website; the UI shows a loading state while it runs and a retry on failure.
- A screen with no data shows a designed empty state that says what to do next
  (as the reference Inbox and Templates screens do), never filler content.
- If a control cannot be made functional in the MVP, it is left out rather than
  stubbed. Sidebar and tabs list only pages that work.
- The demo is a real run: real website, real Enrich search, real send to an
  address we control. No seed script that fabricates leads or conversations.

## 3. Signal recommendation engine

Gojiberry's "signals" become **search strategies**: named, explainable Enrich
lead-finder queries that the model proposes from the user's own website. Only
signals Enrich can actually answer are offered.

### Signal catalogue (grounded in Enrich filters)
| Signal | Enrich filters | Example card label |
|---|---|---|
| Recently funded | `lastFundingTypeOrg`, `lastFundingAmountOrg` | "Seed–Series B companies in your ICP" |
| Hiring for a team | `*OpenRolesCountOrg` (sales, AE, marketing, IT, security, devops…) | "Companies hiring marketers right now" |
| Growing headcount | `employeeOnLinkedinGrowthRateOrg` | "Teams growing fast on LinkedIn" |
| Spending on ads / traffic | `monthlyGoogleAdspendOrg`, `monthlyPaidTrafficOrg`, `totalMonthlyTrafficOrg` | "Companies spending on Google Ads" |
| Uses a tool | `crmTechOrg`, `marketingAutomationTechOrg`, `salesAutomationTechOrg`, `eCommercePlatformTechOrg`, `cmsTechOrg`, `analyticsTechOrg`, `cloudProviderTechOrg`… | "Shopify stores", "HubSpot users" |
| Team shape | `*RoleCountOrg`, `hasCisoOrg`, `hasCioOrg`, `hasMobileAppOrg`, `hasWebAppOrg` | "Marketing teams of 5+" |
| Keyword match | `personHeadline`, `companyHeadline`, `aboutUs` (contains) | "People talking about 'ppc optimization'" |
| Core ICP | `jobLevel` + `jobFunction`, `linkedinIndustry`, `continent`/`countryName`, `employeeCountMin/Max`, `companyEntityType`; `excludeFilters` for competitors | "Best-fit roles in your ICP" (always present) |

### Pipeline
1. **Scrape** the user's site with Firecrawl (home + up to a few same-domain pages such as pricing/customers/about).
2. **Allowed values**: fetch `GET /lead-finder/filter-options` (free), cache it in a `leadFilterOptions` singleton row refreshed weekly. Values are case-sensitive and a typo silently returns zero, so the model only ever picks from this list.
3. **Recommend** (`ai/recommendStrategies.ts`): input = company profile + ICP + the catalogue + allowed values. Output = 3–5 strategies `{ title, signalKind, rationale, filters, excludeFilters, recommended }`, each = core ICP filters ∧ one signal, plus 6–10 suggested keywords. Schema-constrained; every enum value is re-checked against the cached options before use.
4. **Validate for free**: run `POST /lead-finder/count` per strategy. Zero or tiny → one automatic relax pass (model gets the count back and widens: drop `jobTitle` for `jobLevel`+`jobFunction`, widen size/geo). Absurdly large → tighten. Counts are shown on the cards.
5. **User picks** strategies and keywords (references 09 and 10). Keywords compile into one extra "keyword match" strategy.
6. **Preview real leads**: on Confirm, run `search` page 1 for each selected strategy (free tier: 75 rows per search, 50 unique searches a month — so we search only what the user selected, never speculatively), dedupe by `sourceLeadId`, pre-rank for free and research only the top ~8 across strategies (§9.2), and land the user on Contacts with real leads tagged by the strategy that found them — the best ones scored, the rest one click away.

A lead matched by more than one strategy keeps all of them (`+n signals` in the
table) and gets a score boost. The Agent page shows leads generated per
strategy from real counts, so weak strategies can be switched off.

## 4. Fixed decisions

| Concern | Choice |
|---|---|
| AI | Convex AI Gateway: `@convex-dev/ai-sdk-provider` + `ai`, `convexGateway("openai/<model>")` in Convex actions. No model key stored. Model ids live in `convex/ai/models.ts`. |
| Output | Schema-constrained object generation per task, re-validated with Convex validators before any write. |
| Leads | Enrich.so REST, `x-api-key`. **Platform key**, hard-capped per workspace by the credit ledger (§6). Never named in the product (see white-label rule). |
| Email | AgentMail, existing send ledger + inbound webhook. **Bring-your-own key**, per workspace. |
| Research | Existing Firecrawl component (platform key): user's site at onboarding, lead's company homepage at research time. |
| Auth + tenancy | Hexclave. **The tenant is the Hexclave organization, and the org active in Hexclave is the source of truth** (owner decision, 2026-09-21): the signed token's `selected_team_id` claim decides whose data a request sees. No separate workspace concept and no `memberships` table — Hexclave owns who belongs to an org. Convex keeps one `orgs` row per Hexclave org, keyed by that org id and created silently on first use, because credits, the inbox connection, send policy and the agent need a home. |
| Durable work | Scheduled actions + a status field per lead. No workflow engine, sandbox or worker. |

### Integrations at a glance
| Integration | How it is wired | Whose key | Entry point | Inbound | Metered by |
|---|---|---|---|---|---|
| **Convex AI Gateway** (OpenAI models) | `@convex-dev/ai-sdk-provider` + `ai`; `convexGateway(MODELS.fast \| MODELS.smart)` inside internal actions | none — deployment-scoped token, issued by Convex | `convex/ai/*.ts`, ids in `convex/ai/models.ts` | — | `ai_calls` + credits |
| **Firecrawl** | existing `@firecrawl/firecrawl-convex` component, called only through `convex/integrations/firecrawl.ts` | platform (`FIRECRAWL_API_KEY` env) | `analyzeWebsite`, `researchLead` | component's signed `/firecrawl/webhook` (kept) | `scrapes` + credits |
| **Enrich** | new thin REST client `convex/integrations/enrich.ts`: header, envelope parse, problem-JSON → our errors, 429/5xx back-off, explicit `User-Agent` | platform (`ENRICH_API_KEY` env) | filter-options, count, search, reveal + reveal-job poll, wallet balance | none (we poll reveal jobs) | `enrich_credits`, `enrich_searches` + credits |
| **AgentMail** | `@agentmail/convex` component for inbound verify/dedupe/storage; direct REST in `convex/integrations/agentmail.ts` for send, inboxes, webhooks, thread backfill | **user's**, per workspace, encrypted | Manage inbox, send ledger | `/agentmail/webhook/<token>` per workspace | `sends` (daily limit) |
| **Hexclave** | unchanged | platform | auth, email OTP | — | — |
| **Convex static hosting** | unchanged; `registerStaticRoutes` stays last in `http.ts` | — | deploy | — | — |

Firecrawl change needed: the current wrapper scrapes exactly one validated
page. Website analysis needs the home page plus up to 3 same-origin pages
picked from the home page's links (pricing / customers / about); lead research
stays at one page. Page count is fixed in code, never user-controlled.

To verify in M0 before building on them (each is a 10-minute spike, recorded in
`hackathon.md`):
- the deployment's Convex plan has AI Gateway enabled, and which OpenAI model
  ids it serves — pick `fast` (chips, scoring, classification) and `smart`
  (strategies, email writing);
- schema-constrained object output works through the gateway provider; if not,
  JSON-mode text + Convex validator parse, same call sites;
- Enrich account plan, current balance and that search pages 1–3 are free on it;
- AgentMail thread/message list response shape for the backfill;
- Hexclave exposes verified-email status to Convex auth.

### Bring-your-own keys
Table `workspaceSecrets`: `{ workspaceId, provider: "agentmail" | "agentmail_webhook", ciphertext, iv, last4, status: "unverified" | "valid" | "invalid", checkedAt }`.
AES-GCM under deployment env `SECRETS_ENCRYPTION_KEY`; decrypted only inside
actions/http actions; client queries see `{ provider, last4, status }`.

### Manage inbox (AgentMail, bring-your-own key)
The shipped setup assumes ONE platform AgentMail account: the
`@agentmail/convex` component reads `AGENTMAIL_API_KEY` from env, and
`/agentmail/webhook` verifies against one `AGENTMAIL_WEBHOOK_SECRET`. Each
user's AgentMail organisation is separate, so this becomes per workspace:

1. **Connect** — user pastes their key in Settings → Manage inbox (also
   onboarding dot 3). Action verifies it with `GET /v0/inboxes`, encrypts, stores.
2. **Pick or create the sending inbox** — list inboxes from their account, or
   `POST /v0/inboxes` with a username/display name. Saved as `workspaces.inboxRef`.
3. **Register the webhook on their account** — `POST /v0/webhooks` with their
   key: `url = <site>/agentmail/webhook/<workspace webhook token>`,
   `inbox_ids = [inbox]`, all message event types, `client_id` for idempotency.
   The response's per-webhook `secret` is stored encrypted
   (`provider: "agentmail_webhook"`), `webhook_id` on the workspace.
4. **Receive** — the new route resolves the workspace from the opaque path
   token, decrypts that workspace's secret, and hands the request to a
   per-request `new AgentMail(components.agentmail, { webhookSecret })`, so the
   component's Svix verification, `event_id` dedupe and message storage are
   reused unchanged. Unknown token or bad signature → 401. The legacy
   env-secret route is removed.
5. **Backfill** — webhooks only deliver new mail, so connect schedules a
   one-time sync: page `GET /v0/inboxes/{id}/threads` (+ messages) for the last
   30 days into `conversations`, marked `source: "backfill"`. Status shows
   "Syncing n threads…" then "Synced".
6. **Send** — `integrations/agentmail.ts` takes the decrypted key as an
   argument instead of `process.env`; all component send/inbox helpers that
   read env are not used.
7. **Disconnect / rotate** — delete the webhook with the old key, wipe both
   secrets, agent pauses with a "reconnect inbox" banner. A 401 from AgentMail
   at send time flips the key to `invalid` and does the same.

Manage inbox UI: key status (last 4, valid/invalid), sending inbox address,
webhook health (last event received at), sync status, daily limit and sending
window, Disconnect. Reference: connect cards in
[04-connect-accounts](../temp-images/ref/04-connect-accounts.png), settings layout
in [26-settings-templates](../temp-images/ref/26-settings-templates.png).

Fallback if this proves heavy: AgentMail **pods** (one platform key, one
webhook, a pod per workspace, zero user setup). Not the plan; noted only.

### White-label rule
Lead data and web research are presented as OpenIntent's own capabilities.
- No screen, email, error message, tooltip, landing copy or client-visible
  field names Enrich or Firecrawl. UI vocabulary: **lead search**, **email
  finder**, **website analysis**, **company research**, **credits**.
- Provider names stay server-side: `convex/integrations/*`, env var names,
  `providerOperations.provider`. Queries that feed the client never return
  that field or raw provider error text; errors are mapped to our own messages
  ("Lead search is at capacity today", "We couldn't read that website").
- Provider ids are stored under neutral names (`sourceLeadId`, not
  `sourceLeadId`); network traffic from the browser only ever goes to Convex.
- AgentMail is the one named service, because the user pastes that key.
- `hackathon.md` still lists components truthfully — that log is for the
  judges, not product UI.

## 5. Routes

| Path | Guard | Screen |
|---|---|---|
| `/` , `/tour` | public | marketing |
| `/sign-in`, `/handler/$` | public | Hexclave |
| `/onboarding` | signed in, onboarding not finished | full-screen stepper, no app shell; resumes at the saved step |
| `/dashboard` | workspace + onboarding done | stats, chart, hot leads, latest replies |
| `/agent` | 〃 | the agent: mode, signals on/off with leads per signal, instructions, booking link, Run now |
| `/contacts` | 〃 | table; `?lead=<id>` opens the lead drawer (research, signals, thread, approve/reject, get email) |
| `/inbox`, `/inbox/$conversationId` | 〃 | conversation list + thread with suggested reply |
| `/settings?tab=company\|inbox\|outreach\|blocklist\|sending\|usage\|account` | 〃 | company profile · Manage inbox · default outreach instructions · blocklist (emails and domains never contacted, backed by `suppressions`) · sending days/hours/limit · credit balance + usage history from the real ledger · account |
| `$` | in shell | 404 |

Redirects: signed-in user without finished onboarding → `/onboarding`; after
Confirm → `/contacts`; old `/leads`, `/prospects`, `/overview`, `/employees`,
`/squads`, `/decisions` → nearest new page. Sidebar order: Dashboard, Agent,
Contacts, Inbox, Settings; credits block and user menu at the bottom. Inbox
shows an unread count from the existing attention hook. The header bell opens
a feed from `activityEvents` (new reply, meeting booked, run finished, credits
low).

### Onboarding edge cases
- Progress is saved per step on the draft agent / business profile
  (`onboardingStep`), so refresh or sign-out resumes where the user left.
- "I don't have a website": skip the scrape, show the empty company form, the
  user types name + description, everything downstream runs from that.
- Analysis failure (blocked site, timeout): keep the URL, show "We couldn't
  read that website", offer Retry and "Fill in manually". The free first run is
  only consumed on success.
- Every AI-generated step has Regenerate (3 credits) and is fully editable.
- Inbox step is skippable; the agent then starts in `sourcing_only` mode and a "Connect inbox to start sending" banner on Agent and Contacts.
- Zero leads after Confirm: Contacts shows which signals returned nothing and
  links back to edit the ICP — never an empty table with no explanation.

## 6. Credits, trial limits and key protection

Platform-paid services are Enrich, the GPT gateway and Firecrawl. A stranger
signing up to a public hackathon URL must not be able to drain any of them.
There is one plan, `trial`, no upgrade path and no billing UI. Limits are
constants in `convex/lib/limits.ts` so a real plan can be added later by
swapping the lookup.

### Two layers
1. **Credits** — the one number the user sees. Our own unit, not tied to any
   provider's pricing; everything that costs us money has a credit price.
2. **Provider caps** — hidden, per workspace, in the provider's real units.
   These are the actual guarantee. A call must pass both layers.

### Layer 1 · visible credits (trial grant: 300, lifetime, no refill)
| Action | Credits |
|---|---|
| First-run onboarding: analyze website, generate ICP, recommend signals | 0 (once each) |
| Re-run any of those, or "Generate more" keywords | 3 |
| Find leads: one search page, up to 25 people | 2 |
| Research and score one lead (scrape + AI) | 3 |
| Get a lead's email | 15 |
| Write an outreach email or follow-up | 1 |
| Read a reply and draft the answer | 1 |
| Counts, filter options, browsing, approving, sending, unsubscribe handling | 0 |

Budget check — a realistic trial: 4 signal searches (8) + 10 researched leads
(30) + 10 emails found (150) + 30 emails written incl. follow-ups (30) + 10
replies handled (10) = 228, leaving ~70 for more research. The expensive,
valuable steps (emails found, conversations) are what the credits are for —
so research is **deliberately small at first** (§10 "Initial batch").

Prices live in `convex/lib/limits.ts` as a typed map, so the numbers can be
retuned without touching call sites.

### Layer 2 · hidden provider caps per trial workspace
| Provider | Lifetime cap | Daily cap |
|---|---|---|
| Enrich credits (real) | **100** — never more, whatever the credit balance says | 50 |
| Enrich searches | 12 (the account's 50 free unique searches a month are shared) | 6 |
| GPT gateway calls | 400, each with truncated input and `maxOutputTokens` | 40 |
| Firecrawl pages | 80 | 15 |
| Emails sent | — (user's own AgentMail key) | existing daily send limit, max 30 |

Also: 1 workspace per user, 1 agent per workspace. The hidden 100-credit cap
means at most 10 emails found per trial whatever the visible balance says; the
button explains "Trial limit for emails reached" rather than "out of credits".

The sidebar shows "Credits · n remaining" like the reference's Team credits
block — no refill date, no upgrade button, no pricing page. Out of credits:
paid buttons disable with a short explanation; everything free keeps working.

### Ledger (reuse `convex/usage.ts`)
The existing `usageBuckets` / `usageReservations` reserve → commit | release |
uncertain ledger already debits inside one transaction, so concurrent calls
cannot overspend. Changes:
- metrics become `credits`, `enrich_credits`, `enrich_searches`, `ai_calls`, `scrapes`, `sends`;
  period keys are `lifetime` or the workspace-local day.
- Trial grant = creating the `lifetime` buckets with their limits in the same
  mutation that creates the workspace. No bucket → every paid call refuses.
- Every paid call goes through one wrapper, `withCredits(ctx, { workspaceId, action, worstCaseProviderUnits, operationKey }, fn)`:
  **reserve the action's credit price + the worst-case provider units (workspace
  and platform buckets) in one transaction → call provider → commit credits,
  commit the provider's actual `meta.creditsUsed`, release the rest**. A
  provider call that finds nothing and costs us nothing refunds the credits.
- **Three outcomes, never two.** Every paid step ends in exactly one of:
  | Outcome | When | Credits | Provider units |
  |---|---|---|---|
  | **refunded** | refused before any provider effect (validation, 401/403, 429 after back-off, kill switch), or the provider answered and charged 0 (email not found, zero rows) | released in full | released |
  | **billed** | the provider did the work — even if a *later* step failed. A lead whose page was scraped but whose AI scoring failed is billed the scrape, refunded the AI call, and retried from the stored markdown without scraping again | committed | committed at the provider's reported actual |
  | **uncertain** | the request left us and we do not know (timeout, 5xx after send, crash mid-action) | held | held at worst case |
  An `uncertain` hold is resolved by the recovery sweep (§10): look the
  operation up at the provider (reveal job by id, idempotency key for sends);
  found → billed/refunded accordingly; still unknown after 24 h → committed at
  worst case (we never hand back money we may have spent). The Usage tab shows
  held credits as "pending". Unknown outcome (timeout after the
  request left) → `uncertain`, which keeps the capacity blocked until the
  reveal job / balance is reconciled. `operationKey` makes retries free.
- A reveal reserves `10 × leads` before the call and is never sent with more
  leads than the remaining balance affords. `fields` is always `["email"]`;
  `phone` is unreachable from any code path.

### Platform-wide circuit breakers
Table `platformBudgets`: `{ provider, periodKey, limit, used }`, limits from env
(`ENRICH_DAILY_CREDIT_BUDGET`, `ENRICH_MONTHLY_SEARCH_BUDGET`,
`AI_DAILY_CALL_BUDGET`, `FIRECRAWL_DAILY_BUDGET`, `MAX_TRIAL_WORKSPACES`).
The wrapper debits the workspace bucket **and** the platform bucket in the same
transaction; if the platform bucket is empty the call refuses for everyone and
the UI says "Lead search is at capacity today". Worst case per day is therefore
a number we chose, not a function of how many people sign up.
`PLATFORM_PAUSED=true` stops all paid calls instantly without a deploy.
A cron reads Enrich `GET /wallets/balance` hourly and trips the breaker if the
real balance falls below a floor, so drift between our ledger and theirs
cannot become an overdraft.

### Closing the ways in
- Paid work only happens in `internalAction`s. Public functions are mutations
  that authenticate (Hexclave), check workspace membership, reserve credits and
  schedule the action. No public action accepts a URL, filter object or prompt
  and forwards it to a provider.
- Firecrawl: only the user's verified-format website (at onboarding) and the
  `domain` of a stored prospect. Public http(s) hosts only; IPs, localhost and
  private ranges rejected; page count fixed.
- Enrich filters sent upstream are rebuilt server-side from validated enum
  values; `pageSize` fixed at 25; `page` ≤ 3 on the platform key.
- Per-user rate limits with `@convex-dev/rate-limiter` on every
  credit-spending mutation (token bucket, e.g. analyze 3/min, recommend 3/min,
  reveal 10/min) so a script cannot burn a day's allowance in a second or spam
  the scheduler.
- Signup: verified email (existing Hexclave OTP) before a workspace can be
  created; one trial workspace per user; `MAX_TRIAL_WORKSPACES` caps total
  trials, after which new users see a waitlist state.
- Platform keys live only in Convex env. They are never written to a table,
  log, error message, `activityEvents` row or client payload; provider error
  bodies are mapped to our own messages before storage.
- `providerOperations` keeps one row per paid call (workspace, provider,
  endpoint, credits, outcome) — the audit trail if a key is ever abused.

## 7. Data model

Tenancy (owner decision, 2026-09-21): `workspaces` becomes **`orgs`** (one row per Hexclave organization, `hexclaveOrgId` indexed and unique-by-mutation, every other table's `workspaceId` becomes `orgId`), and `memberships` is removed — see EXECUTION T44. Wherever this plan still says "workspace", read "org".

Kept as-is: `conversations`, `conversationNotes`,
`drafts`, `approvals`, `sendAttempts`, `suppressions`, `emailEventReceipts`,
`quarantinedEmailEvents`, `usageBuckets`, `usageReservations`,
`providerOperations`, `activityEvents`, `leadEvents`, `bookings`, `evidence`.

- **`businessProfiles`** (extend): `websiteUrl`, `companyName`, `industry`,
  `description`, `keyFeatures[]`, `socialProof[]`, `painPoints`, `analysisStatus`.
- **`agents`** (replaces `campaigns`):
  `name` (generated from ICP: "Title · Region · Industry", editable),
  `mode: "sourcing_only" | "review" | "autopilot" | "paused"`, `dealSize?`,
  `icp { jobTitles[], industries[], locations[], companyTypes[], companySizes[], excludeProfiles[], excludeKeywords[] }`,
  `onboardingStep`,
  `goal: "start_conversations" | "book_calls"`,
  `tone: "professional" | "conversational" | "direct"`,
  `instructions?`, `bookingUrl?`, `keywords[]`,
  `dailyLeadCap`, `dailyResearchCap`, `autoRevealDailyCap`, `autoApproveMinScore`,
  `followUpDays: [3, 7]`, `revision`, `run { leaseId, leaseUntil, startedAt }`,
  `autopilot? { authorizedBy, authorizedAt, revision }`, `nextRunAt`, `lastRunAt`,
  `legacyCampaignId?`. One agent per workspace is enforced in the create
  mutation (read existing → refuse), not by an index.
- **`legacyCampaigns`**: read-only copies of pre-pivot campaigns folded into an
  agent (MIGRATION.md §1). Empty on the clean-slate path.
- **`strategies`**: `agentId`, `title`, `signalKind: "core_icp" | "funded" | "hiring" | "growth" | "ad_spend" | "tech" | "team_shape" | "keyword"`,
  `rationale`, `filters`, `excludeFilters`, `matchCount`, `enabled`,
  `source: "recommended" | "user"`, `nextPage`, `lastRunAt`, `leadsFound`.
- **`leadFilterOptions`**: cached allowed values, `fetchedAt`.
- **`prospects`** (extend): `agentId`, `linkedinUrl`,
  `origin`: `{ kind: "sourced", sourceLeadId, strategyIds[] }` | `{ kind: "legacy", legacyCampaignId }` | `{ kind: "manual" }`,
  `research`: `{ status: "not_researched" }` | `{ status: "researching", startedAt }` | `{ status: "researched", aiScore: 1 | 2 | 3, aiScoreReason, summary, researchedAt }` | `{ status: "failed", lastError }`
  — a score exists only on a researched lead and a source id only on a sourced
  one, so found-but-unresearched and migrated leads are valid documents, not
  exceptions. UI and queries switch on the variant; nothing reads a bare
  `aiScore`.
  `emailStatus: "locked" | "revealing" | "found" | "not_found"`,
  `stage: "found" | "researched" | "queued" | "contacted" | "replied" | "interested" | "meeting_proposed" | "meeting_booked" | "closed_lost" | "rejected" | "needs_attention"`,
  `approval: "pending" | "approved" | "rejected"`, `approvedBy: "user" | "autopilot"`,
  `preRank`, `lastError?`, `followUpsSent`, `nextActionAt`, `legacy?`.
- **`workspaceSecrets`**: above.
- **`workspaces`** (extend): `plan: "trial"`, `webhookToken`, `agentmailWebhookId`,
  `connectedAt`, `opensObserved`, `inboxConnection: "none" | "legacy_platform_inbox" | "connected" | "invalid"`;
  index `by_inboxRef` (uniqueness enforced in the claim mutation, §9.4).
- **`conversations` / messages** (extend): `source: "backfill" | "live"`, index
  `by_workspace_inbox_providerMessageId` (single-writer upsert, §9.4). **`drafts`** (extend): `agentRevision`, state
  `superseded`. **`approvals`** (extend): `actor: "user" | "autopilot"`.
- **`platformBudgets`**: §6. `usageBuckets` metrics change as in §6.

`stage` + `nextActionAt` (indexed) is the whole state machine; the cron picks up
whatever is due.

## 8. AI tasks (`convex/ai/`)

| File | In → Out |
|---|---|
| `analyzeWebsite.ts` | Firecrawl markdown → company profile |
| `generateIcp.ts` | profile → ICP (job titles, industries, locations, types, sizes, exclusions) + pain points |
| `recommendStrategies.ts` | profile + ICP + signal catalogue + allowed values (+ count feedback on the relax pass) → 3–5 strategies and suggested keywords |
| `researchLead.ts` | lead preview + company homepage → score 1–3, reason, research summary, personalisation hooks |
| `writeOutreach.ts` | lead + research + profile + tone/goal/instructions, step 0/1/2 → subject, body |
| `handleReply.ts` | inbound + thread + profile → class (`interested | question | objection | not_now | not_interested | ooo | unsubscribe`) and the next move: reply draft, booking proposal, stop, or reschedule |

## 9. Contracts

### 9.1 Background execution
All background work is driven by **state in the database plus short idempotent
steps**, never by long-running actions or chains of in-memory timers.

- **Single flight.** `agents.run { leaseId, leaseUntil, startedAt }`. The
  cron / Run now mutation takes the lease in a transaction only if none is
  live; a second trigger is a no-op that returns "already running". Every step
  re-checks it still holds `leaseId` before writing; a lost lease stops
  quietly. Lease 5 min, renewed per step; a crashed run is reclaimable when the
  lease expires.
- **Steps, not loops.** A run is a sequence of small internal mutations/actions
  scheduled one after another, each handling one lead or one page and each
  safe to run twice (`operationKey` = agent + lead + step + revision). No
  action depends on finishing a whole batch inside its timeout.
- **Retries.** Provider calls retry inside `integrations/*` for 429/5xx with
  capped back-off (3 tries). A step that still fails records
  `lastError { code, at, attempts }` on the lead, moves `nextActionAt` out
  (5 min → 30 min → 4 h), and after 3 step-level attempts parks the lead as
  `needs_attention` with a human-readable reason and a Retry button. Convex
  does not auto-retry actions, so **the sweep is the retry mechanism**.
- **Recovery sweep** (cron, every 10 min): expired run leases; leads stuck in a
  transient state (`revealing`, `researching`, `sending`) past their deadline;
  `uncertain` reservations; reveal jobs never polled to completion. Each is
  reconciled against the provider first, then retried or parked.
- **Revision fencing.** `agents.revision` increments whenever instructions,
  tone, goal, ICP, template or mode change. Every draft and queued step stores
  the revision it was made under.
- **Invalidate on change.** The authoritative check is *at the moment of
  effect*: the send mutation re-validates everything in its own transaction
  (agent not paused and in a sending mode, revision matches, lead not rejected,
  no reply since the draft was written, not suppressed, approval valid, inside
  window and limits). Cancelling scheduled functions is a courtesy on top.

  | Event | Pending work |
  |---|---|
  | User pauses the agent / kill switch | nothing new starts; in-flight step finishes its current provider call, writes its result, then stops; unsent drafts stay as drafts |
  | User rejects a lead | queued (not yet started) reveal, draft, send and follow-ups for that lead cancelled; open drafts → `superseded`. Accounting follows the rule below — a rejection never refunds by itself |
  | User changes instructions / tone / goal | `revision`++; unsent drafts under the old revision → `superseded` and rewritten on the next pass (1 credit each, only for leads still due); sent mail untouched |
  | A reply arrives | follow-ups for that conversation cancelled in the same mutation that stores the reply; any unsent draft in the thread → `superseded`; stage → `replied` |
  | Lead unsubscribes / is blocklisted | as reject, plus suppression; checked again at send time regardless |
  | Inbox key becomes invalid | agent → `paused` with reason; nothing is dropped, everything resumes on reconnect |

**Cancellation never decides money.** Pausing, rejecting, editing instructions
or a reply arriving only stops work that has **not started**. For each held
reservation the outcome is decided by evidence, exactly as in §6:
- step never began (no provider request was issued: no `providerOperations`
  row, send attempt still `reserved`) → **refunded**;
- provider call started or finished → it runs to its recorded result and is
  **billed** at the provider's actual, even though the result is now unwanted
  (a revealed email for a rejected lead is stored, not re-bought, and still
  costs what it cost);
- unknown → stays **uncertain** and goes to the recovery sweep.
The same rule applies to a failed AI or scrape call, to a lost run lease and
to data migration: *refund only what is proven not to have been charged.*

### 9.2 Initial batch
Confirm does **not** research everything it finds.
1. Search page 1 of each selected strategy (2 credits each) → rows stored as
   `found` with the free preview data. No AI, no scrape.
2. **Free pre-rank** in plain code: title/seniority match to the ICP, company
   size in range, number of strategies that found the person, domain present.
3. Research the top **8** overall, round-robin across strategies so each
   selected signal is represented (minimum 1 per strategy, maximum 10).
4. Everything else stays `found`, visible in Contacts with "Not researched
   yet" and a **Research** action (3 credits) per row and in bulk.
5. Afterwards the agent researches at most `dailyResearchCap` (default 5) new
   leads a day, best pre-rank first, and only while credits allow it to still
   afford the emails for leads already approved (it reserves 15 × approved
   leads awaiting an email before spending on research).

### 9.3 Approval and Autopilot
Two different approvals, never conflated:
- **Lead approval** — "yes, contact this person". Authorises finding their
  email (15 credits) and drafting.
- **Email approval** — "yes, send this text". Authorises one specific draft
  version.

| Mode | Lead approval | Email reveal | Email approval | Replies |
|---|---|---|---|---|
| Sourcing only | manual, optional | manual button only | — nothing is sent | shown, never answered |
| Review | **manual** | automatic once the lead is approved | **manual**, per draft | drafted, wait for send |
| Autopilot | automatic for score ≥ `autoApproveMinScore` (default 2); user can still reject any time | automatic, max `autoRevealDailyCap` (default 5) a day | automatic | automatic within the limits below |
| Paused | — | — | — | shown, never answered |

Autopilot authorisation:
- Switching to Autopilot opens a consent dialog stating exactly what it will
  do (find emails using credits, send without review, reply on your behalf,
  daily limits). Accepting writes `agents.autopilot { authorizedBy, authorizedAt, revision }`.
  A change of instructions/goal/tone keeps Autopilot on but is recorded; a
  migration or a key reconnect never turns it on.
- Autopilot does not bypass anything. It produces an `approvals` row with
  `actor: "autopilot"` bound to the draft id + revision, and the send goes
  through the **same** ledger: suppression, blocklist, sending window, daily
  limit, idempotency key, credits, platform budget, kill switch.
- Auto-replies only for classes `question`, `objection`, `interested`; at most
  2 automatic replies per thread, then the thread is handed to the user
  ("Needs you"). Never auto-reply to `not_interested`, `unsubscribe`, `ooo`,
  to a thread we did not start, or to anything older than the connection (9.4).
- Automatic reveal is part of the outreach loop (EXECUTION T40), not sourcing.

### 9.4 Inbox connection
- **Matching.** A webhook event is accepted only if the path token resolves to
  a workspace **and** the event's `inbox_id` equals that workspace's
  `inboxRef`; otherwise it is quarantined, never attached.
- **One inbox, one workspace.** Convex has no unique indexes, so uniqueness is
  enforced **transactionally**: the connect mutation reads
  `workspaces.by_inboxRef` for the inbox id and writes the claim in the *same*
  mutation. Convex mutations are serializable, so two concurrent connects
  cannot both pass the read. The provider calls (verify key, register webhook)
  happen in an action *before*; the claim is the final mutation, and an action
  that loses the race deletes the webhook it just registered. Connecting an inbox
  already connected elsewhere is refused ("This inbox is connected to another
  workspace"). The same key may serve two workspaces only with two different
  inboxes. Reconnecting the same inbox to the same workspace is idempotent:
  webhook `client_id` = workspace id, so a second registration returns the
  existing webhook instead of a duplicate.
- **Rotation.** New key must be able to see the current inbox, else it is a
  different connection (disconnect first). Order: verify new key → register new
  webhook → store new key + secret → delete old webhook with the old key
  (best effort). Both secrets are accepted for 10 minutes so nothing is lost
  in between.
- **Backfill vs live.** Message identity is `(workspaceId, inboxId, providerMessageId)`
  — provider ids are only unique within an account, never globally. One
  internal mutation, `inbox.model.upsertMessage`, is the **only** writer: it
  looks the triple up on index `by_workspace_inbox_providerMessageId` and
  inserts or merges in the same transaction, so backfill and webhook racing on
  the same message produce one row (`source: "live"` wins over `"backfill"`;
  a later backfill never downgrades it). No code path inserts a message
  directly.
- **Legacy inboxes.** A workspace created before the pivot may still use an
  inbox on the platform account (`inboxConnection: "legacy_platform_inbox"`).
  The old `/agentmail/webhook` route and its env secret stay mounted for them:
  events there are matched by `inbox_id` → workspace as before, go through the
  same `upsertMessage`, and are **receive-only** — shown in the Inbox, never
  auto-answered, and the workspace cannot send until it connects its own key.
  The route and env secret are removed only when no workspace is in that state
  (always true after a clean-slate migration once owners reconnect; checked,
  not assumed).
- **Never answer history.** `handleReply` runs only when **all** hold: source
  is `live`; message time > `connectedAt`; the thread was started by one of our
  `sendAttempts` to a known prospect; sender is not us; not already handled.
  Backfilled and unrelated mail is readable in the Inbox and nothing more.

### 9.5 Meetings
A booking link in our email, or a model saying "they agreed", is not a meeting.
- Stages: `interested` → `meeting_proposed` (we sent the link / times, or the
  lead asked for a call) → `meeting_booked`.
- `meeting_booked` is set **only by the user** ("Mark as booked" with date and
  time, in the thread and the lead drawer), writing the `bookings` row. The
  model may *suggest* it ("Looks like they confirmed Tuesday 3 pm — mark as
  booked?") but never sets it.
- Dashboard "Meetings" counts confirmed bookings only; proposed ones are shown
  separately. A calendar-provider integration that verifies bookings is
  post-MVP and would be the only other writer.

### 9.6 Open tracking
Optional, never assumed. T00 checks whether the mail provider emits open events
for our inbox type and what the sender must configure. `workspaces.opensObserved`
flips true on the first verified open event. Until then the Agent card shows
Contacted · Replied · Interested — no "Opened" column, no zero, no dash. If T00
finds tracking unsupported, the metric is dropped from the build entirely.

## 10. Code structure

Organised by **domain**, not by technical layer. A new contributor should find
everything about "leads" in one backend folder and one frontend folder.

### Backend — `convex/`
```
convex/
  schema.ts  http.ts  crons.ts  convex.config.ts  auth.config.ts   ← composition only
  lib/            cross-domain helpers only
    auth.ts  errors.ts  limits.ts  rateLimits.ts  secrets.ts  urlSafety.ts  time.ts
    validators/   shared.ts + one file per domain, re-exported from index.ts
  integrations/   the ONLY place that talks HTTP to a provider
    agentmail.ts  enrich.ts  firecrawl.ts
  ai/             gateway plumbing + one file per AI task
    models.ts  run.ts  analyzeWebsite.ts  generateIcp.ts  recommendStrategies.ts
    researchLead.ts  writeOutreach.ts  handleReply.ts
  workspaces/     workspaces, memberships, secrets
  billing/        credits, usage ledger, platform budgets, balance watchdog
  company/        business profile, website analysis orchestration
  agents/         agents, strategies, filter-option cache, run loop, sourcing
  leads/          prospects: queries, mutations, research, email reveal, events, evidence
  outreach/       drafts, approvals, sending ledger, send attempts, suppressions, follow-ups
  inbox/          connection, backfill, inbound, conversations, notes, replies, quarantine
  bookings/
  dashboard/      read-only aggregates
  activity/
```
Inside a domain folder:
- `queries.ts`, `mutations.ts`, `actions.ts` — the public/internal Convex
  functions. Thin: validate args, authorise, call the model, return. A file
  that grows past ~300 lines splits by sub-topic (`leads/emailReveal.ts`).
- `model.ts` — plain typed functions taking `ctx` that hold the actual logic
  and are shared by the functions above (Convex's recommended model layer).
  No `ctx.runQuery`/`runMutation` hops between our own functions inside one
  transaction — call the model function.
- Domain validators live in `lib/validators/<domain>.ts`; table field objects
  stay exported from `schema.ts` as they are today.
- Dependency direction: `domain → lib | integrations | ai`. Domains do not
  import each other's function files; they share through a `model.ts` import
  or a scheduled internal function. `integrations/` and `ai/` never import a
  domain.
- Names say what they do: `leads.mutations.approve`, `agents.actions.runOnce`,
  `billing.queries.summary`. No `utils.ts`, `helpers.ts`, `misc.ts`,
  `handleStuff`. Internal functions use `internalQuery/Mutation/Action`;
  anything not called by the browser is internal.
- Errors: one `lib/errors.ts` with a typed code union and `domainError(code)`;
  the client maps codes to copy in one place. Provider error text never leaves
  `integrations/`.
- No magic numbers: limits, prices, page sizes, follow-up days, truncation
  budgets live in `lib/limits.ts`.

### Frontend — `src/`
```
src/
  routes/            file routes — thin: params, guard, render ONE page component
  components/
    ui/              shadcn primitives (generated; do not hand-edit structure)
    kit/             our design kit: data-free, reference-styled building blocks
    layout/          shell, sidebar, header, credits block, notifications
    marketing/
    onboarding/      OnboardingPage + steps/  (company, icp, outreach, signals)
    dashboard/  agent/  contacts/  inbox/  inbox-connection/  settings/  credits/
    states/          shared loading / empty / error
  hooks/             cross-domain hooks only
  lib/               cross-domain pure helpers only (formatting, search params, errors → copy)
  constants/
```
Inside a component domain folder:
- `XxxPage.tsx` is the container: it owns the Convex `useQuery`/`useMutation`
  calls and passes plain props down. Children are presentational and know
  nothing about Convex — that is what keeps them reusable and easy to restyle.
- One component per file, PascalCase file = component name. Hooks are
  `use-xxx.ts`; pure helpers and view-model types are `xxx-model.ts`. Folder
  names are lowercase (rename `Layout` → `layout`, `Marketing` → `marketing`).
- A component past ~200 lines, or with more than one job, splits. Sub-parts
  used only by one parent sit in a sub-folder named after it
  (`contacts/table/`, `contacts/drawer/`, `onboarding/steps/`).
- `kit/` and `ui/` never import from a domain folder or from `convex/`.
  Domain folders do not import from each other; shared pieces move to `kit/`,
  `layout/` or `states/`.
- No barrel `index.ts` files (they hide dependencies and slow the build);
  import the file.
- Types come from Convex (`Doc<"prospects">`, `FunctionReturnType<…>`), not
  hand-copied interfaces. Status → label/colour maps are typed `Record`s over
  the union so a new status fails the build until it is handled.
- Styling through theme tokens and `cn()`; no inline hex colours, no
  one-off spacing hacks.

### Maintainability basics
- Every domain folder on both sides opens with a 3–6 line header comment in
  its main file: what the domain owns and what it does not.
- Comments explain *why* (a provider quirk, an invariant, a money rule), never
  restate the code. No commented-out code, no TODOs without an owner task id.
- Delete what a change makes unused in the same commit.
- `convex/README.md` and the root `README.md` describe this layout and how to
  run the app; keep them true.

## 11. Milestones

Each ends with `pnpm lint`, `pnpm exec tsc -b`, `pnpm build`, a manual
click-through, feature-wise commits and a `hackathon.md` entry.

**M0 – Foundation.** Credits first: `limits.ts`, new usage metrics, trial grant
on workspace creation, `withCredits`, `platformBudgets`, rate limiter, kill
switch, sidebar credit block — nothing that spends money is written before
this exists. Gateway packages + `models.ts` + smoke action. Schema §7.
`workspaceSecrets`, crypto helper, and the full
Manage inbox flow (§4: connect, inbox, per-workspace webhook, backfill). Routes and
redirects from §5, sidebar, Settings tabs incl. Usage. The M0 verification
spikes in §4. Theme pass toward the reference.

**M1 – Onboarding.** Full-screen stepper, four dots with sub-steps, as in the
reference:
1. **Company** — website → Analyze → editable profile.
2. **ICP** — job titles → company filters → exclusions (AI-generated chips).
3. **Outreach** — connect the sending inbox (paste AgentMail key, verify, "Connect later") → goals: pain points, goal, tone.
4. **Signals** — recommended strategies with live counts → keywords → ICP review → **Confirm & preview leads** → Contacts filled with real, scored leads.

**M2 – Find + research.** `integrations/enrich.ts` thin client (envelope, retry,
credits via `providerOperations`). `leadFilterOptions` cache + `recommendStrategies` + count/relax loop (§3).
Agent run: for each enabled strategy, `search` its next free page → upsert/dedupe
prospects → `researchLead`. Contacts table (name/title/
company, flame score, stage, email reveal, approve/reject) + lead detail drawer
with research summary.

**M3 – Contact.** Cron-driven run loop: leads that are researched, scored ≥ 2,
not suppressed, with a found email, inside send window and daily limit →
`writeOutreach` → draft → send (autopilot) or await approval (review).
Follow-ups at `followUpDays` while no reply. Agent page: mode switch, funnel
counts, instructions, booking link, run now.

**M4 – Close.** Inbound → `handleReply` at the seams left by the removal.
Autopilot answers questions/objections and proposes the booking link; review
mode drafts and waits. Interested → `interested`; call agreed →
`meeting_proposed`; the user confirms → `meeting_booked` + `bookings` row (§9.5); unsubscribe → suppression + stop. Inbox tabs:
Received / Interested / Unread / All, with thread, suggested reply, edit, send.

**M5 – Dashboard + ship.** Stat cards (found, contacted, replied, interested,
meetings), activity chart, latest hot leads, latest replies. Empty/error
states, landing copy, production deploy, final log entry.

Strictly sequential M0 → M4; dashboard work in M5 can start once M2 data exists.

## 12. Working rules

- No tests unless asked. Idiomatic TypeScript, explicit unions, no `any`.
- Feature-wise commits. No co-author trailers, no tool/vendor attribution in commits.
- Enrich, AgentMail and the gateway are only ever called from Convex actions.
- Spend guard: never request Enrich `phone`; always `fields: ["email"]`; reveal only leads scored ≥ 2; stay in free search pages unless the cap is raised.
- Every outbound email carries an opt-out line; suppression is checked before each send, including follow-ups and AI replies.
- Keep secrets and real email addresses out of `hackathon.md`.
