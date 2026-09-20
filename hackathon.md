# Hackathon log

- **Project:** OpenIntent (formerly OpenSquad)
- **Event:** Convex All Gas Hackathon
- **What it does:** An AI sales agent that finds and researches leads from buying-intent signals, writes and sends the outreach email, and works the replies until a meeting is booked.
- **Live app:** https://proficient-porcupine-63.convex.site
- **Repo:** https://github.com/arjunkambj/opensquad
- **Frontend:** Convex static hosting
- **Convex deployment:** https://proficient-porcupine-63.convex.cloud
- **Components:** @agentmail/convex, @firecrawl/firecrawl-convex, @convex-dev/migrations, @convex-dev/rate-limiter, @convex-dev/static-hosting
- **Convex features:** schema, indexes, search index, queries, mutations, HTTP actions, internal mutations/actions, crons, scheduled functions, components, AI gateway
- **Auth:** Other
- **AI models:** openai/gpt-5.6-sol (Convex AI Gateway)
- **Started:** 2026-09-13T12:00:25Z
- **Last updated:** 2026-09-20T19:45:00Z

## Log

### 2026-09-13 - 0eb661d

Created the frontend foundation in the project root with React, Vite, pnpm,
Oxlint, and file-based TanStack Router routes for home and about. Verified a
clean lint, production build, and local responses for both routes (`package.json`,
`vite.config.ts`, `src/main.tsx`, `src/routes/`).

### 2026-09-13 - 85c467a

Added the shadcn/ui system with Hugeicons, Inter, and zinc tokens, plus the
sidebar, calendar, and form primitives used by the dashboard (`components.json`,
`src/index.css`, `src/components/ui/`).

### 2026-09-13 - 17c546e

Wired Hexclave React auth into the Vite app and Convex client, including cookie
tokens and Convex JWT providers (`src/hexclave/client.ts`, `src/main.tsx`,
`convex/auth.config.ts`). Auth: Other.

### 2026-09-13 - 7ee8f4e

Ported the MultiFeed remake date picker, collapsible sidebar, user profile menu,
and custom email/Google sign-in page onto OpenSquad. Routes: `/sign-in`,
`/overview`, `/squads`, `/settings`, `/handler/$`. Added a marketing navbar only
(`src/components/Marketing/Navbar.tsx`, `src/routes/_marketing.tsx`). Icons are
Hugeicons; colors use shadcn tokens.

### 2026-09-13 - 1bb4bed

Removed the muted open-state background behind the profile menu avatar trigger
so the button keeps its base radius
(`src/components/Layout/UserProfileMenu.tsx`).

### 2026-09-13 - 988fb16

Refined shared theme variables and UI component styling
(`src/index.css`, `src/components/ui/`, `src/components/auth/SignInForm.tsx`).

### 2026-09-13 - 0d71156

Added the portable sales CRM, research, outreach and booking plan, plus a task
navigator and repository build skill (with `f2a5f14`; `plan/`, `scripts/plan.mjs`,
`AGENTS.md`, `.agents/skills/opensquad-build/`). Replaced development time budgets
with dependency-based parallel worktrees and isolated development backends.

Reviewed unmatched-mail handling, send uncertainty across draft revisions and
company-name search contracts. The navigator rejects premature task starts and
missing dependency declarations. Plan checks, lint and build pass with existing
warnings; CRM, ASCII/Codex and provider integrations remain planned work.
Corrected frontend hosting to not deployed based on the inspected source and
linked the configured repository. Verification: `plan/evidence/P00.md`.

### 2026-09-13 - 39305d3

P01 integrated: added the tracked `.env.example` contract covering every
planned configuration name with per-destination sourcing comments, plus a
worker env example under `worker/`; verified no real values were committed
(`.env.example`, `worker/.env.example`). Inventoried provider access for the
dev deployment `dev:flexible-grasshopper-949`: Convex and Hexclave are usable
(JWKS live, customJwt providers configured), Firecrawl quota confirmed, and
concrete blockers recorded for the ASCII API key, the scoped AgentMail key and
webhook secrets. Pinned component versions match the plan
(`@openai/codex@0.154.0`, `@asciidev/box-sdk@0.0.34`, `@convex-dev/workflow@0.4.7`,
`@agentmail/convex@0.1.0`, `@firecrawl/firecrawl-convex@0.1.1`). Lint and build
pass on the merged branch. No provider integration is claimed working.
Verification: `plan/evidence/P01.md`.

### 2026-09-13 - ad05ffc

