# Execution plan

How to build [PLAN.md](PLAN.md) with several agents working at once. PLAN.md
says *what*; this file says *who does what, in which order, touching which
files, and how we know it is done*. Read PLAN.md fully before taking a task.

## 0. Ground rules for every agent

1. **Read first:** PLAN.md (incl. the element-by-element coverage table in §2
   — it says exactly which reference elements are built and which are cut), [flow.html](flow.html), `AGENTS.md`, then the
   reference image(s) named in your task (`temp-images/ref/*.png`, local only).
   Build to the image: layout, hierarchy, component shapes, spacing.
2. **Stay in your lane.** Edit only the files under *Owns*. Files under
   *Integrator-only* (below) are never edited by a task agent — if you need a
   change there, write it in your hand-off note.
3. **No placeholders, no mock data** (PLAN §2). Every value on screen comes
   from a Convex query over real records. No sample arrays, no fake stats, no
   dead buttons, no "coming soon". Empty data → a designed empty state that
   says what to do next.
4. **White-label** (PLAN §4). Nothing client-visible names the lead-data or
   scraping provider. UI words: lead search, email finder, website analysis,
   company research, credits. Provider names live only in
   `convex/integrations/*`, env var names and `providerOperations.provider`.
5. **Money safety** (PLAN §6). Every call to a paid provider goes through
   `withCredits`. Paid work runs only in `internalAction`s scheduled by an
   authenticated mutation. No public function forwards a user-supplied URL,
   filter object or prompt to a provider.
6. **TypeScript:** explicit unions, generated Convex references, no `any`, no
   loose dictionaries, validators on every Convex function's args and returns.
   No tests unless asked.
7. **Commits:** small, feature-wise, conventional (`feat(onboarding): …`,
   `feat(convex): …`). No co-author trailers, no "generated with" lines, no
   mention of any coding assistant or its vendor anywhere in commits or files.
   Never push, never deploy, never run `convex deploy`.
8. **Verify before hand-off:** `pnpm lint`, `pnpm exec tsc -b`,
   `pnpm exec tsc -p convex/tsconfig.json --noEmit`, `pnpm build`. All four
   pass, or the task is not done. Paste the tail of each into the hand-off.
9. **Structure** (PLAN §10). Domain folders on both sides; thin Convex
   functions over a `model.ts`; page containers own data, children are
   presentational; one component per file; no `utils`/`helpers` dumping
   grounds, no barrels, no magic numbers, no cross-domain imports. Files past
   ~300 lines (backend) / ~200 lines (component) split. Put new files where
   PLAN §10 says, even if your task's *Owns* list names only the folder.
10. **Hand-off note** (final message): commits made, verification output,
   anything needed from Integrator-only files, anything unverified. Never claim
   a provider integration works unless you saw a real response.

### Integrator-only files
`convex/schema.ts`, `convex/lib/validators.ts`, `convex/lib/limits.ts`,
`convex/http.ts`, `convex/crons.ts`, `convex/convex.config.ts`,
`src/constants/sidebar-menu.ts`, `src/routes/_dashboard.tsx`, `src/index.css`,
`package.json`, `pnpm-lock.yaml`, `AGENTS.md`, `hackathon.md`, `plan/*`.

Wave 0 lands **all** schema, validators, limits, routes and shared UI pieces up
front precisely so that later tasks never need these files. The integrator also
owns `npx convex codegen` / `convex dev` against the **dev** deployment, merges
task branches in dependency order, runs the click-through after each wave, and
writes the `hackathon.md` entry.

### Who may touch a deployment
| Action | Who |
|---|---|
| `npx convex codegen` (dev deployment only) | any task agent, to regenerate `convex/_generated` after adding or moving function files. Commit the result. |
| `npx convex dev` / pushing functions to **dev** | integrator only, after merging a wave |
| Anything against **production** (`deploy`, `env set --prod`, `import`, migrations) | integrator, and only after the user says go, per MIGRATION.md |
| Provider dashboards, real keys | user; keys reach Convex env via the user or integrator, never a task agent's shell history or a file |

Consequences for acceptance: a task agent's **Done when** has two halves.
*Static* (the four verify commands, structure, no mock data) is the agent's
job. *Live* (anything phrased "a real …") needs pushed code and real keys, so
the agent lists those checks in its hand-off and the **integrator runs them
after the merge**; a task is ticked in §5 only when both halves pass.

### API hand-offs between tasks
Tasks never call a function another in-flight task is still writing.
- **Couple through data, not function references**, wherever one task starts
  work another task performs. Example: T23's Confirm sets
  `agents.status = "live"` and `nextRunAt = now`; T30's run cron picks up any
  agent whose `nextRunAt` is due. T23 needs nothing from T30 to compile or to
  be verified.
