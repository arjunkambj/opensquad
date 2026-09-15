# OpenSquad UX Plan — routes, navigation, journeys and build order

Written 15 September 2026 by the integrator, from four parallel read-only
analyses of the running app, the Convex contracts, the V01–V24 acceptance
scenarios, and one reference product in the same category.

Scope: this document owns information architecture, URLs, screen states, flows
and build sequencing. It deliberately contains no colours, spacing or
typography — visual design is the owner's.

On citations: symbol names (`missions.listBoard`, `decisions.listOpen`,
`conversationFields.prospectId`) are authoritative and stable. Line numbers were
taken against commit `a986aa7` and will drift; trust the name, not the number.
`convex/schema.ts` and `convex/lib/validators.ts` in particular moved during the
P20 review pass after most of these citations were written.

The §4.3 `prospects`, `leadEvents`, `bookings` and `evidence` tables and all
their indexes DO now exist (P20, commit `a986aa7`), so P19 is behaviour on a
settled schema rather than schema-plus-behaviour, and `/leads` is closer than it
looks. What does not exist is any of `convex/prospects.ts`,
`convex/leadEvents.ts`, `convex/bookings.ts` or `convex/conversations.ts`.

---

## 1. WHERE WE ARE

A signed-in user can create a workspace, complete a four-step onboarding wizard, edit three employees' instructions, and connect the runtime from Settings — and nothing else, because the frontend imports only `workspaces`, `businessProfiles`, `campaigns`, `employees`, `runtimeConnections` and `runtimeControlRequests`; `api.missions`, `api.decisions`, `api.drafts`, `api.approvals`, `api.sendAttempts`, `api.sending`, `api.activity`, `api.suppressions` and `api.usage` are never imported anywhere under `src/`. The signed-in home `/overview` renders one card containing the hardcoded string `"No activity in this range yet."` (`src/components/overview/OverviewDashboard.tsx:59-61`) above a date picker that filters nothing, because the component issues no `useQuery` at all. Nothing routes a workspace-less user into setup — `src/hexclave/client.ts:8-9` sends every sign-in to `/overview`, and `/overview`, `/employees` and `/settings` each independently dead-end on their own copy of the same "No workspace yet" card (`SetupBanner.tsx:26-55`, `EmployeesView.tsx:47-55`, `SettingsSections.tsx:30-38`). Any unmatched path — including `/leads`, which `plan/architecture.md:421` names as the CRM home — hits the root's `notFoundComponent` (`src/routes/__root.tsx:11, 41-52`), which renders a full-page card *outside* the dashboard shell, so the user loses the entire sidebar. Meanwhile the approval/send/reply/uncertainty backend is complete and authorized (`approvals.approve` at `convex/approvals.ts:286`, `decisions.listOpen` at `convex/decisions.ts:484`, `missions.listBoard` at `convex/missions.ts:358`, `sending.resolveDeliveryUncertainty` at `convex/sending.ts:2535`) and is unreachable from any screen.

---

## 2. THE ROUTE MAP

Convention settled here and used throughout: **a record gets a path segment; a view mode of one screen gets a search param.** A record has an id, is linkable, is the unit of two-session work (V09 `plan/verification.md:86-92`, V13 `:120-126`). A view mode has no identity and costs a route file we cannot afford this week.

| Path | File | Purpose | Search params | Backed by | Status | Task |
|---|---|---|---|---|---|---|
| `/` | `src/routes/_marketing/index.tsx` | Public pitch: the supervised sales loop, the approval screen as the proof, honest limits, judge path | — | none (must not query workspace data) | rewrite | P13 §5 |
| `/sign-in` | `src/routes/sign-in.tsx` | Hexclave sign-in | `redirect?: string` (pathname+search to return to) | Hexclave `useUser()` | exists; `:25-26` hard-codes `/overview` and drops deep links | P13 §4 |
| `/handler/$` | `src/routes/handler.$.tsx` | Hexclave auth callback | — | Hexclave | exists | — |
| `/onboarding` | `src/routes/_dashboard/onboarding.tsx` | Five-screen setup: provision → business → policy → campaign → confirm | `step: "provision"\|"business"\|"workspace"\|"campaign"\|"review"` (default derived from saved data, **not** a constant) | `workspaces.ensureWorkspace/update/setSendingPolicy/setAutomationState`, `businessProfiles.get/update`, `campaigns.create/confirmSourcePlan`, `employees.list` | exists; step is `useState` at `OnboardingWizard.tsx:126` | P12 (route mechanics) |
| `/overview` | `src/routes/_dashboard/overview.tsx` → becomes layout; board body to `overview/index.tsx` | Mission Control: four-column board, needs-you count, New mission, dated receipts | `campaign?: Id<"campaigns">`, `column?: "backlog"\|"needs_you"\|"in_flight"\|"done"`, `archived: boolean = false`, `range = "today"`, `from?: number`, `to?: number` | `missions.listBoard` (`convex/missions.ts:358`), `missions.create` (`:124`), `decisions.listOpen` (`convex/decisions.ts:484`), `activity.list` (`convex/activity.ts:135`), `campaigns.list`, `runtimeConnections.getStatus` (`convex/runtimeConnections.ts:81`), `usage.summary` (`convex/usage.ts:68`) | exists, empty | P12 §1-2 |
| `/overview/missions/$missionId` | `src/routes/_dashboard/overview/missions.$missionId.tsx` | Reloadable mission detail | `tab: "summary"\|"prospects"\|"decisions"\|"receipts"\|"comments"` + inherits all board params | `missions.get` (`:319`), `decisions.listForMission` (`convex/decisions.ts:527`), `activity.listRuns` (`convex/activity.ts:194`), `activity.addComment/listComments`, `drafts.listForMission`, `runs.get`, `missions.pause/resume/cancel/archive/restore` | new | P12 §3 |
| `/decisions` | `src/routes/_dashboard/decisions.tsx` (layout) + `decisions/index.tsx` | The one shared queue of everything needing a human | `mission?: Id<"missions">`, `cursor?: string` | `decisions.listOpen` (`convex/decisions.ts:484`) | new | P13 §3 |
| `/decisions/$decisionId` | `src/routes/_dashboard/decisions/$decisionId.tsx` | The exact draft or ask + approve / request changes / reject | inherits `mission`, `cursor` | `decisions.get` (`:559`), `decisions.resolve` (`:723`), `drafts.get` (`convex/drafts.ts:329`), `drafts.revise` (`:418`), `approvals.approve/requestChanges/reject` (`convex/approvals.ts:286/333/366`), `sending.preflight` (`convex/sending.ts:2859`), `sendAttempts.listForDraft` (`convex/sendAttempts.ts:71`), `suppressions.check` (`convex/suppressions.ts:142`) | new | P13 §3 |
| `/leads` | `src/routes/_dashboard/leads.tsx` (layout) + `leads/index.tsx` | CRM home: every lead with owner, stage, evidence, next action | `mode: "pipeline"\|"due" = "pipeline"`, `stage?`, `campaign?`, `owner?`, `due: "overdue"\|"today"\|"next_7d"\|"next_30d"\|"unscheduled" = "overdue"`, `q?`, `cursor?`, `limit: 25\|50 = 25` | **GAP** — `prospects.list`, `prospects.search` do not exist (no `convex/prospects.ts`). Tables and indexes DO exist (`convex/schema.ts:1152-1194`). Filter options from `campaigns.list`, `workspaces.listMembers` | new | P19 §1 (queries) → P13 §1 (UI) |
| `/leads/$prospectId` | `src/routes/_dashboard/leads/$prospectId.tsx` | One lead: ownership, stage+reason, evidence, conversation, booking, next action | `tab: "overview"\|"evidence"\|"activity"\|"conversation"\|"booking"` + inherits every list param | **GAP** — `prospects.getDetail`, `leadEvents` list, `bookings.get` (P19 §1-3). Exists today: `drafts.listForConversation`, `sendAttempts.listForConversation`, `approvals.listForDraft` | new | P19 → P13 §1-2 |
| `/prospects` | `src/routes/_dashboard/prospects.tsx` | Compatibility redirect → `/leads` | — | — | new (4 lines; copy `squads.tsx:8`) | P13 §4 |
| `/inbox` | `src/routes/_dashboard/inbox.tsx` (layout) + `inbox/index.tsx` | Shared workspace inbox | `tab: "open"\|"unassigned"\|"takeover"\|"closed" = "open"`, `cursor?`, `limit: 25\|50 = 25` | **GAP** — no `convex/conversations.ts` exists. Table + both indexes exist (`convex/schema.ts:1226-1240`). Exists today: `drafts.listForConversation` (`convex/drafts.ts:345`), `sendAttempts.listForConversation` (`convex/sendAttempts.ts:93`) | new | P11 §4 → P13 §3 |
| `/inbox/$conversationId` | `src/routes/_dashboard/inbox/$conversationId.tsx` | One thread, takeover, lead association | inherits `tab`, `cursor`, `limit` | **GAP** — `conversations.get`, message history, `associateProspect`, takeover/resume/close (P11 §1, §4). Exists: `sendAttempts.listReceipts` (`:136`), `suppressions.check` | new | P11 → P13 §3 |
| `/employees` | `src/routes/_dashboard/employees.tsx` | Scout / Researcher / Outreach roster + instruction editor | — | `employees.list` (`convex/employees.ts:26`), `employees.update` (`:62`), `runtimeConnections.getStatus` (`:81`) | exists | P13 §4 |
| `/settings` | `src/routes/_dashboard/settings.tsx` | All workspace configuration, one route, deep-linkable sections | `section: "account"\|"workspace"\|"sending"\|"automation"\|"members"\|"runtime"\|"integrations" = "workspace"` | `workspaces.get/update/setSendingPolicy/setAutomationState/listMembers/setMemberRole/revokeMembership`, `suppressions.list/add/remove` (`convex/suppressions.ts:111/180/200`), `runtimeConnections.*`, `runtimeControlRequests.*`, `usage.summary`. **GAP**: no `providerConnections` query exists for the Integrations section | exists, needs `validateSearch` | P13 §4 |
| `/squads` | `src/routes/_dashboard/squads.tsx` | Legacy redirect → `/employees` | — | — | correct already (`:8`) | done |
| `/$` (dashboard splat) | `src/routes/_dashboard/$.tsx` | In-shell not-found | — | — | **new, and the highest-value 20 lines in this document** | new integrator work |