P03/P05 integrated (spikes merged; live provider gates remain blocked on
owner-supplied credentials, recorded in `plan/tasks.json`). The `worker/`
package now carries a typed ASCII Box lifecycle adapter (idempotent create,
resume/TTL/stop/delete incl. the verified `X-Ascii-Confirm-Delete` header) and
a Codex App Server stdio client with protocol types generated from the
installed `codex-cli 0.154.0`; the initialize/account/login-start/cancel/
rate-limits protocol was exercised for real over stdio, but no Box was
provisioned and no model turn ran. On the mail side, `@agentmail/convex@0.1.0`
is registered and its Svix-signed webhook is mounted at `/agentmail/webhook`;
a narrow internal `executeSendAttempt` adapter performs exactly one
`Idempotency-Key`-headered POST with honest accepted/rejected/uncertain
outcomes — verified unreachable publicly, signature rejection and a live
negative probe confirmed on an isolated local backend
(`convex/convex.config.ts`, `convex/http.ts`, `convex/integrations/agentmail.ts`,
`worker/`). Verification: `plan/evidence/P03.md`, `plan/evidence/P05.md`.

### 2026-09-13 - f9f6664

P02 integrated: the first domain schema and authorization layer now exist —
`workspaces`, `memberships`, `businessProfiles`, `employees`, `campaigns` with
declared indexes and transactional invariants, typed Hexclave identity guards
(`tokenIdentifier` keys, anonymous-issuer rejection, uniform NOT_FOUND across
workspaces), an idempotent one-transaction workspace bootstrap with the three
employee templates, and campaign create/confirm/transition APIs with immutable
confirmed source plans and version conflicts (`convex/schema.ts`,
`convex/lib/`, `convex/{workspaces,businessProfiles,employees,campaigns}.ts`).
Authorization paths were exercised live on an isolated local backend with
synthetic identities — cross-workspace access, viewer/owner role matrix,
lead-cap and source-gate rejections all verified; a real provider-issued JWT
still awaits the human sign-in check. Verification: `plan/evidence/P02.md`.

### 2026-09-13 - 73ff205

P03/P05 live gates passed on real providers. G1: disposable ASCII Boxes were
provisioned with persisted idempotency (repeat create → one box), bootstrapped
to Node 24.21.0 + codex-cli 0.154.0, verified credential-clean at birth; the
owner completed managed device-code login inside a Box, a bounded structured
model turn completed (`gpt-6-astra`, `{"ok":true}`), pause→archive→resume kept
the marker file AND the managed login (second turn ran on the resumed thread),
a second Box proved workspace isolation, and all boxes were deleted (`worker/`
gate drivers). G3: the AgentMail webhook is registered and signature-verified
end-to-end — a controlled send delivered, same-key replay returned identical
provider IDs with zero duplicates, a changed payload on the same key 409'd into
`uncertain`, and a reply round trip landed in the component's inbound mirror;
duplicate/out-of-order events handled (`convex/integrations/agentmail.ts`).
Noted deltas: ChatGPT device-code auth must be enabled in security settings;
`thread_id` is per-inbox; `message.delivered` can precede `message.sent`.
Verification: `plan/evidence/P03.md`, `plan/evidence/P05.md`.

### 2026-09-14 - 9153365..1de8be6

Post-review hardening on main plus two closed limitations. The owner completed
a live Hexclave sign-in — the real JWT now verified end to end against
`requireUser`'s issuer check (P01/P02 recorded limitation closed), and
`FIRECRAWL_WEBHOOK_SECRET` is configured on the dev deployment so the
component's HMAC gate is active (`convex env list`, names only). Fixes:
`ensureWorkspace` no longer dead-ends callers holding only non-owner
memberships; `campaigns.create` dedupes on (workspaceId, requestId);
`workspaces.update`/`setAutomationState` handle no-ops and pause-reason
updates; the scrape URL guard rejects the remaining private IPv6 ranges; and
an unexpected Codex app-server exit now fails the worker process so systemd
restarts it (`convex/workspaces.ts`, `convex/campaigns.ts`, `convex/schema.ts`,
`convex/integrations/firecrawl.ts`, `worker/src/codex/appserver.ts`,
`worker/src/main.ts`). Apollo OAuth remains deferred by owner choice — P04
stays blocked. Lint, build, both typechecks and `pnpm plan check` pass.

### 2026-09-13 - 1a93886

P04 integrated, Firecrawl half verified: `@firecrawl/firecrawl-convex@0.1.1` is
registered with credentials bound by reference and its signed webhook
self-mounts at `/firecrawl/webhook`; a narrow internal `scrapePage` wrapper
admits only validated public http(s) URLs (localhost/private/userinfo rejected)
and one real bounded scrape completed for one credit. Found caveat: the
component skips HMAC verification entirely when `FIRECRAWL_WEBHOOK_SECRET` is
unset — it is configured on the dev deployment. The Apollo side is deferred by
owner choice: the in-Box MCP OAuth probe machinery is committed but unexercised
(`worker/src/{boxmcp,p04gate}.ts`), so P04 stays `blocked` pending the owner's
Apollo grant — no discovery or enrichment is claimed working.

### 2026-09-13 - 2349f80..48c1380