- Where a direct call is unavoidable, the callee is in an **earlier wave** and
  already merged, so it exists in the committed `convex/_generated/api`.
- `convex/_generated` conflicts at merge time are never hand-resolved: the
  integrator takes either side and re-runs codegen.
- A task that adds a cron or HTTP route writes the exact registration snippet
  in its hand-off; the integrator pastes it into `crons.ts` / `http.ts`.

### Worktrees
The integration branch is **`main`** (the owner confirmed there are no real
users, so building on it is fine). One git worktree + branch per task
(`task/T20-company-analysis`), branched from the integrated tip of the
previous wave and merged back into `main` by the integrator. Tasks inside a wave own disjoint
files, so merges are clean. All agents share the one dev Convex deployment for
type generation only through the integrator; task agents typecheck against the
committed `convex/_generated`.

## 1. Task graph

```
Wave 0 (serial)     T00 ─▶ T01 ─▶ T06 ─▶ T05 ─▶ T02 ─▶ T03 ─▶ T04
Wave 1 (parallel)   T10 inbox backend   T11 lead-data client   T12 scraper   T13 UI kit
Wave 2 (parallel)   T20 company ─▶ T21 ICP ─▶ T23 signals        T22 inbox + goals UI
Wave 3 (parallel)   T30 sourcing + research ─▶ T31 contacts      T32 agent page
Wave 4 (parallel)   T40 outreach ─▶ T44 org tenancy ─▶ T41 close + inbox   T42 dashboard   T43 settings
Wave 5 (serial)     T50 polish, audit, ship
```

T23 does not depend on T30: Confirm only flips the agent live and sets
`nextRunAt` (see API hand-offs); leads appearing is T30's acceptance.
Within wave 2, T20 → T21 → T23 is a chain (each needs the previous step's
data); T22 runs beside it. Within wave 3, T32 can start once T30's queries
exist. Within wave 4, T42 and T43 run beside the T40 → T41 chain.

## 2. Tasks

Each task lists **Depends**, **Owns**, **Build**, **Done when**.

---

### T00 · Verification spikes — integrator
**Depends:** removal finished. **Owns:** `plan/spikes.md`, a throwaway
`convex/spikes.ts` deleted at the end of the task.
**Build:** eight short probes, each recording the real request/response
shape (secrets redacted) in `plan/spikes.md`:
1. AI Gateway is enabled on the dev deployment; list the OpenAI model ids it
   serves; choose `MODELS.fast` and `MODELS.smart`.
2. Schema-constrained object output through `@convex-dev/ai-sdk-provider`.
   If unsupported: JSON-mode text + Convex validator parse (decide here, once).
3. Lead-data account: plan, balance, that search pages 1–3 cost 0, shape of
   `filter-options`, `search` rows and `reveal-jobs`.
4. AgentMail: `GET /v0/inboxes`, `POST /v0/webhooks` response incl. `secret`,
   thread + message list shapes for backfill.
5. Hexclave: how verified-email status reaches Convex auth.
6. Open tracking: does the mail provider emit open events for our inbox type,
   what must the sender configure, does the installed component pass them
   through. Result decides PLAN §9.6 (conditional metric, or dropped).
7. Whether `npx convex codegen` on this project pushes anything to dev; if it
   does, note it under "Who may touch a deployment".
8. Production data census for MIGRATION.md §0 (row counts, real vs test data)
   — read-only — and the user's choice of full vs clean-slate path.
**Done when:** every probe has a recorded real response or an explicit
"blocked: …" with the fallback chosen. Any blocker is raised to the user
before T01.

### T01 · Schema and validators — integrator
**Depends:** T00. **Owns:** `convex/schema.ts`, `convex/lib/validators.ts`.
**Build:** everything in PLAN §7 in one pass: extend `businessProfiles`,
`prospects`, `workspaces`; add `agents` (replacing `campaigns`), `strategies`,
`leadFilterOptions`, `workspaceSecrets`, `platformBudgets`; new usage metrics;
indexes for every query in PLAN §5 (`prospects` by workspace+stage,
workspace+nextActionAt, workspace+aiScore, agent+sourceLeadId; `strategies` by
agent; `conversations` by workspace+state). Migrate/rename `campaigns` call
sites minimally so the tree typechecks. Land the **final** schema (clean-slate path, see T06) — no widened
transitional shape, no legacy fields. Includes the lookup indexes behind the transactional
uniqueness checks of PLAN §9.4 (`by_inboxRef`,
`by_workspace_inbox_providerMessageId`) and the `origin` / `research` unions.
**Done when:** codegen + all four verify commands pass; no table or field from
PLAN §7 is missing.