### Changes this makes to the §10 contract (amend `plan/architecture.md:417-438` deliberately)

1. **ADD `/decisions` and `/decisions/$decisionId`.** §10:426 names `src/components/decisions/` and §10:434 lists Decisions in the sidebar, but no route file is named anywhere. `decisions.listOpen` is workspace-wide with `missionId` optional (`convex/decisions.ts:484-489`) — the backend already models a cross-mission queue. V13 step 2 (`plan/verification.md:122`) requires opening *the same draft in two sessions*, which needs a stable URL, not a panel.
2. **ADD `/inbox` and `/inbox/$conversationId`.** Same situation: §10:430 names `src/components/inbox/`, §10:434 names the nav item, no path is specified. P13 §3 (`plan/tasks.md:483`) says "add inbox list filters, thread history…" without naming a route.
3. **CHANGE OF ROLE, NOT OF URL — `overview.tsx` becomes a layout** with the board at `overview/index.tsx` and detail at `overview/missions.$missionId.tsx`. §10:423 says "retain existing URL" — `/overview` is retained exactly. Justification: §10:438 requires mission detail to be reloadable *and* to "Preserve board filters when closing it". Nesting satisfies both by construction — the board's `?campaign` is still in the URL while detail is open, so closing is `navigate({ to: "..", search: (prev) => prev })` and there is no filter state that *can* be lost. It also lets the parent render list-beside-detail at wide viewports without a second layout. The repo already proves the pattern: `src/routes/_dashboard.tsx` is a layout for `src/routes/_dashboard/`.
4. **SAME FOR `leads.tsx`, `decisions.tsx`, `inbox.tsx`.** Each becomes a layout with an `index` child. §10:421 names `leads.tsx` and it keeps its name and URL.
5. **ADD `?section=` to `/settings`, and NOT seven sub-routes.** Lane B proposed splitting Settings into seven files; that is rejected. §10:432 gives `settings.tsx` one responsibility line, `SettingsSections.tsx` already stacks the sections, and the only real requirement is a deep link — a `connection_required` decision (`vDecisionKind`, `convex/lib/validators.ts:691-696`) must link to the runtime controls, and a window-blocked send must link to sending policy. `?section=` delivers that for one `validateSearch` instead of seven route files, which matters with seven days left.
6. **Mission detail path is `/overview/missions/$missionId`, not `/missions/$missionId`.** Lanes B and C disagreed. Nesting is what makes §10:438's filter preservation automatic rather than hand-maintained.
7. **Lead detail param is `$prospectId`, not `$leadId`.** `plan/README.md:104` — "Keep `prospects` as the underlying lead table" — and the Convex type is `Id<"prospects">`. The *URL noun* stays `/leads` per §10:421; only the param matches the table.
8. **ADD `/prospects` as a redirect.** §10:422 lists it as optional; take the option — it costs four lines and permanently forecloses a second CRM.
9. **ADD `?step=` to `/onboarding`.** No new URL or file. Listed because it changes observable behaviour: today a reload on step 3 restarts at step 1 (`OnboardingWizard.tsx:126`).
10. **NEW BEHAVIOUR: a workspace gate and an in-shell not-found on `_dashboard`.** §10 does not discuss guards or boundaries; both are additions. Note for the integrator: a `beforeLoad` redirect is **not** available — `src/main.tsx:12` is `createRouter({ routeTree })` with no `context`, so no Convex client is reachable from a loader. The gate must be a layout component that reads `useCurrentWorkspace()` and renders `<Navigate>`.
11. **Sidebar order: §10:434 and `plan/README.md:103` disagree** (README puts Mission Control before Decisions; §10 puts Decisions before Mission Control). This document follows §10:434. Amend README:103 to match, or say which wins.

### Backend contract additions this map requires, each with its owner

