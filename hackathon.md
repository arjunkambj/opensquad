# Hackathon log

- **Project:** OpenSquad
- **Event:** Convex All Gas Hackathon
- **What it does:** A squad of AI employees that handles sales research and outreach, with a built-in CRM to track leads, conversations, and next steps.
- **Live app:** not deployed
- **Repo:** https://github.com/arjunkambj/opensquad
- **Frontend:** not deployed
- **Convex deployment:** not deployed
- **Components:** @agentmail/convex, @firecrawl/firecrawl-convex, @convex-dev/workflow
- **Convex features:** schema, indexes, queries, mutations, HTTP actions, internal mutations/actions, durable workflows
- **Auth:** Other
- **AI models:** none
- **Started:** 2026-09-13T12:00:25Z
- **Last updated:** 2026-09-14T10:56:20Z

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
pushed to dev:flexible-grasshopper-949 — §4.3/§4.4 tables, /worker/* routes,
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
