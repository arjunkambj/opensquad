# Follow-ups for the final review + fix pass

The owner asked for speed: each task is implement → four verify commands →
merge, with **one** review-and-fix pass at the end (T50). This file is the
running list that pass starts from. Items come from task hand-offs
("unverified", deferred decisions) and from integrator checks. Tick when fixed.

## Decisions waiting on the owner
- [ ] `AGENT_DAILY_LEAD_CAP_DEFAULT = 25` is one search page, so after each signal's first page the agent buys at most one more page a day (the hidden search caps of 6/day and 12/lifetime stay the real guarantee). Raise to ~100 for livelier day-2 paging?
- [ ] `inbox.connection.getInboxConnection` is owner-only, so operators/viewers see a permission note and no "connect inbox" banner. Relax to any member? (one line in `convex/inbox/connection.ts`)
- [ ] Set `SECRETS_ENCRYPTION_KEY` on dev (`npx convex env set SECRETS_ENCRYPTION_KEY "$(openssl rand -base64 32)"`). Nothing in the inbox connect flow works without it; it fails closed with `secrets_unconfigured`.
- [ ] Backfilled threads import identity, sender and timestamps but **no message bodies** (one message store; imported history has no component row). Decide whether imported history needs bodies before the Inbox UI (T41) is judged.
- [ ] Restore rehearsal on dev (T06): no pre-clear export exists. Accept the
      substitute (export current dev → `import --replace` → app runs) or skip.
- [ ] Keep email+password sign-in (the only source of unverified emails), or
      restrict to one-time code + Google. The verified-email guard ships either way.
- [ ] Open tracking: provider supports it only with a custom tracking domain,
      and the installed mail component rejects `message.opened`. Default taken:
      ship without the Opened metric; webhooks subscribe to the 7 safe event types.
- [ ] `/tour` currently redirects to `/` (its old content was prepared sample
      cards). Rebuild as real marketing copy, or drop it from PLAN §5.

## Live checks still owed (need a signed-in owner, a real key, or a call this session may not make)
- [ ] T00.3: people search pages 1–3 cost 0 on this account (balance before/after) + live preview-row shape.
- [ ] T00.4 / T10: AgentMail live shapes and the whole connect flow with a real key.
- [ ] T00.5: one real identity dump showing `emailVerified` reaches Convex.
- [ ] T02: the scripted ledger run (hand-off has the exact `npx convex run` sequence) — needs two real workspaces.
- [ ] T03: `npx convex run ai/health:check '{"workspaceId":"…"}'` happy path, unknown-model refund, billed-and-retried, kill switch, budget, replay — needs a real workspace.
- [ ] T11 (partly done 2026-09-20 on dev, real provider): catalogue refresh → 46 filters / 38 with values ✔; wallet 10,000 ✔; real count 89,731 for the spike's ICP ✔; wrong-case `jobLevel`, the silently-zero `jobFunction: "Marketing"` and an unknown key all refused with no network call ✔; balance watchdog `tripped: false` at floor 300 ✔. **Still owed (need a workspace):** `findLeads … summaryOnly` with the balance unchanged before/after (proves pages 1–3 cost 0), a one-lead reveal debiting 15 credits / 10 provider units, the breaker trip/release via `ENRICH_BALANCE_FLOOR`, and the two crons visible in the dashboard.
- [ ] T10: the whole 18-step connect checklist in the T10 hand-off (connect, one webhook on reconnect, real mail arrives, bad signature/unknown token → 401, foreign `inbox_id` quarantined, backfill, second workspace refused, concurrent connects, backfill+webhook race, legacy route 401 without its secret, 401 at send time, rotate with overlap, disconnect) — needs the owner's real AgentMail key.
- [ ] T22: the connect flow from Settings → Inbox AND onboarding dot 3 with a real key (16 steps in its hand-off: verify, pick/create inbox, sync line, one webhook, inbound proof, rotate same/different account, disconnect, bad key, rate limit, one-inbox-one-workspace, failed import + resume, skip path keeps `sourcing_only`, goals save bumps `revision` only on a real change).
- [ ] T30: a real run (leads tagged with their signal, ~8 researched, the rest not researched), the ledger for that run, two simultaneous `requestRun` → one run, a killed step recovered by `agents/recovery:sweepStalledRuns` without a second scrape charge, a second run not duplicating, out-of-credits and kill-switch stopping paid steps, pause mid-run — exact commands in the T30 hand-off.
- [ ] T21: first ICP generation free then Regenerate = 3 credits, chips from a real call, every edit persists, an out-of-catalogue industry sent to `agents/icp:updateIcp` refused.
- [ ] T20: the eleven click/CLI checks in its hand-off (real site fills the form, refresh resumes, first run free then Regenerate = 3 credits, failure + no-website paths, step gate, finished-user redirect).
- [ ] T12: 1-page and 4-page real scrapes (sizes/titles only), replay with the same key, and the four refused URLs leaving no operation row — exact commands in the T12 hand-off; needs a real workspace.
- [ ] T06: a suppressed address is refused by a real send preflight (fresh workspace); owner signs in and lands in onboarding.
- [ ] T04: shell click-through against refs 20 and 24 (needs an agent with `onboardingStep: "done"` — first writer is T23); sidebar collapse persistence; bell and credits block against real rows; dark mode.
- [ ] T13: visual sign-off of every kit component when T20–T23 mount them; keyboard pass; dark mode.