- **(a) `missions.listBoard` needs an optional `visibility` argument.** Both index branches pin `.eq("visibility", "visible")` (`convex/missions.ts:379` and `:392`) and the query takes no visibility arg, so `missions.restore` (`:634`) is unreachable from any UI and V09 step 3's "archive and restore a completed mission" (`plan/verification.md:90`) **cannot pass today**. — **P12**.
- **(b) `decisions.listOpen` pins state to `"open"` in its handler and has no `kind` filter.** Resolved-decision history needs an optional state arg; a kind filter needs a new `by_workspaceId_and_state_and_kind_and_createdAt` index. Until then the UI must not offer either control. — **P13**.
- **(c) No conversation list/get query exists at all.** — **P11 §4**.
- **(d) No runs-by-employee query exists** though `runs.by_employeeId_and_state` does; `activity.listRuns` requires a `missionId`. Without it, employee cards must say "status unavailable" rather than animate. — **P12**.
- **(e) No `providerConnections` query exists**, so the Integrations section stays honestly static. — **P13 §4**; P04 is `"blocked"` in `plan/tasks.json:137`.
- **(f) The entire `prospects`/`leadEvents`/`bookings` behaviour layer.** Tables exist; functions do not. — **P19**.

---

## 3. NAVIGATION AND SHELL

**Sidebar, in order** (per `plan/architecture.md:434`; add each item *in the same commit as its route*, never before):

1. **Work band** — Leads `/leads` · Inbox `/inbox` · Decisions `/decisions` · Mission Control `/overview`
2. **Workspace band** — Employees `/employees`
3. **Footer** — workspace name as an identity label, then Settings `/settings`

**Live badges and what feeds them.** Only two, and only when their query ships:
- **Decisions** — count from `decisions.listOpen` (`convex/decisions.ts:484`), rendered as `50+` when `hasMore` is true, per `plan/architecture.md:259` ("Avoid exact unlimited counters; expose bounded counts with '50+'"). This is the single most useful number the nav can carry: the whole thesis is that a human approves every word.
- **Inbox** — unassigned + takeover thread count, from P11's conversation list. **Do not badge Inbox with a number until that query exists** — today it would be fabricated.
- **Nothing else gets a badge.** The home attention block and the sidebar badge must derive from the *same* query call; two different numbers for one thing is a defect.

**Workspace identity.** Put the workspace name at the top of the sidebar as a section label (`workspaces.getCurrent` already returns it and three components already hold it). **No workspace switcher** — `getCurrent` returns at most one membership, so a switcher over a set of one is noise.

**Two nav bugs to fix while you are in the file.**
- `src/components/Layout/AppSidebar.tsx:73` is `pathname === item.href`. The moment child routes exist, `/leads/abc`, `/settings?section=sending` and `/overview/missions/xyz` all leave their item unhighlighted. Change to a segment-boundary prefix match so `/leads` matches `/leads` and `/leads/$id` but never a future `/leads-archive`.
- `AppSidebar.tsx:48` adds a fourth palette group also headed `"Workspace"`, and `:155` keys each group by `group.heading ?? "main"` — two siblings get the key `"Workspace"`. That is the duplicate-key warning, and the user-visible half is worse: the palette shows "Workspace" twice, once containing Employees and once containing Settings. Give each group a stable `id` distinct from its heading and key on the id; with six destinations the headings should be "Go to" and "Account", not two identical ones.
- `src/constants/sidebar-menu.ts:8` types `MenuHref` as a closed union of three paths. Every new route must be added there or the typed `Link` will not compile — keep that union as the single enforcement point rather than hand-writing hrefs in components.

**Top bar.** Today it is `SidebarTrigger` + avatar (`DashboardHeader.tsx:9-14`). Add exactly one thing: the command-palette trigger, so it is reachable without knowing ⌘K exists. Do not build the reference's numeric-badge cluster — the sidebar already carries the counts and two places for one number will drift.

**Command palette's job.** Today it is a three-item static link list labelled "Search" (`AppSidebar.tsx:108-120, 42-49`); the dialog's own description, "Jump to a page in OpenSquad" (`:143`), is the accurate one. Two moves: (1) **rename the trigger to "Jump to" now**, so the label stops promising search; (2) when `prospects.search` lands (P19 §1, backed by `search_company_name` at `convex/schema.ts:1188-1194`), make it search leads by company name and jump to `/leads/$prospectId`, with typed result groups (Leads / Missions / Decisions / Go to) and the nav destinations as the zero-query state. That is the highest-value command palette in a CRM and needs no backend beyond P19's existing deliverable. Also: both global shortcuts (`AppSidebar.tsx:59-71` for ⌘K, `src/components/ui/sidebar.tsx:96-109` for ⌘B) `preventDefault()` on any keydown regardless of focus — including while typing in the employee instructions textarea or a campaign brief. Guard both on `event.target` not being an input, textarea or contenteditable.

**Phone width.** Three compounding defects, all in the loading path:
- `src/components/Layout/DashboardLoadingSkeleton.tsx:6` gives the sidebar column `hidden … md:flex`, and `:17` renders the trigger slot as a plain grey square — so at 375px the Suspense fallback has **no navigation affordance at all**.
- `src/routes/_dashboard.tsx:13` wraps the *entire* shell in one Suspense boundary, and what suspends is `useUser({ or: "redirect" })` at `:20`, a cookie-backed token exchange. Nothing renders until auth resolves. **Fix structurally**: render the chrome outside the boundary and suspend only the content region — `AppSidebar` takes no props and does not depend on the user object; only `DashboardHeader` does.
- `src/hooks/use-mobile.ts:6,18` initialises `isMobile` to `undefined` and returns `false` on first render, so `ui/sidebar.tsx:181` takes the desktop branch and a phone gets no sidebar markup until an effect runs. Seed from `window.matchMedia(...).matches` during initialisation.
- Also replace `src/main.tsx:22`'s unstyled `<div>Loading...</div>` with the same skeleton, and drop `overflow-hidden` from `SidebarInset` (`DashboardShell.tsx:19`) — it silently truncates anything wider than the column, which is exactly what a four-column board and a lead table will be. Let each wide component own its own scroll container, as `ui/table.tsx:7-11` already does.
- To correct the brief: a mobile trigger **does** exist once loaded (`DashboardHeader.tsx:10` → the Sheet branch at `ui/sidebar.tsx:181-205`). The gap is the skeleton, not the loaded shell.

**What must NOT be in the nav until its route exists.** Leads, Inbox and Decisions — `sidebar-menu.ts:29-30` already comments this correctly; keep that discipline. **Scheduled** — `plan/architecture.md:434` says "Scheduled only when implemented" and P15 is `"pending"` (`plan/tasks.json:563`) and optional (`plan/README.md:115`); there is no cross-mission runs query to back it. **Docs** — `plan/README.md:106`, "no general document editor".

---

## 4. THE SIX JOURNEYS

### J1 — First run: sign-in to a mission that is actually running

| # | Screen | Step |
|---|---|---|
| 1 | `/` | Learn what this is: Scout discovers, Researcher cites, Outreach drafts, a human approves the exact words, AgentMail sends. One primary action. |
| 2 | `/sign-in` | Sign in. |
| 3 | *(no screen)* | Destination is derived from `workspaces.getCurrent`: `null` → `/onboarding`; workspace with `automationState === "paused" && pauseReason === "onboarding_pending"` → `/onboarding` at the first unfinished step; otherwise → `/overview` (→ `/leads` after P13 §4). |
| 4 | `/onboarding?step=provision` | Create workspace — **rendered inside the same step rail as every later step**. |
| 5 | `?step=business` | Website, offer, ideal customer, tone, exclusions. The screen states that this text is what Researcher reasons from and that it is versioned — later edits do not rewrite evidence already produced (`inputSnapshot`, §4.2). |
| 6 | `?step=workspace` | Timezone + send window. The screen states that timezone decides the send window and every due date, and that changing it bumps `policyVersion`. |
| 7 | `?step=campaign` | Source plan, lead limit capped 1–5, enrichment allowance. Unavailable sources render **disabled with the reason**, never hidden. |
| 8 | `?step=review` | The interpreted source plan beside the original instruction, then one explicit confirm. |
| 9 | `/settings?section=runtime` | Connect the runtime and complete Codex login. **This is the real finish line** and the completion screen must link here. |
| 10 | `/overview` | New mission → `missions.create` (`convex/missions.ts:124`). |
| 11 | `/overview` → `/leads` | The mission appears in Backlog, then In flight. Once discovery lands, home is the lead list. |