Reviewed the unpushed implementation against the plan. Fixed workspace timezone
policy versioning, worker login persistence and operation replay, secret-free
request fingerprints, fast completion handling, AgentMail response-body
uncertainty and Firecrawl source-URL admission. Current evidence inbox references
were redacted. Lint/build, Convex and worker typechecks/build, plan validation
and offline manual checks passed; existing hook/chunk warnings remain. Apollo
is deliberately untested. No deployment or provider call ran in this review.
Evidence: `plan/evidence/P02.md`, `plan/evidence/review-worker.md`,
`plan/evidence/review-providers.md`.

### 2026-09-14 - 3497402

P08 onboarding/employees/settings integrated. The onboarding wizard persists a
business profile, workspace timezone (expectedPolicyVersion-guarded), send
window/limit and campaign scope through the real P02 mutations, then renders the
interpreted source plan + cap + enrichment allowance + send policy for explicit
confirmation before activating automation. `/employees` shows the three employee
templates with versioned instruction editing and honest status — only
disconnected/disabled are reachable until P07 lands a runtime signal; nothing is
simulated. Settings covers workspace, sending policy, automation pause and
members/roles; integration/Codex rows stay disabled pending P07/P04. `/squads`
is now a typed redirect; `/overview` remains the sign-in destination. Verified
at API level on an isolated local backend (full onboarding chain, version
conflicts, idempotent create, last-owner protection, cross-workspace
NOT_FOUND); lint/tsc/build clean on merged main. Browser sign-in and the visual
review remain the human gate.
Evidence: `plan/evidence/P08.md`.

### 2026-09-14 - 8266686

P06 durable supervision layer integrated. Six §4.2 tables (missions,
missionProspects, runs, decisions, missionComments, activityEvents) plus
`@convex-dev/workflow@0.4.7` now own mission lifecycle, required human asks,
run receipts and deduped activity. A clearly labeled dev-fixture pipeline (not
AI/provider work) proves the durable contract every later stage reuses:
dispatch gate → validated stage → per-prospect child workflows with stable
start keys → required decision → durable event wait → persisted continuation →
aggregated terminal outcome (partial/contact_needed included). Local probes
verified concurrent-resolve single-apply, backend kill+restart mid-wait with no
re-run steps, comments never resolving approvals, pause/cancel behavior and the
auth matrix. Combined backend pushed to dev:flexible-grasshopper-949 — workflow
component and §4.2 indexes are live there. waiting_for_runtime is plumbed but
awaits P07 worker uncertainty; draft/sendAttempt references are bounded strings
until P10/P11 tables land.
Evidence: `plan/evidence/P06.md`.

### 2026-09-14 - 8a766c1

P07 scoped worker bridge + runtime lifecycle on `opensquad/P07` (task branch,
not yet merged). Convex now owns the §4.4 transport schema — runtime
connections, a durable lifecycle ledger, scoped worker credentials (hashed at
rest, AES-256-GCM sealed for env injection), control requests, owner-only
login challenges, agent sessions, worker requests, the single
workspace execution slot and artifacts — plus nine authenticated
`/worker/*` routes carrying the spec status codes. The Box worker is a real
poll-driven daemon: control-claim loop (device-code login start/cancel,
account inspect, logout, interrupt_turn), work-claim loop with lease
heartbeats honoring backend-ordered stops, exactly-once result/failure
posting with worker-computed canonical digests, and a runtime liveness loop.
curl-verified end-to-end on an isolated local deployment across claim,
heartbeats, activity dedupe, exactly-once + conflicting results, failure
replay, expired-lease→uncertain→interrupt-confirmed slot release, the login
challenge lifecycle, artifact upload dedupe, scope denial, generation
retirement and throttling. Provider-gated seams stay honest: owner lifecycle
mutations need a Hexclave session, and no disposable ASCII Box or live Codex
turn ran this round — the daemon-in-Box live gate remains open.
Evidence: `plan/evidence/P07.md`.

### 2026-09-14 - aca0591

P07 + P10 integrated into main. P10 lands the exact-draft send boundary:
immutable draft revisions with a canonical payload hash; approvals bind the
exact revision + normalized recipient + conversation context version and run
through the single P06 decision path; the one sendAttempts intent is created
with its durable provider idempotency key BEFORE any network I/O, and the
`beginDispatch` commit point re-runs every gate atomically before the single
provider call. Uncertain outcomes keep capacity, open a delivery_uncertain
ask and can only replay the SAME key inside the provider window — blind
retries are structurally impossible, and replacement sends exist only via
the §8.7 recorded-decision binding. Verified on an isolated backend with a
real controlled inbox→inbox send (SES provider ref recorded) plus the full
V17 block matrix and V18 reconcile/replace probes. Schema/validator section
conflicts between the P07 and P10 branches resolved by union; the §4.3
`artifacts` table is P07-owned (P09 must not re-add it). Combined main
pushed to dev:flexible-grasshopper-949 — §4.3/§4.4 tables, /worker/\* routes,
crons and indexes live. Deferred honestly: P07's owner lifecycle needs a
Hexclave session, the daemon-in-Box live gate stays open, and demo-recipient
gating is code-verified only.
Evidence: `plan/evidence/P07.md`, `plan/evidence/P10.md`.