## Code follow-ups
- [ ] T30 schema asks: `strategies.lastError` (today a provider-level search refusal moves the cursor past the page and ends the run, because a refunded operation key can only replay its refund); a day-keyed counter on the agent (`dailyCounters`) — today "leads researched today" is read from the shared `scrapes` day bucket, which undercounts research on a day the owner re-analyses their site (conservative, never over).
- [ ] T30: activity kinds for the bell (`agent_run_finished`, `credits_low`, and later new reply / meeting booked) do not exist in `lib/validators/activity.ts`; nothing writes run events yet.
- [ ] T30 constants to move into `lib/limits.ts`: run lease/interval, initial research batch 8/10, research stall 15 min, step retry ladder, reveal reconcile delay, lead count bound 100. Files over the size guideline: `leads/model.ts` 393, `agents/runPlan.ts` 364, `leads/researchState.ts` 362, `leads/research.ts` 345, `agents/run.ts` 320.
- [ ] T30: the `researchLead` prompt has never seen a real page — calibrate scores/hooks on the first real run. A lead with no company domain is scored from the preview alone (no scrape, no page charge, no evidence rows).
- [ ] T21: the ICP generator sees a shortlist (120 industries, 7 regions + 60 countries) scored against the profile, not the full catalogue.
- [ ] Integrator: register T22's `ConnectInboxStep` (`outreach_inbox`) and `GoalsStep` (`outreach_goals`) in `ONBOARDING_STEP_REGISTRY` once T21 has merged (both touch that file); mount `InboxConnectionBanner` on Contacts (T31) and Agent (T32).
- [ ] T20: the Analyze/Regenerate button disables on credits only; when the hidden per-workspace cap is what refuses, the run fails with the "no credits" copy. A read-only billing preflight would let the button explain itself up front (PLAN §6: "Trial limit … reached" vs "out of credits").
- [ ] T20: social proof is not marked required (ref 02 stars it) — deliberate, to avoid invented customers; confirm with the owner.
- [ ] T20: a failed Regenerate followed by Retry replays the ORIGINAL pages, not the fresh ones. A run token on `businessProfiles` would fix it.
- [ ] T10 magic numbers to move into `lib/limits.ts`: rotation overlap, backfill window/max threads/attempts/retry/stall/scan, thread page sizes, request timeout, inbox lookup paging, last-event scan, secret max lengths.
- [ ] T10 files above the size guideline: `inbox/backfill.ts` (~730), `integrations/agentmailApi.ts` (707), `inbox/connectActions.ts` (~460), `integrations/agentmail.ts` (1013).
- [ ] T10: `inboxAddress` is reported from `workspaces.inboxRef` on the understanding that the provider's inbox id IS the address; `lastEventAt` is derived from recent conversations, not a webhook-event timestamp; backfill progress lives on a `providerOperations` row. Revisit if any of the three shows wrong in the Manage-inbox UI.
- [ ] T10: the `new Request(...)` re-wrap inside the webhook httpAction has not run in the Convex runtime yet (first real inbound mail proves it).
- [ ] T50 gate: remove the legacy `/agentmail/webhook` route only when a query proves no workspace has `inboxConnection = "legacy_platform_inbox"`.
- [ ] T11: the 49 `martechCategoriesOrg` values are recorded nowhere, so that one filter is refused ("no cached allowed values") until the list is pasted into `CATALOGUE_SEEDS` in `integrations/enrich/catalog.ts`. No PLAN §3 signal needs it.
- [ ] T11: no cron drives `integrations/enrich/revealPoll:reconcileRevealOperation` for `uncertain` `get_email` holds older than the 2-minute poll belt; wire it into the recovery sweep before `commitExpiredHolds` reaches them (T30 owns `agents/recovery.ts`).
- [ ] T02/T11: `reconcilePaidCall` commits an `uncertain` reservation at its worst case and ignores a smaller `actualUnits` (harmless today: a reveal's worst case equals its actual).
- [ ] Document `ENRICH_BALANCE_FLOOR` in `.env.example`; add `enrich/` and `billing/platformBalance.ts` to `convex/README.md`.
- [ ] After T11 merges (it is the only task editing `convex/crons.ts` right now): remove the `provider-operation-sweep` cron and the no-op `integrations/firecrawl.ts#sweepStaleFirecrawlOperations` it targets — T02's `paid-call-park-stale` + `commitExpiredHolds` cover a lost scrape.
- [ ] Scrape budgets live beside the code in `convex/integrations/firecrawlPages.ts` (`SCRAPE_*`) and `URL_MAX_LENGTH` in `lib/urlSafety.ts`; decide whether they move to `lib/limits.ts`. `TRIAL_SCRAPES_LIFETIME_LIMIT` in `limits.ts` is now unreferenced with a stale comment.
- [ ] Validators with no caller after T12: `consumesPageAllowance`, `vRetrievedPage`, `RESEARCH_PAGES_PER_PROSPECT`, `sha256Hex`, `unwrapConvexErrorText` (T30 may still want `vRetrievedPage` for lead evidence).
- [ ] Billed scrapes store a small JSON blob in Convex file storage for replay and nothing deletes it (≤ a few MB per trial). Add a retention sweep once the replay window is decided.
- [ ] `integrations/firecrawl.ts` imports the plain `withCredits` function from `billing/` — deliberate (the money rule wins), but `convex/README.md` says integrations never import a domain; reword the README.
- [ ] Remove `internal.integrations.firecrawl.diagnosticScrapeSite` and `agentmail.ts#diagnosticInboundState` before the public release (both marked TODO(T50)).
- [ ] Rename `convex/ai/schema.ts` (Convex drops any `schema.ts` from the generated API listing; it holds no functions, so nothing breaks, but the name collides with the data schema) → e.g. `ai/strictSchema.ts`.
- [ ] Move T03's constants from `convex/ai/run.ts` into `convex/lib/limits.ts`: `AI_INPUT_CHAR_BUDGET`, `AI_INPUT_TRUNCATION_MARK`, `AI_MAX_OUTPUT_TOKENS`, `AI_MAX_ATTEMPTS` (= the worst-case `ai_calls` reservation), `AI_TRANSPORT_RETRIES`, `AI_REQUEST_TIMEOUT_MS`.
- [ ] Add a `PROVIDER_UNAVAILABLE` error code and point `GATEWAY_UNAVAILABLE` in `convex/ai/failures.ts` at it (currently reuses `PLATFORM_CAPACITY`, which reads as "budget spent").
- [ ] `convex/README.md` layout block has no `ai/` row.
- [ ] Every AI call reserves 2 `ai_calls` and commits 1, so the daily cap of 40 admits 20 in-flight calls; confirm the caps are what we want.
- [ ] If the gateway rejects the nullable form `"type": ["string","null"]` that `strictJsonSchema` emits for optional fields, switch `nullableNode` to `anyOf` (first live `ai/health:check` run will tell).
- [ ] Owner rule (colours only from `src/index.css` tokens): pre-pivot offenders are `src/components/marketing/CompanyMark.tsx` (hex backgrounds AND made-up company names — also a no-mock violation), `marketing/Pricing.tsx` and `auth/SignInForm.tsx` (rgba shadow literals). Everything built since the pivot audits clean. Fix with the T50 landing rewrite.
- [ ] Owner rule (no custom team step): the pre-pivot wizard's "Workspace & policy" step goes with T20; consider storing the auth provider's team id on the workspace and defaulting the workspace name from it.
- [ ] Landing hero still has pre-pivot copy ("AI Sales Squad", "Give it a campaign, Scout finds…") and a Pricing nav link with no page (T50 landing copy).
- [ ] `convex/**` comments still say "OpenSquad" in `inbox/receiptDrain.ts`, `integrations/firecrawl.ts`, `integrations/agentmail.ts`, `lib/auth.ts`, `outreach/sendOutcome.ts` (not user-visible; the T50 grep will hit them).
- [ ] Unused after T04: `src/components/ui/command.tsx`, `ui/kbd.tsx`, deps `cmdk` and `@fontsource-variable/inter`.
- [ ] Two `EmptyState` components: `src/components/states/states.tsx` (pre-pivot) and `src/components/kit/EmptyState.tsx`. Fold into one.
- [ ] `src/components/shared/` was not folded into `kit/` (PLAN §10 has no `shared/`).
- [ ] Backend files above the ~300-line guideline after T05: `outreach/sendOutcome.ts` 401, `inbox/quarantine.ts` 366, `outreach/sendReconcile.ts` 334, `inbox/conversationResume.ts` 331, `lib/validators/shared.ts` 571, `lib/validators/leads.ts` 526; plus `integrations/agentmail.ts` 934 and `integrations/firecrawl.ts` 1016 (rewritten by T10 / T12).
- [ ] The three component-defined shape migrations have no `returns` validator (the migrations component registers them) — the one exception to EXECUTION §0.6.
- [ ] `prospects.searchIndex("search_company_name")` indexes an optional field — accepted by the dev push; confirm search behaves once T30 produces rows.
- [ ] `ChipInput` uses an × remove glyph where ref 06 draws a tick; decide at the wave-2 visual check.
- [ ] Rows remain on dev in tables no longer in the schema (`missions`, `runs`, `decisions`, …): delete from the dashboard.