**Design rules (testable).** ① The post-sign-in destination is a function of `workspaces.getCurrent`, never a constant — `src/hexclave/client.ts:8-9` and `src/routes/sign-in.tsx:25-26` are the two places that violate this today. ② The step is in the URL and the initial step is derived from persisted state (`businessProfiles.get` is already queried at `OnboardingWizard.tsx:123-125`; `workspace.policyVersion`/`sendWindow` reveal whether step 2 saved), so reload resumes and Back works. ③ The step rail renders on **every** screen including provisioning — today `OnboardingWizard.tsx:61-62` returns early into a single card before the rail at `:187` ever renders. ④ No screen shows "No workspace yet" as a terminal card; a workspace-less user is redirected. ⑤ The completion screen links to the next *blocking* action, not to a tour of empty pages. ⑥ Copy never says a run will happen "soon" — `OnboardingWizard.tsx:153-157` currently does. ⑦ While the wizard holds unsaved form state (`CampaignStep.tsx:25-30` documents that the campaign step persists nothing until review), either persist per-step or give the route an explicit unsaved-changes affordance — the sidebar is one click away and discards it silently.

### J2 — Daily triage: the morning open

| # | Screen | Step |
|---|---|---|
| 1 | home (`/overview`, later `/leads`) | **One attention block, first on the page**: open required decisions, unassigned/takeover conversations, overdue next actions. Three counts, three links. |
| 2 | home | Then the work itself — the lead pipeline, with the operator's overdue actions one click away via `?mode=due`. |
| 3 | `/decisions` | The queue, grouped by mission. Each row renders by its `kind` — an approval shows the exact draft, a `connection_required` shows a reconnect action, a `delivery_uncertain` shows reconciliation. **Never an Approve button on a non-approval.** |
| 4 | `/inbox?tab=unassigned` | Replies that could not be matched to a lead, held under takeover. |
| 5 | `/overview` | *Then* the board, to understand what the squad is doing. |

**Design rules.** ① A zero count renders as an explicit zero, never a hidden element — the operator must distinguish "nothing needs me" from "this did not load" (V11, `plan/verification.md:108`). ② Every count is a link landing on a pre-filtered list, with the filter in the URL. ③ **No date filter touches unfinished work** — `plan/architecture.md:259`: "Do not hide old active missions by applying the Overview date filter to the board. Use date ranges only on activity and run history." The date picker moves from the top of the page onto the activity/receipts section. ④ Sidebar badges and home counts call the same query. ⑤ The board is reachable from home but is not home (`plan/README.md:103`). ⑥ The attention block is a **component**, not a page section — P12 ships it on `/overview`, P13 moves it to `/leads` unchanged.

### J3 — Approve and send: the exact-content contract

| # | Screen | Step |
|---|---|---|
| 1 | `/decisions` | The ask appears with its mission and lead. |
| 2 | `/decisions/$decisionId` | The **exact** recipient, subject and body from `drafts.get`, with revision number and a short `payloadHash` fingerprint. Alongside: `evidenceIds` as links, the brief version and policy version it was built on, the lead. |
| 3 | same | Three distinct actions → three distinct mutations: Approve (`convex/approvals.ts:286`), Request changes with a required comment (`:333`), Reject with a required reason (`:366`). |
| 4 | same | Edit draft → `drafts.revise` (`convex/drafts.ts:418`) with `expectedRevision`. **The consequence is stated on the affordance before the reviewer types**: editing withdraws approval and opens a fresh ask on the new text. |
| 5 | same | If another session revises, or a reply advances `contextVersion`, the view flips to an explicit superseded state naming what changed, with one action to load the current revision. The stale Approve control is **disabled**, not left to fail. |
| 6 | same | Approval schedules `internal.sending.sendApprovedDraft`, which re-runs every preflight gate. The screen shows the real `sendAttempts` state: reserved → requesting → acknowledged, or uncertain / definitively_failed. |
| 7 | same | Deferred by window or daily budget → say when it will be attempted, in the workspace timezone, and that every check re-runs then (`sending.preflight` at `convex/sending.ts:2859` returns `{permitted, code, reason, nextPermittedAt, attempts}` — exactly this data). |

**Design rules.** ① The bytes displayed are the bytes that will be sent; revision and hash fingerprint are visible. ② Approve carries `expectedVersion` and a client `requestId`. ③ **A comment can never be styled or positioned as an approval action** — `plan/architecture.md` §4.2: comments cannot resolve an approval decision. Place `activity.addComment` (`convex/activity.ts:230`) visually outside the approve/reject group, labelled "Leave a note for the squad". ④ **No optimistic "Sent".** Label an acknowledged message "Sent", never "Delivered" — `vSendAttemptState` (`convex/lib/validators.ts:1965`) says in its own comment that `acknowledged` means the provider accepted it. ⑤ A `CONFLICT` re-renders the decision in place naming the current revision; it never becomes a toast that loses the reviewer's place. ⑥ Approval history shows actor, verdict, reason where required, revision and time; superseded revisions stay readable (V13 pass, `plan/verification.md:126`).

### J4 — A reply arrives: classification, takeover, unassigned, opt-out

| # | Screen | Step |
|---|---|---|
| 1 | `/inbox` | Thread list with tabs `open` / `unassigned` / `takeover` / `closed` — **the only index-backed slices** (`by_workspaceId_and_state_and_lastMessageAt` and `by_workspaceId_and_humanTakeover_and_lastMessageAt`, `convex/schema.ts:1227-1240`). Row = lead, assigned employee, classification tag, "Draft ready" when `currentDraftId` is set. |
| 2 | `/inbox/$conversationId` | Thread composed from immutable `drafts` + `sendAttempts` plus component-held inbound messages — §4.3 forbids a second messages table. Each outbound message labelled with its real state; a pending draft labelled **Draft**. |
| 3 | same | Classification rendered as a model label with its rationale and actor attribution, always human-overridable. |
| 4 | same | Takeover toggle (freezes automation) and a **separate** explicit Resume. The screen states takeover stops new drafts and sends and **cannot recall mail already submitted**. |
| 5 | `/inbox?tab=unassigned` | Unmatched valid mail, no guessed lead, no proposed draft. Associate to an existing same-workspace lead — and the screen says **before the click** that associating dispatches nothing; Resume is separate (V16 step 3). |
| 6 | `/settings?section=sending` | An explicit unsubscribe shows as an enforced suppression with its reason and normalized value; an ambiguous opt-out shows as paused-for-review, not resolved by the classifier. |