### T06 · Data migration — integrator
**Depends:** T01, user's path decision from T00.8. **Owns:**
`convex/migrations/**`, `plan/migration-log.md`, the migrations component in
`convex/convex.config.ts`.
**Build:** the owner chose the **clean-slate path** (MIGRATION.md Decision +
§6): freeze using the existing `automationState` lever and **verify it**
(§4.0 — `PLATFORM_PAUSED` does not exist yet), drain `reserved` + `requesting`
+ `uncertain` send attempts and pending scheduled calls, export, **keep
`workspaces`, `memberships` and `suppressions` in place**, clear the other app
tables, run the two small shape migrations, push the final schema from PLAN §7. Production gets the same
clean-slate steps just before T50, when the owner says go.
**Done when:** dev runs the final schema; every kept suppression still points
at a live workspace **and a send preflight to a suppressed address is refused**
(row counts are not accepted as proof); an owner can sign in and lands in
onboarding; the export exists outside git; the full-restore rollback
(MIGRATION.md §5 last row) has been rehearsed once on dev; steps and results
are in `plan/migration-log.md`.

### T05 · Restructure into domain folders — integrator
**Depends:** T06. **Owns:** the whole tree, for this task only.
**Build:** mechanical moves, **no behaviour change**, per PLAN §10:
- Backend: move kept modules into `workspaces/`, `billing/`, `company/`,
  `agents/`, `leads/`, `outreach/`, `inbox/`, `bookings/`, `activity/`; split
  `lib/validators.ts` into `lib/validators/<domain>.ts` + `index.ts`
  re-export; split the oversized files along their existing section banners
  (`sending.ts` → reserve / dispatch / reconcile; `prospects.ts` → queries /
  mutations / model; `conversations.ts`, `bookings.ts` likewise). Update every
  `api.*` / `internal.*` reference, `crons.ts` and `http.ts`.
- Frontend: `Layout` → `layout`, `Marketing` → `marketing` (two-step
  `git mv` so the case change is recorded), `leads/` → `contacts/`, route files
  reduced to param/guard + one page component,
- **Scheduled calls:** scheduled functions reference functions by path, so a
  pending call to a moved file fails when it fires. Before moving anything:
  list pending scheduled functions, let them finish or cancel them (workspaces
  paused per MIGRATION.md §4.0), and confirm the list is empty. Crons are
  re-registered by the deploy. After T05 no pending call may reference an old
  path — assert it with a query over `_scheduled_functions`. create the empty-of-logic
  folder skeleton only where a file lands in it.
- Update `convex/README.md` and root `README.md` to describe the layout.
One commit per domain moved, so each diff is reviewable as a pure move.
**Done when:** codegen + the four verify commands pass, the app behaves
exactly as before, and `git diff --stat -M` shows renames rather than
rewrites for untouched logic.

### T02 · Credits, caps and breakers — integrator
**Depends:** T05. **Owns:** `convex/lib/limits.ts`, `convex/lib/rateLimits.ts`,
`convex/billing/**`, rate-limiter setup in `convex/convex.config.ts`, trial
grant inside `convex/workspaces/`.
**Build:** PLAN §6 entirely — typed price map and caps; `withCredits` (reserve
credits + worst-case provider units in workspace **and** platform buckets in
one transaction → run → commit actuals → release rest; `uncertain` on unknown
outcome; idempotent by `operationKey`); trial buckets created with the
workspace; one workspace per user; `MAX_TRIAL_WORKSPACES` waitlist state;
`PLATFORM_PAUSED` kill switch; per-user token buckets; public query
`credits.summary` (balance, pending holds, recent usage, no provider names).
The three outcomes of PLAN §6 — refunded / billed / uncertain — are explicit
in the wrapper's return type, and a billed upstream step is never re-bought on
retry (its result is stored and reused).
**Done when:** a scripted run in the Convex dashboard shows: reserve beyond
balance refuses; two concurrent reserves cannot overspend; release refunds;
platform bucket at zero refuses for a second workspace; kill switch refuses
everything; a simulated timeout leaves an `uncertain` hold that the sweep
later commits or releases; a provider answer of "charged 0" refunds in full.