### 2026-09-14 - fcd564b

Independent post-merge review of P07 (scoped worker bridge + runtime
lifecycle) on `opensquad/review-bridge` — the branch had merged without an
independent read of its adversarial seams. Twelve concrete defects found by
tracing backend/HTTP/worker/lifecycle paths and fixed as ten focused commits:
retired runtimes now deliver every cancelled request's workflow continuation
and finish its run receipt (steps previously parked forever); the lease-expiry
interrupt handshake can actually release an uncertain slot (daemon reports
terminated:true for provably dead turns, the sweep enqueues bare interrupts);
control claims prefer pending commands so cancel_login/interrupt_turn are no
longer starved behind a claimed start_login, and the daemon dedupes
re-delivered claims instead of failing the live login; disconnect supersedes
in-flight provisioning ops, teardown ops pin their target box across generation
bumps, stale-generation outcomes can no longer rewrite a live connection, and
resume re-injects the new generation's worker env (reconnect onto an existing
box was previously a dead end); claim validates input before mutating, artifact
operationKey dedupe conflicts on digest mismatch, heartbeat run refs are
workspace-scoped, and control effects can no longer resurrect a dying runtime.
Verified by convex + worker typechecks, lint and the full build; code-traced
only — no provider call, Box, live turn or deployment ran in this review.
Evidence: `plan/evidence/review-bridge.md`.

### 2026-09-14 - 5ffca96

Orchestration-seam review of the integrated P06+P07+P10 backend on
`opensquad/review-orch` (review branch, not pushed). Five real defects
found and fixed in feature-wise commits: (1) `boundedString` crashed on
non-string fields carved out of `v.any()` worker envelopes — a malformed
authenticated callback mapped to 503 instead of the documented 400
INVALID; (2) `MISSION_TRANSITIONS` could not express terminal reconcile
from `queued`/`paused`, and the workflow workpool swallows onComplete
errors, so a pre-gate failure or a pause racing the terminal callback
wedged the mission non-terminal forever; (3) `onMissionWorkflowComplete`
treated every successful workflow as mission-complete — an abandoned run
(ask superseded/retired) wrote `completed` on a live mission — and neither
completion callback verified `args.workflowId` against the durable row;
(4) `vSendWorkflowResult.preflight_refused` drifted from `vDispatchOutcome`
(missing `sendAttemptId`) and would fail workflow return validation after
a committed reservation; (5) `decisions.listForMission` paginated the
state-major index instead of "newest first". Re-verified correct without
patches: decision-resolution single path, send commit/reconcile contract,
worker lease/slot/exactly-once semantics, owner control channel,
artifact two-phase upload, named-event resume cycles, and the frontend
runtime-status consumers. Documented-but-unpatched: dead
`cancelMissionWorkerRequests` (wiring it in without slot release would
leak `held` forever), permanently-dead-worker uncertain slots until owner
reconnect, and post-revise mission state/badge drift pending the P09
redraft-loop design. tsc (root + convex), lint, build all clean.
Evidence: `plan/evidence/review-orch.md`.

### 2026-09-14 - 9147a50

Integrated the leftover send-path review branch (`opensquad/review-send`,
4 commits) and the verified P10 acceptance evidence, then ran a dedicated
review of the P10 support modules — approvals, drafts, suppressions, usage,
send-attempt reads — against the merged tree. Seven defects found and fixed
feature-wise: receipt reads by providerMessageRef no longer cross workspace
boundaries; the public `decisions.resolve` now refuses artifact-bound kinds
(`draft_approval`, `delivery_uncertain`) — those asks must resolve through
`approvals.*`/`sending.resolveDeliveryUncertainty` via a shared bound
internal path, closing a hole where a bare answer burned the ask and left
the revision unapprovable forever; draft-approval supersede now scans by
draft (not mission) so a cross-mission revision can't strand an open ask;
usage settling covers every reservation under an operation key instead of
deadlocking on multi-bucket keys; requestChanges/reject requestId replays
can no longer alias each other's recorded resolution; bucket limits refresh
only on new reservations; and the remaining list queries use the standard
bounded limit. Documented residuals for P09/P11: exact-address suppression
vs `+tag` sub-addresses, public-suffix domain suppressions, IDN rejection,
and unaudited suppression removal. Verified: convex tsc, lint, build clean.
Evidence: `plan/evidence/review-send.md`, `plan/evidence/review-p10-modules.md`.

### 2026-09-14 - cd25cd6