**Design rules.** ① One shared workspace inbox — per-employee inboxes are deferred (`plan/README.md:113`). ② **Unread is a badge and a sort order, not a tab** — `conversations.unreadCount` has no index. This deliberately rejects the reference's All/Received/Sent/Unread tabs. ③ A pending draft is never rendered in the position or style of a sent message. ④ The pending draft links to its `/decisions/$decisionId` rather than duplicating approve buttons in two places — §10:426 mandates "One shared decision queue and exact approval detail used by board/sidebar/inbox". ⑤ Message bodies render as sanitized text: no raw HTML injection, no remote tracking-image loads (P13 §3, `plan/tasks.md:484-486`). ⑥ When an inbound reply supersedes an open approval, the superseded state is visible on both the queue and any open draft screen.

### J5 — Booking: proposal to a human-confirmed meeting

| # | Screen | Step |
|---|---|---|
| 1 | `/leads/$prospectId?tab=booking` | Propose: the configured booking link **or** at most three future intervals with an IANA timezone (`vBookingProposal`). The form states it creates a proposal record and an email draft, nothing more. |
| 2 | `/decisions/$decisionId` | The proposal email re-enters J3. Only acceptance of that linked exact draft advances the lead to `booking_proposed`. |
| 3 | `?tab=booking` | State reads **Proposed**. The screen says plainly that a proposed time, a clicked link and a model reading "Tuesday works" are all *not* a confirmed meeting (V24 step 2, `plan/verification.md:230`). |
| 4 | same | An authorized human records the agreed meeting: start, end, IANA timezone, and a short stated basis with an evidence reference. `confirmationSource` is `manual` — `bookingFields` requires all of this once state is `confirmed` (`convex/schema.ts:680-690`). |
| 5 | same | Both the entered local time **and** its resolved UTC instant are shown before saving; an invalid or ambiguous DST local time is disambiguated by the human, never silently coerced. |
| 6 | same | Confirmation advances the lead to `booked`, links the booking, sets the next action, appends to `leadEvents`. **No wording implies a calendar event exists.** |
| 7 | same | Reschedule = a fresh approval flow that does *not* change the confirmed meeting; only a human recording a newly agreed time reschedules it. Cancel requires a reason and a chosen follow-up stage. No-show / completed are explicit and never become won or lost. |
| 8 | `/leads?mode=due` | The resulting next action appears with its due date in the displayed timezone. |

**Design rules.** ① Proposed and Confirmed are textually distinct at a glance. ② No element implies a calendar event was created or availability checked — `externalEventRef` is stored only when a real provider event exists and `confirmationSource: provider` stays unavailable (`convex/schema.ts:685-688`). ③ The confirm form cannot submit with start, end, timezone or basis missing. ④ A cancelled-only lead never still reads Booked. ⑤ Booking does not imply won — `won`/`lost` are `TERMINAL_SALES_STAGES` and remain separate explicit decisions with a reason (`convex/lib/validators.ts:2500`). ⑥ Every prior agreed time and reason stays readable after reschedule or cancellation; `leadEvents` rows are append-only and preserve `fromStage` (`convex/schema.ts:648-660`).

### J6 — Something broke

| # | Screen | Step |
|---|---|---|
| 1 | home + `/decisions` | Every failure arrives in the same place. The operator does not need to know which subsystem broke to find it — `vDecisionKind` already distinguishes `connection_required` and `delivery_uncertain` from `draft_approval`. |
| 2 | `/decisions/$decisionId` | **Delivery uncertain**: resend is blocked. The screen explains the request may have reached the provider, the outcome is unknown, and no local action can determine it. |
| 3 | same | The first offered action is **reconciliation** (`sending.requestReconciliation`, `convex/sending.ts:2487`). Only if that cannot prove acceptance or non-acceptance does the replacement path appear. |
| 4 | same | The replacement path is deliberately heavy: `sending.resolveDeliveryUncertainty` (`:2535`) requires `decisionId`, `expectedVersion`, a reason and an explicit `acknowledgeDuplicate` flag. **That acknowledgement is a visible control with its consequence spelled out, never a default.** |
| 5 | `/overview` → `/settings?section=runtime` | **Runtime disconnected**: the mission sits in Needs you with a *connection* badge, explicitly not a "review draft" ask. The card links to the runtime section. |
| 6 | anywhere | **Stale liveness**: `getStatus().live` is `state === "ready" && freshHeartbeat` (`convex/runtimeConnections.ts:100-106`). Any working indicator is driven by that flag and visibly degrades; an animation that keeps running is a lie. |
| 7 | `/overview/missions/$missionId` | **Failed mission**: terminal technical error + run receipt. Its only transition is Archive (`missions.archive` accepts `completed`, `cancelled` or `failed` — `convex/missions.ts:579-608`). **There is no retry flow**; `MISSION_TRANSITIONS` documents that `failed` may only leave via the archive path. Do not offer a Retry button. |
| 8 | any form | **Version conflict**: a `CONFLICT` renders as a readable state naming the current version with a load-current action, preserving typed input. |

**Design rules.** ① Dashboard 404 and error boundaries render **inside** the shell so navigation is never lost. ② `failed`/`paused`/`cancelled` never count as completions — `MISSION_STATE_BOARD` (`convex/lib/validators.ts:527-536`) puts `paused` and `cancelled` in Backlog and `failed` in Needs you. ③ Board state changes only through authorized mutations; cards are focusable links, **never draggable** (`plan/architecture.md` §6). ④ Retry is offered only where retry is safe — never on a send (V11, `plan/verification.md:108`). ⑤ Missing usage renders as "unavailable", never as zero, and token estimates are never labelled as currency.

---

## 5. SCREEN CONTRACTS

Five states, distinct on purpose (V11, `plan/verification.md:102-108`), using the existing primitives at `src/components/states/states.tsx:22/49/84/123` — plus a sixth, **stale**, specific to this product.

### `/overview` — Mission Control
**In priority order:** ① the attention block (needs-you count, unassigned count, overdue count) ② runtime connection badge ③ New mission + campaign filter ④ the four columns, each with a count and a plain-language subtitle that covers *every* state it holds — Backlog is three states wide (`queued`, `paused`, `cancelled`) and Needs you is three (`waiting_for_user`, `waiting_for_runtime`, `failed`), which makes the **per-card state chip mandatory, not decorative** ⑤ the dated activity/receipts feed with the date picker attached *to it*.
**Loading** — four column skeletons, each labelled as loading, never an empty column. **Empty** — per column; the copy's job is to say what will put a card here and which action creates one (Backlog: "confirmed missions waiting to start"; Needs you: the good empty — "nothing is waiting on you"). **Workspace but no campaign** — job: explain that missions need an active confirmed campaign and link to the campaign step; `missions.create` refuses otherwise (`convex/missions.ts:141-152`). **Filtered to zero** — names which filter is responsible and offers clear-filters. **Error** — in-shell, `errorMessage()` from `src/lib/convex-error.ts`. **No permission** — viewer sees the board; New mission / pause / cancel / archive are absent, with one line naming the role that can.
**Bounded counts only.** `missions.listBoard` returns `{items, cursor, hasMore}` — no total. Column headers show `5` or `50+`, never a computed exact total (`plan/architecture.md:259`).

### `/decisions` — the queue
**In priority order:** ① one group per mission with an open required decision (header: title, priority, assigned employee, `requiredDecisionCount`) ② rows typed by `kind` ③ the mission filter. **Do not build sub-tickets** — `decisionFields` has no `parentDecisionId` (`convex/schema.ts:252-289`); the grouping already exists one level up via `decisions.listOpen({missionId})`.
**Loading / Empty** — "nothing needs you right now" is a *good* state with a link to the board, not a failure. **Filtered to one mission, zero open** — distinct from the above. **No permission** — a viewer reads the ask and the exact draft but cannot resolve (`decisions.resolve` is editor-gated). **Not offered**: a kind filter or a resolved toggle, until (b) above ships.