### T03 · AI foundation — integrator
**Depends:** T02. **Owns:** `convex/ai/models.ts`, `convex/ai/run.ts`,
`package.json` (adds `@convex-dev/ai-sdk-provider`, `ai`).
**Build:** `runStructured({ ctx, workspaceId, task, model, system, input, schema, operationKey })`
— truncates input to a fixed character budget, sets `maxOutputTokens`, runs
inside `withCredits` (`ai_calls`), validates the result, maps failures to our
own error codes. No task-specific prompts here.
**Done when:** a smoke internal action returns a validated object from the
gateway and debits exactly one `ai_calls` unit. Failure accounting follows
PLAN §6/§9.1, never a blanket release: refused **before** the request left
(validation, kill switch, budget, rate limit) → refunded; the gateway answered
with an error it reports as unbilled → refunded; the request left and the
outcome is unknown (timeout, dropped connection) → `uncertain`; a completed
generation whose output fails our validation → **billed** (the tokens were
spent) and retried at most once.

### T04 · App shell, routes, theme, rename — integrator
**Depends:** T01. **Refs:** `20-dashboard`, `24-inbox` (collapsed rail).
**Owns:** `src/routes/**` structure, `src/routes/_dashboard.tsx`,
`src/constants/sidebar-menu.ts`, `src/components/Layout/**`, `src/index.css`,
redirects.
**Build:** product rename to **OpenIntent** everywhere user-visible (page
title, logo text, landing copy, emails, `README.md`, `AGENTS.md`; repo name and
Convex deployment stay); route map and guards from PLAN §5; redirects from removed paths;
sidebar (Dashboard, Agent, Contacts, Inbox, Settings) with active pill + accent
bar, collapsible to an icon rail, credits block wired to `credits.summary`,
user menu, header bell with a feed from `activityEvents`; theme tokens toward the reference (warm coral primary, near-white
ground, large radii, soft shadows) using the fonts already installed. Each
route file renders its page header and a **real, query-backed empty state** so
later tasks only fill the body.
**Done when:** every path in PLAN §5 resolves, guards and redirects behave,
nothing in the shell is hard-coded data.

---

### T10 · Inbox connection backend
**Depends:** T02. **Owns:** `convex/lib/secrets.ts`,
`convex/workspaces/secrets.ts`, `convex/integrations/agentmail.ts`,
`convex/inbox/connection.ts`, `convex/inbox/backfill.ts`.
**Hand-off to integrator:** add the `POST /agentmail/webhook/<token>` route in
`convex/http.ts`. **Do not remove** the existing env-secret
`/agentmail/webhook` route: it keeps serving legacy platform inboxes
(PLAN §9.4 "Legacy inboxes", MIGRATION.md §4.1.6), receive-only. Its removal
is a T50 checklist item gated on a query proving no workspace has
`inboxConnection = "legacy_platform_inbox"`.
**Build:** PLAN §4 "Manage inbox" steps 1–7: AES-GCM helper
(`SECRETS_ENCRYPTION_KEY`), connect/verify, list + create inbox, register
webhook on the user's account and store its secret encrypted, per-request
`new AgentMail(components.agentmail, { webhookSecret })` handler function for
the integrator to mount, 30-day thread backfill with progress, send path takes
the decrypted key as an argument, disconnect/rotate, 401 → key `invalid` +
agent paused. All of PLAN §9.4: event accepted only when token → workspace
**and** `inbox_id` = `inboxRef` (else quarantine); inbox ownership claimed in
one read-then-write mutation (Convex has no unique indexes), with the losing
action cleaning up its webhook; `inbox.model.upsertMessage` as the single
writer keyed on `(workspaceId, inboxId, providerMessageId)`; legacy route
behaviour (receive-only, never auto-answered, cannot send); webhook
`client_id` = workspace id so re-connect is idempotent; rotation order with a
10-minute two-secret overlap; backfill and live both upsert on provider
`message_id`; rows tagged `source`; `connectedAt` stamped. Client queries expose `{ status, last4, inboxAddress, lastEventAt, sync }` only.
**Done when:** with a real AgentMail key in the dev deployment: connect
verifies, webhook appears in that account, an email sent to the inbox arrives
in `conversations` through the per-workspace route, a bad signature gets 401,
backfill imports existing threads, disconnect deletes the webhook; connecting
the same inbox from a second workspace is refused; connecting twice creates
one webhook; two connects for the same inbox fired concurrently → exactly one
wins and one webhook remains; a message delivered by both backfill and webhook
at the same moment exists once; the same provider message id under a different
inbox is a different message; a legacy platform inbox still receives mail and
cannot send or auto-reply; an
event for a different `inbox_id` on a valid token is quarantined.