Second adversarial review round across the send boundary, worker bridge,
orchestration seams, daemon and versioned UI forms — 14 defects fixed
feature-wise. Send boundary: a post-request action failure now records
`uncertain` (never `definitively_failed` with a released reservation and a
possible duplicate), all wake/reconcile schedules moved inside the
committing mutations plus a 5-minute belt cron, replacement attempts carry
a `coveredByAttemptId` chain for transitive uncertainty, parked `reserved`
intents are cancelled in-transaction when a revision or inbound context
supersedes them, and a live `requesting` attempt reports the new
`in_flight` outcome rather than `already_resolved`. Worker bridge:
`draft`/`classify_reply` results no longer require a `summary` field the
contracts never declared; unconfirmed terminations hold the slot as
`uncertain` and enqueue `interrupt_turn` instead of freeing capacity while
a turn may still run; control results validate before the terminal patch;
stale pinned teardowns can't kill a reclaimed box; revive re-covers
orphaned boxes. Orchestration: mid-pipeline pause now parks the workflow
on the resume event instead of failing the mission, and every dead-mission
cancel path finishes its run receipt. Daemon: unacked control results
repost with the same resultId instead of re-executing, and an unconfirmed
turn kills the app-server and exits so the supervisor restart proves
termination. UI: versioned forms submit the edit-base version so a
concurrent bump can't be silently overwritten. Verified: all three
typechecks, lint, build, `pnpm plan check`.
Evidence: `plan/evidence/review-send.md`, `plan/evidence/review-bridge.md`,
`plan/evidence/review-orch.md`, `plan/evidence/review-p10-modules.md`.

### 2026-09-14 - fa1854c