### `/decisions/$decisionId` — the highest-stakes screen
**Four kinds render as four screens, not one generic form.** `draft_approval`: exact recipient/subject/body + revision + hash + evidence links + preflight verdict, then Approve / Request changes / Reject / Edit draft. `missing_information`: `decision.reason` + one labelled input per `requestedFields` entry, with the client enforcing the same bounds `assertDecisionAnswer` enforces (20 fields / 2000 chars each / 4000 body). `connection_required`: reason + live runtime state + Connect for an owner, and for a non-owner an explicit "only the workspace owner can connect the runtime" line rather than a disabled mystery button. `delivery_uncertain`: the attempt, its receipts, and the reconcile-then-replace flow.
**Already resolved / superseded / cancelled** — show the historical outcome and who decided it; **never re-offer the buttons**. **Stale revision** — "this draft changed; review revision N" with one action. **Preflight blocked** — show the reason and `nextPermittedAt`.

### `/leads` — the CRM home *(needs P19)*
**In priority order:** ① mode toggle (pipeline / due) ② filters ③ the rows ④ pagination. **A table with a stage strip that filters — not an 11-column kanban.** Two reasons: `vSalesStage` has eleven values (`convex/lib/validators.ts:2482-2494`) and `by_workspaceId_and_salesStage_and_updatedAt` pages one stage at a time, so a board needs eleven parallel paginated queries; and drag-to-move invites exactly what §8 forbids — manufacturing `booked` without a confirmed booking or `contacted` without a send acceptance. Every stage change goes through a form that captures the reason the backend requires (`stageReason`, `convex/schema.ts:644`).
**Legal filter combinations, read off the indexes** (`convex/schema.ts:1152-1194`): pipeline + stage ✓; pipeline + campaign + stage ✓; due + owner ✓; due, workspace-wide ✓; search + any of `salesStage` / `campaignId` / `ownerIdentityKey` ✓ (they are `filterFields` on the search index). **Illegal**: owner + stage in pipeline mode (no compound index), and search + due range (§4.3: search does not combine due ranges or date sorting). An illegal combination's control is **disabled with its reason visible**, never silently dropped — P19 §1 states the rule, the UI is where it becomes visible or becomes a lie.
**Unscheduled is a first-class state**, not a filtered-out row: `nextActionDueAt` absent means unscheduled and the schema comment is explicit that it is "an explicit state the CRM renders, never a far-future sentinel" (`convex/schema.ts:636-637`).
**Loading / Empty-no-campaign** (job: link to onboarding) / **Empty-filtered** (job: name the filter, offer clear) / **Expired cursor** (job: "this page link is no longer valid", back to first page — must not throw into the boundary) / **Viewer** (rows and detail visible, mutation controls absent) / **Error**.

### `/leads/$prospectId` *(needs P19)*
Tabs: overview / evidence / activity / conversation / booking. **Three distinct honest empties, not one generic card**: no evidence yet, no conversation yet, no booking. **Not found or cross-workspace** — a safe state *inside* the shell, never a raw `NOT_FOUND` throw (V09 step 3). **Stale** — every P19 mutation takes an expected `version` (`prospectFields.version`, `convex/schema.ts:629`), so every form needs "this lead changed since you opened it" with a reload. **Booking states render distinctly**: proposed / confirmed / cancelled / completed / no_show.

### `/inbox` and `/inbox/$conversationId` *(needs P11)*
Two panes, not three — a mailbox switcher over a set of one is noise (`plan/README.md:101`, one inbox per workspace). List header carries the tabs and the assigned-employee selector. Thread detail: takeover prominently (it freezes automation), association flow for unassigned, sanitized bodies, suppressed-recipient state, closed thread read-only.

### `/employees`
**Adopt the reference's page shape; reject its stat strip.** `employeeFields` (`convex/schema.ts:121-131`) holds no lifetime counters, and a success rate computed over a truncated page is numerically wrong — `plan/architecture.md:259` forbids exact unlimited counters. Bounded, computable stats only, from `runs.by_employeeId_and_state`: In flight / Failed / Uncertain, each as `50+` past the bound. Skills chips map 1:1 to `allowedCapabilities` and the page states the workspace can only *narrow* that set. Status comes from the existing `deriveEmployeeStatus` (`src/components/employees/employee-status.ts:26-39`), which already returns an honest `disconnected` with no runtime. **The second line on a row is the running mission's title — a real field — not a narrated sentence.** A genuine live one-liner needs a newest-`activityEvents`-per-run lookup and there is no `by_workspaceId_and_runId_and_createdAt` index; until one exists, don't fabricate the line.

### `/settings`
Sections behind `?section=`; the section nav marks owner-only sections **before** the user opens them. **Account**: when `displayName` is null, do not render an empty `readOnly` `Input` — `settings.tsx:43-47` + `ui/input.tsx:11` versus `ui/skeleton.tsx:7` produce a borderless empty grey bar of identical height, fill and radius to a skeleton. Render the email as the identity with a "no display name set" hint and a link to `/handler/*` where it can actually be changed. **Sending**: this is where suppressions become inspectable without developer tools — `suppressions.list/add/remove` have existed since P10 with no UI. Say that a policy change bumps `policyVersion` and invalidates existing approvals **before** saving. **Automation**: pause stops new dispatch and **cannot recall mail already in flight** — say so. **Runtime**: the seven §4.4 states each with their own copy and next action; login challenge with its code, expiry and a countdown, owner-only. **Integrations**: "not yet available" must be visually distinct from "connected" — P04 is `"blocked"` (`plan/tasks.json:137`) and there is no `providerConnections` query.
Delete the `if (!user) return null` branch at `settings.tsx:22-24`. `return null` is never a page-level outcome — a blank column is worse than either loading or empty.

### `/` — marketing
**In priority order:** ① headline naming what the squad does and who decides ② subhead naming the loop concretely ③ **the approval screen as the hero image** — the exact-draft decision with recipient, subject, body and evidence links, because that screen *is* the thesis ④ a four-step strip Discover → Research → Approve → Book, each naming its surface ⑤ an honest limits block: five leads per campaign, one workspace inbox, human-recorded meetings, **no calendar sync** ⑥ two CTAs — Get started, and a credential-free judge path (V20 requires one, `plan/verification.md:186-192`). Any prepared demo data carries the visible label V20 requires. `src/assets/hero.png` exists and is referenced nowhere in `src/` — use it or delete it.

---

## 6. CROSS-CUTTING RULES