### T11 · Lead-data client
**Depends:** T02. **Owns:** `convex/integrations/enrich.ts`,
`convex/agents/filterOptions.ts`, `convex/billing/platformBalance.ts`.
**Hand-off to integrator:** hourly balance cron + weekly filter-options
refresh in `convex/crons.ts`.
**Build:** thin REST client (header auth, explicit `User-Agent`, envelope
parse, problem-JSON → our error codes, 429 `Retry-After` and 5xx back-off);
`filterOptions`, `count`, `search` (pageSize fixed 25, page ≤ 3), `reveal`
(`fields: ["email"]` hard-coded, ≤ 25 leads, never more than the balance
affords) + `revealJob` poll, `walletBalance`. Every billable call inside
`withCredits`, committing the response's real `creditsUsed`; one
`providerOperations` row per call. Filter builder that accepts only values
present in the cached options. Balance floor trips the platform breaker.
**Done when:** real `count` and `search` return rows at 0 provider credits; an
invalid enum value is rejected before any network call; a reveal of one lead
debits 15 credits / 10 provider units and records the operation.

### T12 · Website scraper
**Depends:** T02. **Owns:** `convex/integrations/firecrawl.ts`,
`convex/lib/urlSafety.ts`.
**Build:** `scrapeSite(url, { pages: 1 | 4 })` — home page, plus up to 3
same-origin links chosen from it (pricing / customers / about) when `pages: 4`.
URL safety: http(s) only, public hostnames only, no IPs / localhost / private
ranges, no credentials in URL. Inside `withCredits` (`scrapes`). Returns
bounded markdown.
**Done when:** a real site returns bounded markdown for 1 and 4 pages;
`http://127.0.0.1`, `http://10.0.0.1`, `file://` and `user:pass@` URLs are
refused without a provider call.

### T13 · UI kit for the reference look
**Depends:** T04. **Refs:** `01`, `02`, `05`, `06`, `07`, `08`, `09`, `10`, `11`, `23`.
**Owns:** `src/components/kit/**`.
**Build:** presentational, data-free components matching the screenshots:
`OnboardingShell` (logo, 4-dot stepper with connecting lines, gradient ground,
card, "Step n of m", Previous / Next footer), `AiGeneratedBadge`, `ChipInput`
(removable outlined chips + dashed Add), `ToggleChipGroup` (uppercase label,
"All …" option), `RadioCard`, `CheckCard` (with info tooltip and a trailing
count slot), `ReviewAccordion`, `FlameScore` (1–3), `StatCard`, `EmptyState`,
`ConnectCard`. Built on the existing shadcn/Base UI primitives and Hugeicons.
**Done when:** each component is used by at least its Storybook-free demo in
the task's hand-off screenshots taken from a real route, and none contains
data of its own.

---

### T20 · Onboarding dot 1 — company
**Depends:** T03, T12, T13. **Refs:** `01-website-empty`, `02-company-profile`.
**Owns:** `convex/ai/analyzeWebsite.ts`, `convex/company/**`,
`src/routes/_dashboard/onboarding.tsx`, `src/components/onboarding/OnboardingPage.tsx`,
`src/components/onboarding/steps/company/**`, `src/components/onboarding/onboarding-model.ts`.
**Build:** website → Analyze (mutation → scheduled scrape → `analyzeWebsite` →
save) with live status, editable profile form (name, industry, description,
key features rows, social proof), "I don't have a website", failure state with
Retry / Fill in manually, first run free and only consumed on success,
Regenerate = 3 credits, step progress persisted (`onboardingStep`). Delete the
old onboarding components this replaces.
**Done when:** a real website fills the form from a real gateway call; refresh
resumes on the same step; the no-website and failure paths work.

### T21 · Onboarding dot 2 — ICP
**Depends:** T20. **Refs:** `06`, `07`, `08`.
**Owns:** `convex/ai/generateIcp.ts`, `convex/agents/icp.ts` (draft agent + ICP
mutations), `src/components/onboarding/steps/icp/**`.
**Build:** three sub-steps — job titles, company filters (industry, location,
company type, company size with "All …"), exclusions (profile checkbox,
competitor/keyword chips). AI-generated on entry, fully editable, saved to the
draft agent.
**Done when:** chips come from a real call on the saved profile and every edit
persists.

### T22 · Onboarding dot 3 + Manage inbox UI
**Depends:** T10, T13. **Refs:** `04-connect-accounts`, `05-goals-tone`, `26-settings-templates`.
**Owns:** `src/components/inbox-connection/**`,
`src/components/onboarding/steps/outreach/**`,
`src/components/settings/InboxTab.tsx`.
**Build:** one shared `InboxConnection` component used by onboarding and
Settings → Inbox: paste key → verify → pick/create inbox → sync progress →
connected state (last 4, address, last event, sync status, Disconnect).
"Connect later" path. Goals: pain points (pre-filled from T21), campaign goal
radio cards, tone radio cards.
**Done when:** the full connect flow runs against a real key from both places;
skipping leaves the agent in Sourcing only mode with the banner
described in PLAN §5.