Third adversarial review round — six parallel audits over the merged
P01–P10 surface (send boundary, mission/decision lifecycle, worker runtime
+ daemon, control channel, domain layer, frontend, cross-cutting seams)
ahead of starting P11/P12. Thirty-two findings fixed feature-wise.
Runtime: a resume+disconnect race could leave a live Box billed to TTL —
the post-resume recheck now stops the box unless a newer generation owns
it; failed teardowns land the connection on `error` instead of wedging
`stopping`; a new 5-minute lifecycle sweep re-drives lost schedules and
dead drivers on a `by_state_and_updatedAt` index; revive also scans op
ledger rows for boxes `connection.boxRef` never referenced. Daemon: work
claims now require a verified managed account (60 s recheck while
unauthenticated), a contract-invalid result posts
`output_contract_violation` instead of dying into `interrupted`, and
systemd restart loops are bounded. Send: the `delivery_uncertain` ask is
opened inside the outcome transaction; cancelled/failed replacement
attempts unlink their covered rows; reconcile reports `in_flight`
honestly. Controls: command dedupe is payload-aware (a second-turn
interrupt can't alias the first) and owner diagnostics are owner-gated.
Hardening: worker results are rejected when any string carries an
`osw_`/`osl_` credential pattern; challenge material is stripped
recursively from stored control results; the dev bridge dump no longer
emits live device codes. UI: root error + not-found boundaries; employee
cards submit the edit-base version. Verified: lint, build, root + worker
tsc, `pnpm plan check` clean.
Evidence: `plan/evidence/review-round3.md`.

### 2026-09-15 - 3a78202

Shipped Mission Control with a four-column board, deep-linked mission details,
lifecycle actions, receipts, comments and a human-approval queue, exercised in a
real browser against the shared development deployment (`src/components/missions/`,
`src/components/decisions/`). Added verified inbound routing, quarantine,
conversation ownership, opt-out enforcement and reply-draft orchestration
(`convex/inbox.ts`, `convex/conversations.ts`, `convex/workflows/reply.ts`). Replaced
the sales fixture with a durable per-prospect workflow using bounded Firecrawl
retrieval, capability-scoped worker calls and backend-synthesized cited evidence
(`convex/workflows/sales.ts`, `convex/evidence.ts`, `convex/prospects.ts`). Live
development probes covered the inbound and Firecrawl paths; Apollo, a live Codex
turn for this pipeline and outbound sending remained deferred. Evidence:
`plan/evidence/P11.md`, `plan/evidence/P12.md`, `plan/evidence/P20.md`,
`plan/evidence/P21.md`.

### 2026-09-16 - 75e76f6

Shipped the round's three cards: the Mission Control board (P12, accepted), the
shared inbox and reply backend (P11), and the sales pipeline with its capability
boundary (P21). Ran as two waves - P11 with P12, then P21 - because `tsc -b`
covers only `src/` while `convex/` has its own tsconfig, so a frontend and a
backend track can self-verify concurrently but two backend tracks cannot.

**P12 (done).** Four-column board at `/overview` from real `missions.listBoard`,
per-column bounded counts (`5` / `50+`, never a computed total), a mandatory
per-card state chip because Backlog is three states wide and Needs-you is three,
mission detail nested at `/overview/missions/$missionId` so closing it preserves
the filters by construction, and a runtime badge that degrades instead of
animating a runtime that is gone. V08-V11 exercised in a real browser with every
on-screen number cross-checked against the deployment. Archive/restore round-trips
only because `missions.listBoard` gained an optional `visibility` argument -
both index branches had pinned it to `visible`, so `missions.restore` was
unreachable from any UI and V09 step 3 could not pass.

**P11 (in progress).** Signed AgentMail ingest with application-effect dedupe
distinct from the component's `event_id` dedupe, a workspace-scoped unassigned
queue under human takeover, unknown-inbox quarantine with idempotent replay,
immediate explicit opt-out with ambiguous cases held rather than guessed, and a
reply workflow that proposes a draft for its own exact approval. The ordering
rule is observed live: an inbound reply bumps `contextVersion`, supersedes the
open ask and decrements `requiredDecisionCount` before any model work exists.
The reply path itself is still unrun and the card stays open.

**P21 (in progress).** The capability set is now derived server-side from the
run's employee row, carried on the request envelope, validated fail-closed on
the worker and re-checked at the lease - the model is never asked what it may
do. A filtered tool router replaces a blanket refusal, a `providerOperations`
ledger makes a repeated invocation cost nothing, and a page allowance is
reserved transactionally before Firecrawl is ever called, which finally makes
G2's "exhaust a small allowance and show the next call refused before it reaches
the provider" demonstrable. Evidence rows are admissible only from a page that
run actually retrieved, with confidence defaulting to `unknown`.

Verified: lint silent, `tsc -b`, convex and worker typechecks, `vite build`,
`plan check`. Honest limits: no Codex runtime is connected to this deployment, so
no model executes a request and V12's full role chain is deferred; Apollo
discovery and enrichment remain P09's behind the owner-deferred OAuth grant.

Fixed a data-loss defect found by the gate pass: `onMessageReceived` required a
`thread` field the provider's own contract makes optional, so a reply arriving
without one threw inside a Workpool that does not retry mutations, and the
`by_eventId` ledger then refused the resend - the mail was lost with nothing to
drain and nothing to replay.
Evidence: `plan/evidence/P11.md`, `plan/evidence/P12.md`, `plan/evidence/P21.md`.

### 2026-09-17 - 1e83b35

Integrated four parallel lanes and accepted two cards. **P11 (done).** The reply
path gate ran end to end on an isolated backend: `associateProspect` role and
stale-version guards, `workspace_paused` resume block then idempotent dispatch,
classify to draft revision to its own `draft_approval` with the worker slot
released before the wait, request-changes redraft with a fresh approval, the
send boundary, deterministic opt-out suppression, and parked state surviving a
backend restart. Reply classification now renders through the shared
`classify_reply` role template (`convex/inbox.ts`); the only residual is a
provider-signed live inbound on the dev deployment. **P19 (done).** Lead CRM
and booking backend: member-scoped list/search/detail reads on the declared
`search_company_name` index, version- and requestId-guarded writes, append-only
`leadEvents`, the five-state booking lifecycle with one active booking per lead
and manual-only confirmation (no calendar sync implied), and booking-linked
drafts revalidated at creation, approval and dispatch (`booking_not_current`).
Exercised with role denials, stale versions, idempotent replays, cursor
pagination, timezone/duration guards and a real `recordSendOutcome` driving a
lead to `booking_proposed`; a real defect was found and fixed (undated leads
sorted into overdue until the lower bound was pinned). **P13 (part A).**
`/inbox` and `/inbox/$conversationId`, one shared Decisions implementation
reused by inbox and mission detail, `?section=` settings with owner-only
marking, and sidebar attention badges - all contract-verified against a seeded
fixture workspace on the dev deployment; the signed-in browser walk awaits an
owner session. A QA lane fixed seven frontend defects (duplicate SVG mask ids,
reduced-motion smooth scroll, settings deep links, sign-in return-to
sanitization, onboarding resume, queue keyboard navigation). The P17 lane
staged the trial pack - invitation, 20-minute script, feedback intake template,
V21 shot list, social draft and submission fields; nobody was contacted and no
validation is claimed.
Evidence: `plan/evidence/P11.md`, `plan/evidence/P19.md`,
`plan/evidence/P13-inbox.md`, `plan/evidence/qa-web.md`, `plan/evidence/P17.md`.

### 2026-09-17 - 0fa89a2

**P13 (done).** `/leads` is the real CRM and the signed-in home: pipeline and
due-action list modes over the declared indexes (plus a new `unscheduled` lens
and bounded `countOverdue`), a five-tab lead detail (record/stage/owner/
next-action/notes, source-backed evidence, append-only event timeline, the
lead's threads, booking), and the full booking lifecycle - propose, proposal
draft through the shared `draft_approval` ask, human-recorded agreement,
reschedule, cancel, outcome - where every write carries a pinned
`expectedVersion` and per-intent `requestId`, and nothing implies calendar
sync. Auth lands on `/leads`; `after_auth_return_to` keeps its same-origin
check. Five bounded backend reads were added where no index could answer the
UI (`conversations.listForProspect`, `missions.listForProspect`,
`decisions.listForDraft`, `prospects.countOverdue`, `prospects.list`
unscheduled) and are pushed to the dev deployment.
Evidence: `plan/evidence/P13-inbox.md`, `plan/evidence/P13-leads.md`.

### 2026-09-17 - 57ff45c

**P14 (pre-pass).** The acceptance card ran its backend-exercisable half ahead
of the credentialed gate: tenancy and role denial, concurrent start/approval
conflicts, the full delivery-uncertainty loop (parked to requesting to
swept-uncertain to reconciled or definitively failed), every send gate, worker
bridge lease/scope/digest and credential-leak refusals, tool-boundary budgets
and URL admission, webhook signature and dedupe, CRM/booking OCC rules, and
payload/limit bounds. One real defect found and fixed: Convex Workflow
serializes thrown errors with stack traces, and those raw strings were stored
in user-facing `outcomeReason`/`failure`/`progressSummary` fields - now one
bounded readable reason line (`convex/lib/validators.ts`). Deferred honestly:
the physical model run, fresh-Box recovery, browser scenarios and Apollo legs
await owner credentials.
Evidence: `plan/evidence/P14.md`.

### 2026-09-17 - 56a9651

**Post-merge audit sweep.** A four-lane review of the last day of commits
(frontend/CRM, Convex call-site contract, worker runtime, hosting/demo) found
real defects, all fixed in focused commits: the overdue due-window rebound
its Convex query args every render and resubscribed in a loop; lead detail
leaked version pins across ids; the owner picker and next-action form opened
blank instead of prefilled (a bare save would have silently unscheduled);
booking surfaces read the oldest send attempt and could lock "record outcome"
forever; booking dialogs kept dismissed state on reopen; list/feed error
boundaries retried stale cursors forever; `?campaign=`/`?mission=` params could
throw inside `v.id` validation; the `?step=review` onboarding link dead-ended;
OAuth sign-in dropped `after_auth_return_to`. Worker side: p21box could never
recover from `down`/`stop` (fixed receipt key replayed a deleted Box), the
hygiene probe reported clean on failure, `start` claimed success before the
daemon proved it stayed up, env files were sourced unsafely, and the p04gate
host watch expired before the widened in-box OAuth budget. On the unmerged
P16 lane, demo workspaces can no longer spend the deployment's ASCII account
(`connect`/`reconnect` refuse `demoMode`), a demo visitor can still create a
real workspace, and `/worker/`/`/agentmail/` GETs can no longer fall through
to the SPA shell. `pnpm lint`, `tsc` (app + convex + worker) and
`pnpm plan check` are all green; plan state unchanged - P21 in progress, P04/
P09/P16/P17 still blocked on owner credentials and publish authorization.
Evidence: `plan/evidence/P16.md` (audit addendum).

### 2026-09-17 - 0834447

**Backend audit follow-through.** The Convex review lane found three defects,
all fixed: the lifecycle reconcile sweep re-drove `accepted` Box operations
at 7 minutes while a healthy create/resume driver legitimately holds its
claim for nearly the ~10-minute action ceiling - the bound is now 12 minutes
and `recordLifecycleOutcome` refuses to regress a terminal op (provider refs
a late driver alone saw still merge). A `delivery_uncertain` ask can now open
on a terminal mission, so a mission cancelled while a send was in flight no
longer wedges the conversation on `missing_replacement_authorization` with no
operator recovery. And the `booking_proposed` history event is keyed per send
attempt instead of per booking, so re-advancing a corrected lead records the
event the row shows.

### 2026-09-17 - 0d81310

**Independent review of the audit fixes.** A four-lane re-review of the
previous sweep confirmed the fixes and surfaced its own round: the decisions
queue's bad-link test matched the `[Request ID]` in every Convex error and
mislabelled real failures (now narrowed to `domainErrorCode`/`isMalformedIdError`
per convex-error.ts's documented convention); the runtime teardown's bounded
`workerRequests` scan read terminal history before live rows and could skip
in-flight requests (now per-state like the controls loop); orphan-stop ops
are keyed per generation so a past `failed` op can't dedupe a revive's
coverage; `resolveDeliveryUncertainty` no longer claims `dispatched` for a
replacement on a terminal mission; `p04gate auth` now actually forwards
`--auth-budget-ms`/`--oauth-timeout-secs` to the in-box probe (the flag
forwarding lived only on an unmerged branch) and boxmcp guards NaN budgets;
`p21box up` treats only a 404 as "box gone" — a transient inspect failure no
longer bills a duplicate Box. On the P16 lane, a demo+real owner now resolves
to the real workspace (there is no switcher) and the tour copy no longer
promises a runtime the demo cannot have. All checks green.
Evidence: code review reports (four read-only lanes).

### 2026-09-18 - 8f1c4d0

**Apollo discovery and enrichment adapter, without a live provider probe.**
Scout and Outreach no longer stop at a deferred OAuth grant. The sales
workflow now runs a Convex-owned company search before branching, and a
one-person enrichment after a lead is qualified, through a closed REST
allowlist (`mixed_companies/search`, `mixed_people/api_search`,
`people/match`). Paid calls reserve `research_searches` or
`apollo_enrichments` before they leave Convex; missing `APOLLO_API_KEY` is
a release; no email is synthesized; qualification evidence is still
required before enrichment. Owner skipped the live Apollo MCP OAuth and
remaining physical Codex E2E. Firecrawl research, AgentMail send, and the
backend P14 pre-pass stay the live-verified halves. Plan: P04, P09, P21
and P14 marked done with that honesty. Convex features: internal actions,
mutations, durable workflows (`convex/integrations/apollo.ts`,
`convex/workflows/sales.ts`).
Evidence: `plan/evidence/P09.md`.

### 2026-09-18 - debdb83

**Static hosting prep landed on main.** The Vite `dist` can now be served
from Convex static hosting with app-owned root routing: worker, AgentMail
and Firecrawl HTTP paths stay reserved, GET on those namespaces no longer
falls through to the SPA shell, and a flag-gated `/tour` read model is in
place. `@convex-dev/static-hosting@0.2.1` is registered. Nothing was
published; a live `convex.site` URL still needs owner authorization.
Optional schedule/follow-up (P15) was skipped as stretch so it cannot
delay release. Components: @convex-dev/static-hosting.
Evidence: `plan/evidence/P16.md`.

### 2026-09-18 - 5da0bd1

**Public site is live on Convex static hosting.** Pushed the backend
(including the `staticHosting` component) to
`dev:flexible-grasshopper-949` and uploaded 135 Vite `dist` files.
`https://flexible-grasshopper-949.convex.site` serves the SPA; `/leads`
falls back to `index.html`; missing `.js` assets 404; `GET /worker/claim`
returns 405 JSON and an unsigned AgentMail/Firecrawl webhook returns 401.
No separate production deployment was created. Demo tour/execution flags
stay off. Components: @convex-dev/static-hosting.
Evidence: `plan/evidence/P16.md`.

### 2026-09-18 - e5a428e

**Production Convex static hosting.** Ran `pnpm run deploy` against
`prod:proficient-porcupine-63`. Backend and 135 Vite files are on
`https://proficient-porcupine-63.convex.site`. Smoke: `/` `/leads`
`/sign-in` 200 HTML; missing `.js` 404; `GET /worker/claim` 405 JSON;
unsigned AgentMail and Firecrawl webhooks 401. The earlier
flexible-grasshopper development host is still up as staging. Hexclave
allowed origins and the AgentMail webhook URL still need the production
site origin. Components: @convex-dev/static-hosting.
Evidence: `plan/evidence/P16.md`.

### 2026-09-20 - cb89124

**Wave 0 of the OpenIntent rebuild: foundation.** Verification spikes first
(`plan/spikes.md`): the Convex AI Gateway answered from a dev action once the
team plan allowed it, 35 OpenAI model ids are served, and schema-constrained
output works through `@convex-dev/ai-sdk-provider` only from `0.2.0-alpha.1`
(the stable `0.1.0` downgrades to JSON mode and is rejected upstream). Real
lead-data counts came back for every signal kind the plan relies on, and the
provider turned out to validate filters inconsistently (one bad enum is a 400,
another silently counts zero), so every filter value is re-checked against a
cached allow-list server-side.

Then the code: the final data model in one pass — `agents` replaces
`campaigns`, leads become person-level with `origin` and `research` unions so
a score exists only on a researched lead (`convex/schema.ts`,
`convex/lib/validators/`); the backend regrouped by domain with thin functions
over a model layer (`convex/{workspaces,billing,company,agents,leads,outreach,inbox,bookings,activity}/`);
clean-slate migration tooling on `@convex-dev/migrations` with a truthful log
of what happened on dev (`convex/migrations/`, `plan/migration-log.md`);
credits and spend safety — one `withCredits` wrapper that reserves credits,
per-workspace provider caps and a platform-wide budget in a single
transaction and settles to one of three outcomes (billed, refunded,
uncertain), a kill switch, trial grant with the workspace, verified-email and
trial-capacity gates, per-user token buckets on `@convex-dev/rate-limiter`
(`convex/billing/`, `convex/lib/limits.ts`, `convex/lib/rateLimits.ts`); the AI
foundation — `runStructured` derives a strict JSON Schema from a Convex
validator, calls the gateway model, re-validates the object with the same
validator and bills exactly what was attempted (`convex/ai/`); and the new app
shell, route map, guards, theme tokens and a data-free UI kit
(`src/routes/`, `src/components/layout/`, `src/components/kit/`, `src/index.css`).

Verified: lint, both typechecks and the production build pass on `main`; the
dev deployment runs this code; the read-only migration checks ran on dev. Not
yet verified: the ledger's scripted run, the AI health check and the shell
click-through all need a signed-in workspace on dev, and are listed in
`plan/followups.md`. Components: @convex-dev/migrations,
@convex-dev/rate-limiter.