**URL and search params.** Any state a user would want to link, bookmark or reach with Back is a search param; only transient UI (a popover's open flag) stays in `useState`. Every param has a default, and a param at its default is **absent** from the URL — a clean `/leads` means pipeline mode, all stages, first page. Empty strings normalise to `undefined` so `?q=` never means "search for nothing". Date ranges are honest about relativity: `?range=today` means today for whoever opens the link; `?range=custom&from=&to=` is an absolute instant range — the picker says which. Validate with `validateSearch` on the layout route so children inherit one definition and cannot drift. There is **zero** use of `validateSearch`, `useSearch`, `loader`, `pendingComponent`, `useParams` or a `$param` file in the app today (grep across `src/` excluding `routeTree.gen.ts`) — this contract must be settled before P12 writes the board, because retrofitting addressability into a finished board costs more than designing it in, and V09 and V23 step 4 both test it directly.

**Pagination.** Default 25 rows, hard maximum 50 (`plan/architecture.md:259`). Opaque Convex cursors go in the URL only where paging is part of the shared context — `/leads`, `/inbox`, `/decisions` — always with an explicit expired-cursor state rather than a throw. They do **not** go in the URL for the four-column board: four opaque cursors make the URL unshareable and a shared board link should show current truth, not a frozen page. Each column shows its first page with "Show more" driven by `hasMore`; `?column=` gives a single-column expanded view whose paging is local. **Changing any filter resets the cursor** — V23 step 4 tests it explicitly (`plan/verification.md:221`). Never post-filter a truncated page and present it as a filtered result.

**Optimistic updates.** Permitted for local, reversible, non-external changes only (a comment appearing, a filter chip). **Forbidden**, absolutely: any send state, any approval outcome, any booking confirmation, any stage change. The UI shows the `sendAttempts` state machine and nothing else; `acknowledged` renders as "Sent", never "Delivered".

**Version conflicts.** `missions`, `employees`, `decisions`, `drafts`, `prospects` and `bookings` mutations all take an expected version. A `CONFLICT` renders **in place** as a readable state naming the current version, with a load-current action, preserving the operator's position and typed input. Never a raw toast, never a silent overwrite. Pair it with a client `requestId` so a repeated approve creates one logical intent.

**Live vs stale.** One rule: a live/working indicator exists only when `runtimeConnections.getStatus().live` is true — defined as `state === "ready" && freshHeartbeat` (`convex/runtimeConnections.ts:100-106`). It degrades visibly to disconnected or uncertain. `exists: false` ("never connected") and `exists && !live` ("disconnected — last seen X", using the returned `lastHeartbeatAt`) are different messages. No pulse, dot animation or progress line without that flag (`plan/architecture.md:438`).

**Keyboard and focus.** ⌘K opens the palette; add `/` to focus list search on `/leads` and `/inbox`, and Escape to close an open detail — **Escape navigates to the parent route**, not just blurs, or the URL and the view disagree. `j`/`k` + Enter on `/decisions` and `/inbox`, where the whole job is working a queue; arrows must not hijack scrolling when focus is outside the list. Opening a detail moves focus to its heading (not a trap); closing returns focus to the row that opened it — **track the row id, not a DOM ref**, because a live Convex subscription may have re-rendered the list underneath. Real dialogs keep normal focus containment and restore (V10 step 2). **Every state must be readable without colour** — mission states, delivery-uncertain, proposed-vs-confirmed, suppressed recipients all need words (V10: "State meaning does not depend only on color or animation"). One accessibility bug to fix while nearby: `src/components/ui/command.tsx:50-64` renders `DialogHeader`/`Title`/`Description` as a **sibling** of `DialogContent`, and `CommandDialog` is mounted inline in the sidebar tree, so the strings "Search" and "Jump to a page in OpenSquad." sit permanently in the sidebar's DOM and are read by a screen reader walking the nav even when the palette is closed. Move them inside `DialogContent`.

**Responsive structure.** ≥1280px: list + detail side by side on `/leads`, `/inbox`, `/decisions`, `/overview`. 768–1279px: opening a detail replaces the list, with a back control — nesting makes this a CSS decision in the parent, not a different route structure. <768px: the existing mobile sheet; the board becomes a **column selector** driven by `?column=` — §10:438 permits a selector or a horizontal board, and the selector wins because a horizontal board at 375px cannot show a card's status line without clipping. **The four columns never collapse to fewer than four states at any width**, and the counts stay visible even when a column's cards are behind the selector. Detail panels are **non-modal inline panels, not `role="dialog"`** — a focus trap plus scroll lock on a full-screen mobile detail is hostile, and by not being a modal the detail needs only focus move-in and restore. What *stays* a real dialog: transient forms over already-loaded data and irreversible confirmations — New mission, Propose booking, Confirm meeting, Request changes, Reject, Archive, Cancel. Those get no URL because there is nothing to share or reload. The one deliberate exception is draft approval, which is a route precisely because V13 step 2 needs two sessions on the same draft.

**Permission-denied is not empty.** They are different states and must look different. Empty says *nothing is here yet and here is what will fill it*. Permission-denied says *this exists, you cannot change it, and here is who can*. Today three surfaces improvise three different shapes for one concept — `EmployeesView.tsx:99-104`, `WorkspaceSection.tsx:146-150`, `MembersSection.tsx:211-215` — and `OnboardingWizard.tsx:65-72` uses a full `EmptyState` for it. Add a `PermissionNote` to `src/components/states/states.tsx` taking `{ role, action }` and use it everywhere; the role is available uniformly from `workspaces.getCurrent().role`. Pair it with one rule: **a disabled control always carries a reason a hovering or screen-reader user can reach** — several today are `disabled` with the explanation in a paragraph far below (`WorkspaceSection.tsx:110-129` vs `:147`). And the UI must not offer what the server will reject: V23 step 2 requires a viewer mutation to fail server-side, which is the backstop, not the design.

---

## 7. WHAT TO BUILD, IN ORDER

Seven days to 22 Sep. `plan/tasks.json` has P11, P12, P13, P19, P20, P21, P09 all `"pending"` and P04 `"blocked"`. Items 1–4 are structural, cheap, independent of all feature work, and make the app survivable; do them first.

**Prerequisites for the 22 Sep deadline**

1. **In-shell not-found + dashboard error boundary.** `src/routes/_dashboard/$.tsx` (splat child — `_dashboard` is pathless so it matches any URL, and a splat has lowest priority) plus `errorComponent` on `src/routes/_dashboard.tsx:7-9`, dispatching on `domainErrorCode` from `src/lib/convex-error.ts:38` (already written, currently unused by any route): `FORBIDDEN` → lost-access message with sign-out; `NOT_FOUND` → the in-shell panel; else retry. Keep `__root.tsx`'s versions for genuinely public paths. **~40 lines. Owner: new integrator work.** Unblocks: every route below, and stops `/leads` throwing the user out of the app today.
2. **Workspace gate + URL step in onboarding.** A pathless `src/routes/_dashboard/_workspace.tsx` calling `useCurrentWorkspace()`: `undefined` → loading, `null` → `<Navigate to="/onboarding" />`, else `<Outlet/>`. Move `overview`, `employees`, `leads`, `inbox`, `decisions` under it; leave `onboarding` and `settings` outside so setup and account access are never gated by the thing setup creates. **Delete all three duplicated "No workspace yet" cards** — after the gate they are unreachable. Add `?step=` with the initial step derived from saved data, and render the rail from screen one. `beforeLoad` is not available (`src/main.tsx:12`, no router context). **Owner: new integrator work / P12.** Unblocks J1.
3. **Shell fixes.** Move the chrome outside the Suspense boundary at `_dashboard.tsx:13`; make the skeleton structurally identical to the loaded shell at every width with a real (disabled) trigger; seed `use-mobile.ts` from `matchMedia().matches`; drop `overflow-hidden` from `DashboardShell.tsx:19`; fix the palette duplicate key (`AppSidebar.tsx:48/155`) and the exact-match `isActive` (`:73`); guard ⌘K/⌘B against input targets; replace `main.tsx:22`. **Owner: P12 §4.** Unblocks V10 and every wide component below.
4. **Settle the search-param contract and write it into `validateSearch` on the four layout routes before any board or list is built.** **Owner: P12.** Unblocks V09, V23 step 4, and saves a retrofit.
5. **`/decisions` + `/decisions/$decisionId`.** **Build this before the board.** It is the product's thesis, it is the highest-value screen available, and it needs **no new Convex code** — `decisions.listOpen/get/resolve`, `drafts.get/revise`, `approvals.approve/requestChanges/reject`, `sendAttempts.listForDraft` and `sending.preflight` all ship today. **Owner: P13 §3, pulled forward.** Unblocks V13, V17, V19 and the marketing hero screenshot.
6. **`/overview` board + attention block + New mission + mission detail.** Real `missions.listBoard` per column, honest column subtitles, state chips, `missions.create`, and `/overview/missions/$missionId` with receipts and comments. Ship the attention block as a **component** so P13 can move it to `/leads` unchanged. **Owner: P12 §1-3.** Unblocks V08–V11.
   - **Blocking sub-item: add the optional `visibility` arg to `missions.listBoard`** (`convex/missions.ts:379, 392`), or `missions.restore` stays unreachable and **V09 step 3 cannot pass**.
7. **P19 §1 — `convex/prospects.ts`: `list`, `search`, `getDetail`, `updateStage`, `assign`, `setNextAction`, `addNote`.** The tables and all five indexes plus the search index already exist (`convex/schema.ts:1152-1194`), so this is behavior on a settled schema. **Owner: P19.** Unblocks `/leads` entirely.
8. **`/leads` + `/leads/$prospectId` + `/prospects` redirect.** **Owner: P13 §1.** Unblocks V23.
9. **P11 §4 conversation queries, then `/inbox`.** Largest remaining backend gap — no `convex/conversations.ts` exists at all. **Owner: P11 §4 → P13 §3.** Unblocks V15–V18 UI and the "a real reply came back" half of the demo. **If one item slips, this is the one** — the decision queue can carry reply approvals without a rendered inbox.
10. **P19 §3-5 bookings + `?tab=booking`.** **Owner: P19 → P13 §2.** Unblocks V24 — the product's closing act.
11. **Marketing rewrite + `afterSignIn`/`afterSignUp` flip.** The redirect flip (`src/hexclave/client.ts:8-9`, `src/routes/sign-in.tsx:25-26`, and `__root.tsx:47`'s "Back to overview") happens **only after `/leads` works**, in one commit, per `plan/tasks.md:490-492`. **Owner: P13 §4-5.** Unblocks V20.
12. **Sidebar: add each item in the same commit as its route,** extending `MenuHref` (`src/constants/sidebar-menu.ts:8`) each time. Decisions badge from `decisions.listOpen`. **Owner: P12/P13.**

**Not prerequisites for 22 Sep** — do only if items 1–12 land early: `/employees/$employeeId` detail (the roster works without it); a resolved-decisions history view and kind filter (needs (b)); a workspace-wide runs page (needs a new `runs.by_workspaceId_and_createdAt` index; nobody owns it); `providerConnections` UI (P04 is `"blocked"`); the palette's record search (ships free once P19 §1 lands, but is not gating); theme seeding from `prefers-color-scheme` (`theme-provider.tsx:21-24` never consults it and applies the class in a `useEffect`, so a dark-mode user gets a light flash — a real V10 step 3 item, but cosmetic against the deadline); wrapping `/handler/*` in a layout with a way back.

---

## 8. EXPLICITLY NOT DOING

| Not doing | Why |
|---|---|
| Streamed agent desktop / "Tessa's computer" / Take over | Desktop streaming is deferred — `plan/README.md:114`. |
| Free-form agent chat; the home composer "Ask Atlas anything"; "Discuss with June" buttons | Deferred — `plan/README.md:112`. The legitimate equivalent of "tell the squad what to do" is the campaign brief, which already has a home in onboarding; the legitimate equivalent of "discuss" is `activity.addComment`, placed **outside** the approve/reject group because a comment cannot resolve an approval (§4.2). |
| Per-employee inboxes; a mailbox switcher; the footnote "sends immediately from June's inbox, with no second review" | Individual employee inboxes are deferred (`plan/README.md:113`); one AgentMail inbox per workspace (`:101`). That footnote is the **inverse** of our thesis — ours states the send goes through approval, policy window, suppression and daily limit. |
| Sub-tickets inside a ticket | `decisionFields` has no `parentDecisionId` (`convex/schema.ts:252-289`). Adopting it invents a table. The grouping already exists: `decisions.listOpen({missionId})`. |
| The word "Tickets" | `plan/README.md:103` and `plan/architecture.md:434` both fix the word **Decisions**. Our user is deciding whether an email leaves the building; "ticket" imports a support-desk artifact we do not model. |
| A top-level Runs / Scheduled screen, its month calendar and named-schedule rail | `plan/architecture.md:434`: "Scheduled only when implemented"; P15 is optional and `"pending"` (`plan/tasks.json:563`). No cross-mission runs query exists — `activity.listRuns` requires a `missionId` and there is no `runs.by_workspaceId_and_createdAt` index. Receipts live inside mission detail. |
| Per-run model chip and cost line | `runFields` (`convex/schema.ts:219-250`) has no model name and no cost field. `plan/architecture.md` §9: missing usage remains unknown; never label a guessed number "credits remaining". |
| Lifetime "186 Completed" and "98% Success" on employee detail | No counters on `employeeFields`; a rate over a truncated page is wrong. `plan/architecture.md:259` forbids exact unlimited counters. |
| A narrated live status line per employee ("Drafting 3 reminder ema…") | No field holds it. `progressSummary` is per-mission; `inputSummary` describes a run's input; `activityEvents` has no by-employee or by-run index. The honest second line is the running mission's title. |
| An 11-column drag-and-drop lead kanban | Eleven parallel paginated queries, and drag-to-move manufactures state transitions §8 forbids (`booked` without a confirmed booking, `contacted` without a send acceptance). §6 states the same rule for missions: cards cannot be dragged to manufacture transitions. |
| Unread as an inbox tab | `conversations.unreadCount` has no index. It is a badge and a sort order. |
| "Docs" as a nav destination | `plan/README.md:106` — no general document editor; briefs live in mission/prospect detail. |
| "Trash" as a board action | `plan/architecture.md` §6 defers trash and irreversible deletion; P12 §3 says archive/restore only. |
| Any calendar affordance — availability, sync, "event created" | `plan/README.md:113` defers automatic calendar sync; `bookingFields` stores `externalEventRef` only when a real provider event exists and `confirmationSource: provider` stays unavailable until a validated connector verifies one (`convex/schema.ts:685-688`). Calendar sync is **absent**, not pending. |
| A Retry button on a failed mission | No retry transition exists; `MISSION_TRANSITIONS` documents that `failed` leaves only via the archive path, and `missions.archive` accepts `failed` directly (`convex/missions.ts:579-608`). Offer Archive plus the run receipt. |
| A workspace switcher | `workspaces.getCurrent` returns at most one membership. The workspace name is identity, not a control. |
| Splitting `/settings` into seven route files | `?section=` gives the same deep links for one `validateSearch`. §10:432 keeps `settings.tsx` as one file, and seven route files is not a seven-day expenditure. |
| Test files | `AGENTS.md`; V23 step 4 explicitly notes "No test files are needed for this manual fixture." |