### T23 · Onboarding dot 4 — signals, keywords, review, confirm
**Depends:** T11, T21. **Refs:** `09-signals`, `10-keywords`, `11-icp-review`.
**Owns:** `convex/ai/recommendStrategies.ts`, `convex/agents/strategies.ts`,
`src/components/onboarding/steps/signals/**` (signals, keywords, review).
**Build:** PLAN §3 pipeline steps 2–5: recommend 3–5 strategies from profile +
ICP + catalogue + cached allowed values; free count per strategy; one
relax/tighten pass; cards with rationale, live count and recommended
pre-checked; keywords with AI suggestions and Generate more; review accordion;
**Confirm & preview leads** → `agents.status = "live"`, `nextRunAt = now`,
redirect to `/contacts` (which shows its real "Finding your first leads…"
state from the agent's run fields).
**Done when:** every card's count is a real count; no strategy with zero
matches is pre-checked; Confirm leaves a live agent with `nextRunAt` due and
redirects. (Leads actually appearing is T30's acceptance.)

---

### T30 · Sourcing and research
**Depends:** T23, T12. **Owns:** `convex/agents/run.ts`, `convex/agents/recovery.ts`,
`convex/agents/sourcing.ts`, `convex/leads/preRank.ts`,
`convex/ai/researchLead.ts`, `convex/leads/research.ts`, source/upsert parts of
`convex/leads/model.ts`. **Hand-off to integrator:** `agent-run` cron.
**Build:** the execution contract of PLAN §9.1 — run lease (single flight),
one-lead-per-step scheduling, `operationKey`s, step retry ladder →
`needs_attention`, the 10-minute recovery sweep, revision fencing helpers used
by later tasks. Then sourcing: per enabled strategy search next free page →
upsert, dedupe on `sourceLeadId`, merge `strategyIds` → free pre-rank →
**initial batch of ~8 across strategies, then `dailyResearchCap` a day**
(PLAN §9.2), reserving credits for approved leads' emails first → research (scrape company home
page → score 1–3, reason, summary, hooks; multi-signal boost) → stage
`researched`. Respects `dailyLeadCap`, credits and caps; records
`leadsFound`, `nextPage`, `lastRunAt`. Queries for Contacts, Agent and
Dashboard counts.
**Done when:** Confirm produces real leads tagged with their signal, ~8 of them
scored and the rest "Not researched yet"; two simultaneous Run now clicks
produce one run; killing an action mid-run is recovered by the sweep without
double-charging; a second run does not duplicate; out-of-credits stops paid
steps cleanly and leaves free ones working.

### T31 · Contacts
**Depends:** T30. **Ref:** `23-contacts`.
**Owns:** `src/routes/_dashboard/_workspace/contacts*.tsx`,
`src/components/contacts/**` (`table/`, `drawer/`, `filters/`),
`convex/leads/queries.ts`, `convex/leads/mutations.ts`, `convex/leads/emailReveal.ts`.
**Build:** search + filters bar, bulk actions (Get emails — bounded by credits, Approve,
Reject), dense table (contact with profile link, signal with "+n signals",
sortable flame score, email state with **Get email** → reveal job + poll,
stage, imported, approval, row menu), page size + "Showing x to y of z", lead
drawer (`?lead=`): research summary, score reason, signals, thread, actions.
Per-row and bulk **Research** (3 credits) for leads not yet
researched. Approve here is **lead approval** (PLAN §9.3): it authorises
finding the email and drafting, not sending. Rejecting cancels that lead's
pending work. Zero-lead state explains which signals returned nothing.
**Done when:** everything is live data; Get email spends 15 credits once and
is idempotent; rows appear while the run is in progress.

### T32 · Agent page
**Depends:** T30. **Ref:** `21-agents` (+ per-signal table from `25-insights`).
**Owns:** `src/routes/_dashboard/_workspace/agent.tsx`, `src/components/agent/**`,
`convex/agents/settings.ts` (mode, instructions, bookingUrl, dealSize, runNow,
strategy toggle — ICP mutations stay in T21's `agents/icp.ts`).
**Build:** agent card with generated editable name, mode dropdown (Sourcing only /
Review / Autopilot / Paused), funnel metrics (Contacted n / total, Replied, Interested; Opened only
when `opensObserved`, per PLAN §9.6), Autopilot consent dialog that records
`agents.autopilot` (PLAN §9.3), needs-attention list with Retry, sender address, created date, signals list with on/off and leads per signal, instructions, booking
link, follow-up days, Run now (rate-limited), "connect inbox" banner.
**Done when:** toggling a signal changes the next run; Run now schedules one
run and is rate-limited; counts match Contacts.

---

### T40 · Outreach
**Depends:** T31, T10. **Owns:** `convex/ai/writeOutreach.ts`,
`convex/outreach/**`. **Hand-off to integrator:** outreach cron.
**Build:** the mode matrix of PLAN §9.3. **Automatic email reveal lives here**:
Review → reveal when the user approves the lead; Autopilot → auto-approve at
`autoApproveMinScore`, reveal up to `autoRevealDailyCap` a day. Autopilot
email approval = an `approvals` row with `actor: "autopilot"` bound to draft +
revision, then the unchanged send ledger. Send-time re-validation and the
invalidation table of PLAN §9.1 (pause, reject, instruction change, reply).
Due leads (researched, lead-approved, email found, not suppressed) → write step 0 with opt-out line → draft → Autopilot
sends, Review waits, Sourcing only never reaches this step for approval → existing ledger (suppression, window, daily
limit, idempotency key) → stage `contacted`, `nextActionAt`. Follow-ups at
`followUpDays` in-thread while no reply.
**Done when:** a real email reaches an address we control in both modes;
suppressed and out-of-window leads are not sent; a follow-up goes out only
with no reply; pausing mid-batch sends nothing further; rejecting a lead with
a queued draft sends nothing; editing instructions supersedes unsent drafts;
Autopilot never turns itself on.

### T41 · Close + Inbox
**Depends:** T40. **Ref:** `24-inbox`.
**Owns:** `convex/ai/handleReply.ts`, `convex/inbox/replies.ts`, the AI seams left in
`convex/inbox/inbound.ts` (search for `AI classify/draft`), `src/routes/_dashboard/_workspace/inbox*.tsx`,
`src/components/inbox/**`.
**Build:** the reply gate of PLAN §9.4 (live, after `connectedAt`, thread we
started, not from us, not handled) before anything else. **Unsubscribe and
bounce handling is rule-based, free and never blocked** by credits, caps or
the kill switch: header / phrase detection → suppression → stop. Only then the
AI path: classify → next move per PLAN §1 / flow.html reply branches (answer,
booking proposal → `meeting_proposed`; **booked only via the user's "Mark as
booked"**, PLAN §9.5; at most 2 automatic replies per thread; not now → reschedule,
not interested → closed lost, unsubscribe → suppression). Autopilot sends,
Review queues. Inbox: list with conversation count, search, Received / Interested / Unread /
All, thread,
suggested reply with edit + send, mark interested, connect-inbox empty state.
**Done when:** a real reply is classified and answered end to end; an
unsubscribe reply blocks all later sends **with the workspace at zero credits
and with the kill switch on**; a backfilled message and a mail in a thread we
did not start are never answered; a reply arriving while a follow-up is queued
cancels it; nothing but the user's click produces `meeting_booked`.

### T42 · Dashboard
**Depends:** T30 (complete after T41). **Ref:** `20-dashboard`.
**Owns:** `src/routes/_dashboard/_workspace/dashboard.tsx`,
`src/components/dashboard/**`, `convex/dashboard/queries.ts`.
**Build:** welcome header with two status chips (active signals → `/agent`, inbox
connection → Settings), range pills (7 days / 30 days / 3 months / This month),
stat cards (hot leads, contacted, conversations, meetings = confirmed
bookings only with proposed shown separately, pipeline = `dealSize` ×
(interested + meetings) with inline Edit), activity chart from real daily counts, latest hot
leads, latest replies, next-step CTA card that reflects real state.
**Done when:** every number reconciles with Contacts and Inbox for the same
range; a new workspace shows designed empty states.

### T43 · Settings
**Depends:** T02, T22. **Ref:** `26-settings-templates`.
**Owns:** `src/routes/_dashboard/settings.tsx`, `src/components/settings/**`
except `InboxTab.tsx`.
**Build:** tabs Company (edit profile, re-analyze), Inbox (mounts T22), Outreach
(default instructions used when the agent has none), Blocklist (emails and
domains, backed by `suppressions`, checked by the send ledger), Sending (days, hours, daily limit ≤ 30), Usage (balance + history from the
real ledger, neutral labels), Account. No billing, no upgrade.
**Done when:** each tab reads and writes real data; Usage never shows a
provider name.

---

### T44 · Org tenancy — integrator (added 2026-09-21, owner decision)
**Depends:** T40 and the Inbox UI half of T41 merged; runs ALONE (it touches
the whole tree). **Owns:** the whole tree, for this task only.
**Build:** the tenant is the Hexclave organization and the org active in
Hexclave is the source of truth (PLAN §4). Rename `workspaces` → `orgs` and
every `workspaceId` → `orgId` (tables, indexes, validators, function args,
frontend), keyed by the Hexclave org id; delete `memberships` and everything
that manages members; the auth guard authorises a request when the token's
`selected_team_id` equals the org row's Hexclave id; the org row is created
silently for the active org on first entry (trial grant + draft agent in the
same mutation, one trial per org); switching org in Hexclave switches the
data; user-visible copy says "organization", never "workspace". No behaviour
change beyond tenancy.
**Done when:** codegen + the four verify commands pass; no `workspace` or
`membership` identifier, table or user-visible string remains (grep); signing
in lands in the active org's data, a second org of the same user sees its own
empty state, and a token whose active org differs from the requested org row
is refused.

### T50 · Polish, audit, ship — integrator
**Build:** loading/error/empty pass on every screen; landing copy for the new
product; audits: `grep -ri` client bundle and `src/` for provider names
(white-label), for hard-coded sample data, for any public action; confirm every
paid call path goes through `withCredits`; structure audit against PLAN §10
(no cross-domain imports, no oversized files, no `utils`/barrels, READMEs true); set production env budgets; **production
cutover per MIGRATION.md §4 after the user says go**; deploy to the production
Convex host; final `hackathon.md` entry.
**Done when:** a fresh signup completes website → leads → email sent → reply
handled on production with real data, and the three audits are clean.

## 3. Prompt template for a task agent

> You are implementing task **T__** of `plan/EXECUTION.md` in this repository,
> in the worktree/branch you were given. Read `plan/PLAN.md`,
> `plan/EXECUTION.md` §0 and your task, `AGENTS.md`, and open the reference
> images named in the task before writing code. Edit only the files under
> *Owns*. Follow every ground rule in §0 — especially no mock data,
> white-label, `withCredits` around every paid call, and the commit rules.
> Finish with the hand-off note described in §0.10.

## 4. Integrator checklist per wave

1. Merge the wave's task branches in dependency order; resolve nothing by
   guessing — send it back.
2. Apply the requested changes to Integrator-only files (http routes, crons,
   sidebar, config).
3. `npx convex codegen` against **dev**, then the four verify commands.
4. Click through the wave's screens next to their reference images.
5. Run the white-label and no-mock greps.
6. Run the wave's **live** acceptance checks handed over by task agents, plus
   the standing manual checks that apply so far:
   - *Migration:* freeze verified by a refused send; a kept suppression is
     refused by a real preflight; restore rehearsed on dev.
   - *Concurrency:* double-click Run now / Get email / Approve → one effect,
     one charge; two simultaneous inbox connects → one owner.
   - *Cancellation accounting:* reject a lead while its email reveal is in
     flight → the reveal is billed at the provider's actual and stored, nothing
     is refunded on the strength of the rejection alone.
   - *Timeouts:* force a provider timeout (bad base URL env on dev) → hold
     shows as pending, sweep resolves it, no double charge, lead ends in
     `needs_attention` with Retry.
   - *Pause:* pause during a run and during a send batch → nothing further is
     sent, drafts survive, resume continues.
   - *Zero credits:* with the balance at 0 — app browsable, free actions work,
     paid buttons explain themselves, inbound mail still lands, unsubscribe
     still suppresses.
   - *Kill switch:* `PLATFORM_PAUSED=true` → no provider call of any kind.
7. One `hackathon.md` entry; tick the tasks below.

## 5. Status

- [x] T00 spikes · [x] T01 schema · [ ] T06 migration · [x] T05 restructure · [ ] T02 credits · [ ] T03 AI · [ ] T04 shell
- [ ] T10 inbox backend · [ ] T11 lead data · [ ] T12 scraper · [ ] T13 UI kit
- [ ] T20 company · [ ] T21 ICP · [ ] T22 inbox + goals · [ ] T23 signals
- [ ] T30 sourcing · [ ] T31 contacts · [ ] T32 agent
- [ ] T40 outreach · [ ] T44 org tenancy · [ ] T41 close + inbox · [ ] T42 dashboard · [ ] T43 settings
- [ ] T50 ship

Merged with all four verify commands passing, **live half still owed** (see
[followups.md](followups.md)) — ticked only when that passes: every task from T06 to T44 (T11's free checks, the token claims, the onboarding guard and the verified-email gate have passed on dev — see followups.md 'Live checks passed'). T50: the landing slice is merged; the review-and-fix pass, the audits and the production cutover are not started.
