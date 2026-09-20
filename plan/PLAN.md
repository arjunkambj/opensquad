# OpenSquad MVP plan

**An AI sales agent that finds and researches leads for you, contacts them for
you, and works the replies until a meeting is booked.** Email only. UI modelled
on Gojiberry AI (see §2 for the per-screen references).

Call-by-call user flow (what each screen triggers and what gets stored):
[flow.html](flow.html). How to build it, task by task: [EXECUTION.md](EXECUTION.md).

## 1. The loop

```
 setup (once)            FIND               RESEARCH            CONTACT              CLOSE
website ─▶ profile ─▶ Enrich search ─▶ score + company ─▶ personalised email ─▶ classify reply
        ─▶ ICP        per recommended   research note      + 2 follow-ups        ─▶ answer / handle objection
        ─▶ strategies strategy                                                   ─▶ propose meeting ─▶ booked
        ─▶ lead preview
```

Every stage is visible per lead as a status, and the agent runs on a cron
without anyone clicking. The user can run it in **Autopilot** (sends on its own)
or **Review** (every email waits for one-click approval).

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
6. **Preview real leads**: on Confirm, run `search` page 1 for each selected strategy (free tier: 75 rows per search, 50 unique searches a month — so we search only what the user selected, never speculatively), dedupe by `sourceLeadId`, score with `researchLead`, and land the user on Contacts with real, scored leads tagged by the strategy that found them.

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
| Auth | Hexclave + workspaces + memberships, unchanged. |
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
Lead data and web research are presented as OpenSquad's own capabilities.
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
| `/settings?tab=company\|inbox\|sending\|usage\|account` | 〃 | company profile · Manage inbox · sending days/hours/limit · credit balance + usage history from the real ledger · account |
| `$` | in shell | 404 |

Redirects: signed-in user without finished onboarding → `/onboarding`; after
Confirm → `/contacts`; old `/leads`, `/prospects`, `/overview`, `/employees`,
`/squads`, `/decisions` → nearest new page. Sidebar order: Dashboard, Agent,
Contacts, Inbox, Settings; credits block and user menu at the bottom. Inbox
shows an unread count from the existing attention hook.

### Onboarding edge cases
- Progress is saved per step on the draft agent / business profile
  (`onboardingStep`), so refresh or sign-out resumes where the user left.
- "I don't have a website": skip the scrape, show the empty company form, the
  user types name + description, everything downstream runs from that.
- Analysis failure (blocked site, timeout): keep the URL, show "We couldn't
  read that website", offer Retry and "Fill in manually". The free first run is
  only consumed on success.
- Every AI-generated step has Regenerate (3 credits) and is fully editable.
- Inbox step is skippable; the agent then starts in `review` mode with sending
  disabled and a "Connect inbox to start sending" banner on Agent and Contacts.
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

### Layer 1 · visible credits (trial grant: 200, lifetime, no refill)
| Action | Credits |
|---|---|
| First-run onboarding: analyze website, generate ICP, recommend signals | 0 (once each) |
| Re-run any of those, or "Generate more" keywords | 3 |
| Find leads: one search page, up to 25 people | 5 |
| Research and score one lead (scrape + AI) | 2 |
| Get a lead's email | 20 |
| Write an outreach email or follow-up | 1 |
| Read a reply and draft the answer | 1 |
| Counts, filter options, browsing, approving, sending | 0 |

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

Also: 1 workspace per user, 1 agent per workspace. 200 credits at 20 per email
is at most 10 reveals = 100 Enrich credits, so the two layers agree by design
and the hidden cap is the backstop if prices are ever retuned.

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
  provider call that finds nothing and costs us nothing refunds the credits. Unknown outcome (timeout after the
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

Kept as-is: `workspaces`, `memberships`, `conversations`, `conversationNotes`,
`drafts`, `approvals`, `sendAttempts`, `suppressions`, `emailEventReceipts`,
`quarantinedEmailEvents`, `usageBuckets`, `usageReservations`,
`providerOperations`, `activityEvents`, `leadEvents`, `bookings`, `evidence`.

- **`businessProfiles`** (extend): `websiteUrl`, `companyName`, `industry`,
  `description`, `keyFeatures[]`, `socialProof[]`, `painPoints`, `analysisStatus`.
- **`agents`** (replaces `campaigns`):
  `name`, `mode: "review" | "autopilot" | "paused"`,
  `icp { jobTitles[], industries[], locations[], companyTypes[], companySizes[], excludeProfiles[], excludeKeywords[] }`,
  `onboardingStep`,
  `goal: "start_conversations" | "book_calls"`,
  `tone: "professional" | "conversational" | "direct"`,
  `instructions?`, `bookingUrl?`, `keywords[]`,
  `dailyLeadCap`, `followUpDays: [3, 7]`, `lastRunAt`.
- **`strategies`**: `agentId`, `title`, `signalKind: "core_icp" | "funded" | "hiring" | "growth" | "ad_spend" | "tech" | "team_shape" | "keyword"`,
  `rationale`, `filters`, `excludeFilters`, `matchCount`, `enabled`,
  `source: "recommended" | "user"`, `nextPage`, `lastRunAt`, `leadsFound`.
- **`leadFilterOptions`**: cached allowed values, `fetchedAt`.
- **`prospects`** (extend): `agentId`, `strategyIds[]`, `sourceLeadId`, `linkedinUrl`,
  `aiScore: 1 | 2 | 3`, `aiScoreReason`, `researchSummary`,
  `emailStatus: "locked" | "revealing" | "found" | "not_found"`,
  `stage: "found" | "researched" | "queued" | "contacted" | "replied" | "interested" | "meeting_booked" | "closed_lost" | "rejected"`,
  `followUpsSent`, `nextActionAt`.
- **`workspaceSecrets`**: above.
- **`workspaces`** (extend): `plan: "trial"`, `webhookToken`, `agentmailWebhookId`.
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

## 9. Milestones

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
mode drafts and waits. Interested → `interested`; meeting accepted →
`meeting_booked` + `bookings` row; unsubscribe → suppression + stop. Inbox tabs:
Received / Interested / Unread / All, with thread, suggested reply, edit, send.

**M5 – Dashboard + ship.** Stat cards (found, contacted, replied, interested,
meetings), activity chart, latest hot leads, latest replies. Empty/error
states, landing copy, production deploy, final log entry.

Strictly sequential M0 → M4; dashboard work in M5 can start once M2 data exists.

## 10. Working rules

- No tests unless asked. Idiomatic TypeScript, explicit unions, no `any`.
- Feature-wise commits. No co-author trailers, no tool/vendor attribution in commits.
- Enrich, AgentMail and the gateway are only ever called from Convex actions.
- Spend guard: never request Enrich `phone`; always `fields: ["email"]`; reveal only leads scored ≥ 2; stay in free search pages unless the cap is raised.
- Every outbound email carries an opt-out line; suppression is checked before each send, including follow-ups and AI replies.
- Keep secrets and real email addresses out of `hackathon.md`.
