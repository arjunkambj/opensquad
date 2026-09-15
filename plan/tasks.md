# Work packages

Each card is an executable assignment for a developer or coding agent. Status,
dependencies and evidence live in [tasks.json](tasks.json); run `pnpm plan show
PXX` before starting. Paths named below are proposed implementation destinations
unless already present. A missing proposed file is work to do, not a setup error.

## Common execution contract

For every card: read `AGENTS.md`, use `opensquad-build`, inspect current source,
receive an owned worktree assignment, implement the listed slice, exercise its
manual gate and save task-specific evidence. The integrator reviews/merges,
updates canonical task status and updates `hackathon.md` using its skill. Follow
[worktrees.md](worktrees.md) for parallel execution and isolated backends. Read
[architecture.md](architecture.md) for exact domain/API contracts,
[integrations.md](integrations.md) for provider protocols and
[verification.md](verification.md) for V-scenarios. No test files.

Task numbers are identifiers, not an execution order: P20 must precede P21, P19
and the P11 lead association; P21 and P19 must precede P13. P09 carries the Apollo
grant alone, so only P14 waits on it.
Early probes accept only the explicitly named gate portions below. Full G1/G2/G3
and V-scenarios remain acceptance work for P07/P21/P09/P11/P13/P14; a later UI or
business-control requirement cannot silently become a prerequisite of its own
provider spike. Record the passed subset and its later owning task as evidence.
The authoritative auth helper is `convex/lib/auth.ts`; runtime API exports live
in `convex/runtimeConnections.ts`. Consumers use those generated references.

Honor existing session authorization. Ordinary implementation does not require
repeated permission. A provider probe uses its already authorized accounts,
controlled recipient and bounded allowance; if an external action remains
unauthorized, prepare its concrete inputs/artifact and ask only for that missing
authorization. A planning request alone performs none of those external actions.

Use these commands only at the appropriate stage:

```bash
# Fresh checkout; dependencies must match the committed lockfile.
pnpm install --frozen-lockfile

# Ordinary local checks.
pnpm lint
pnpm build
pnpm plan check

# Backend work: targets the selected DEVELOPMENT deployment and changes it.
pnpm exec convex dev --once --typecheck enable
pnpm exec tsc --noEmit -p convex/tsconfig.json

# Development, separate terminals after deployment configuration is correct.
pnpm exec convex dev
pnpm dev
```

Do not run backend deployment commands merely to review this plan. Do not
reconfigure an existing deployment as anonymous or production to make a check
pass. `pnpm build` covers the frontend; the separate Convex check matters once
backend code exists. Future worker commands must be added and documented by
P07; they are not available in today's package scripts.

## P00 — Package and validate this handoff

Dependencies: none.

Owner: planner. Deliver the root instructions, portable build skill, technical
specifications, task DAG and read-only plan helper. Reconcile the two source
documents with the user's ASCII/Codex direction. Preserve the existing ignored
docs and app implementation. Run plan validation, skill validation, existing
lint/build and whitespace checks. Record actual outcomes, including baseline
warnings. Gate: another executor can locate every contract and print P01.
This task marks planning complete; it marks no product milestone complete.

## P01 — Resolve access, environment and version prerequisites

Dependencies: P00. Suggested owner: integration lead.
Skills: `opensquad-build`, `openai-docs`, `convex:env` when available.

1. Follow the integration runbook's prerequisite/secret-destination matrix.
   Confirm the intended development Convex project and Hexclave project without
   printing private environment files. Verify frontend login, JWT audience and
   actual identity claims; leave schema authorization implementation to P02.
2. Inventory usable ASCII, Codex, Apollo, Firecrawl and AgentMail access. Record
   account capability/status and supported versions, never credentials. An app
   connector on the builder's desktop is not runtime access.
3. Add a tracked `.env.example` with names/placeholders only and a runtime config
   example containing no secrets. Document how the owner supplies each credential
   using provider dashboards/secret settings. No provider secret may use `VITE_*`.
4. Verify exact component versions/peer compatibility, pick a pinned Codex/Node
   runtime image, and add `plan/evidence/P01.md` with commands and resolved results.
   Confirm a controlled sender/recipient pair and a bounded paid-use allowance
   before any resource creation, enrichment or email probe.

Files: `.env.example`, `plan/evidence/P01.md`, runtime config example under
`worker/` only when its shape is known. Gate: V01 configuration inventory is
complete and the intended Convex/Hexclave development setup is usable. Record
each G1–G4 provider prerequisite as usable or unavailable, without calling a
missing account verified. P01 may finish its inventory while P03/P04/P05 remain
blocked on their specific accounts; those blockers do not prevent ready P02
work. Actual login, provision and paid-operation proofs belong to those cards.

## P02 — Establish app auth, workspace records and schema

Dependencies: P01. Owner: backend.
Skills: Convex expert; Hexclave concepts adapted to `@hexclave/react`.

1. Implement the schema/index contract incrementally: identity/membership,
   workspace/business profile, employees, campaigns and operational tables.
   Keep component-owned mail/crawl tables out of the custom schema.
2. Add typed identity/membership/role guards in `convex/lib/auth.ts`, shared
   domain validators and bounded query helpers. Use actual verified JWT claims,
   never a browser-supplied user identity or assumed Hexclave team selection.
3. Implement idempotent workspace creation with owner membership and the three
   employee templates in one transaction. Add current-workspace reads and
   membership role checks. Membership management is owner-only; do not send
   invitation emails as a hidden setup side effect.
4. Add business profile and employee read/update mutations; version instructions.
   Validate foreign keys belong to the authenticated workspace on every path.
5. Implement campaign `create`, `get`, indexed `list`, `confirmSourcePlan` and
   `setState` now, including source/filter validation, 1–5 lead cap, enrichment
   allowance, version conflicts and immutable confirmed-scope metadata. These
   are the real APIs consumed by P08; P21 adds execution rather than creating
   a second campaign setup implementation.

Files: `convex/schema.ts`, `convex/lib/{auth,validators}.ts`,
`convex/{workspaces,businessProfiles,employees,campaigns}.ts`, existing auth/client
files only if verification reveals a real issue. Gate: backend checks, V02's
workspace/role and current-record API isolation checks, and V03's saved campaign
configuration/validation portion. Exercise downstream mission/draft/inbox IDs
when their modules ship and repeat full V02 in P14. Handoff: generated API types and
sanitized identity-contract evidence; no real tokens/claims containing PII.

## P03 — Prove ASCII sandbox and Codex login/run lifecycle

Dependencies: P01. Owner: runtime.
Skills: OpenAI Docs; use G1 in `integrations.md`.

1. Provision one disposable, authorized development Box with the pinned image;
   start Codex App Server as a child process using stdio. Keep its transport
   private. Generate protocol types from the exact installed Codex version.
2. Exercise initialize → account state → managed device-code login → successful
   completion → one bounded model turn → structured result. The workspace owner
   performs the provider login. Record safe status and runtime receipts only.
3. Pause/stop and resume according to actual ASCII SDK semantics; restart the
   worker/App Server and resume saved session state. Verify credentials/files
   survive only in that workspace's isolated storage as expected.
4. Exercise login cancel/expiry, account disconnect, usage exhaustion and second
   workspace isolation. Verify supported host/tool policy can prohibit send and
   arbitrary credential/network access. Record provider constraints honestly.

Files: bounded spike under `worker/` plus `plan/evidence/P03.md`; no guessed SDK
calls or real credentials in fixtures. Gate: G1's create/idempotency, protected
credentials, login, short turn and filesystem/service/thread resume probes;
V04's isolated connection portion, observed through safe diagnostic status.
P03 does not require the app UI or production lease bridge: G1 assignment expiry,
V05/V06 and generation replacement belong to P07, connection UI to P13.
A real authorized Codex turn in ASCII must survive a restart path. If unavailable,
record the reason and request a concrete runtime choice while other work proceeds.
Do not substitute builder credentials, external token injection or API inference.

## P04 — Prove Apollo discovery and Firecrawl research

Dependencies: P03. Owner: integrations.
Skills: Convex HTTP actions/file storage as needed; G2 in integration runbook.

1. In P03's isolated diagnostic environment, configure the supported Apollo MCP
   connection and complete its OAuth. Enumerate exact tool schemas and exercise
   only the explicitly selected read/search/enrichment capabilities. The raw
   diagnostic connection is never the customer employee tool configuration.
2. Discover one agency-fit company by campaign criteria. Run Firecrawl through
   the chosen component/backend route for one public page; save one defensible
   observation, source URL and retrieval time.
3. Record the qualification observation first; use the probe's one-operation
   enrichment allowance to retrieve a relevant business contact. Preserve
   provider status or “Contact needed”; never synthesize an address. Save sanitized
   probe receipts, not pretend production prospect/usage records.
4. Inspect the enforceable allowlist, OAuth refresh/callback route and duplicate
   paid-operation behavior; document gateway constraints for P07/P21. Remove the
   diagnostic raw connection from the employee image. Keep YC/TrustMRR disabled.

Files: research adapter spike, component registration only for selected route,
`plan/evidence/P04.md`. Gate: G2's provider access, actual schemas, one company,
one component-backed website result, one contact-or-unknown and reconnection
probes pass. P04 depends only on P03 and uses an internal diagnostic adapter;
it does not require P02/P07 production records. The scoped gateway, atomic quota
reservations, no-bypass policy and persisted multi-workspace G2 checks belong to
P07/P21, then full P14. No email send occurs. Handoff: capability IDs, output
schemas, provider facts and source limits; do not call the production gate passed.

## P05 — Prove AgentMail transport and webhook behavior

Dependencies: P01. Owner: mail/backend.
Skills: Convex HTTP actions; G3 in integration runbook.

1. Pin and inspect the AgentMail component and API behavior. Configure a single
   development inbox and signed webhook endpoint. Save a diagnostic inbox
   reference; production workspace ownership/permission mapping lands in P10/P11.
2. Use the selected narrow one-attempt adapter for an explicitly authorized
   controlled email probe with provider idempotency. Confirm actual receipt and
   reply, immutable provider IDs, event signatures and duplicate event behavior.
3. Demonstrate duplicate request semantics, delayed response/uncertain outcome
   handling and documented reconciliation. Inspect component cancellation/retries
   so no second retrying send path remains active.
4. Keep the route inaccessible for arbitrary public sends. Remove any temporary
   probe sending capability before merging. Store sanitized receipts, not inbox
   addresses or private message bodies, in `plan/evidence/P05.md`.

Files: `convex/integrations/agentmail.ts`, `convex/http.ts`, component config,
development-only diagnostic procedure. Gate: G3's transport-only subset: inbox
idempotency, raw-body signature rejection, authorized controlled send/receipt/reply,
same-request send idempotency and duplicate/delayed provider event observation.
Record the exact probe payload as the builder-authorized controlled message.
G3's application approval/freshness/suppression checks belong to P10, ownership
and response-draft handling to P11, and complete UI to P13. P05 does not depend
on those later services and must not claim their acceptance from this spike.

## P06 — Build durable missions, runs and required decisions

Dependencies: P02. Owner: workflow/backend.
Skills: Convex expert + Workflow.

1. Register Workflow, implement mission create/pause/cancel/archive and indexed
   board/detail/activity reads. Store its workflow reference on a mission.
2. Build one minimal workflow: validated stage output → decision → durable event
   wait → persisted continuation. Use a clearly labeled development fixture only
   for this machinery gate; it is not AI integration evidence.
3. Implement state mapping from the spec, transactional resolution of required
   asks, deduped events, stage/run receipts and independent prospect branches.
   Define terminal parent outcomes including partial/contact-needed/skipped work.
4. Check concurrent decision resolution and reload: completed stages must not
   run again, and comments cannot resolve a business approval.

Files: `convex/{missions,decisions,activity,runs}.ts`,
`convex/workflows/`, shared validators. Gate: backend checks, V08 backend state
mapping and V13 missing-information wait/reload/duplicate-resolution subset using
the declared fixture. Exact draft conflicts land in P10; worker restart in P07;
UI rendering in P12/P13. Handoff: stable API references
for bridge and board developers. Workflow event delivery is transactional with
the accepted completion/decision or recoverable from the recorded pending event.

## P07 — Implement the production-shaped external worker bridge

Dependencies: P03, P06. Owner: runtime/backend.
Skills: Convex HTTP actions + Workflow + OpenAI Docs.

1. Implement scoped runtime credentials, authenticated claim/heartbeat/result/
   failure operations, generation checks and workspace model-slot acquisition.
   Keep only external execution transport state; Workflow owns stage retries.
2. Replace the spike with a typed worker under `worker/src/`: ASCII adapter,
   App Server transport client, allowed tool router, structured-output validator,
   receipt forwarding and job-scoped working directories. Generate protocol
   types with the pinned binary; never mix handwritten guesses with SDK output.
3. Implement provision/resume/disconnect/stop lifecycle and narrow owner-visible
   connection queries. Persist thread/run references. Model slots are released
   during human waits. Stop or confirm interruption of an old turn before a
   replacement can execute after lease expiry.
4. Add runnable `worker:build`/`worker:dev` scripts and a documented image startup
   command. Add worker typechecking to the build gate without writing tests.
   Document staging replay/fault commands for V05/V06/V18; diagnostics must be
   developer-owned and impossible to invoke in the public demo.

Files: `worker/`, `convex/{runtimeConnections,workerBridge,workerOperations}.ts`,
HTTP routes and workflow external-step adapter; manifest/config by assigned
integrator. Gate: remaining G1 bridge/recovery checks, V04–V07 runtime portions,
backend and worker checks. Implement the filtered tool router/capability transport
here; it was not delivered and P21 now owns it, with P09 supplying real
qualification and atomic provider-allowance operations before full G2 acceptance. Observe runtime results with diagnostics until P13
finishes the connection UI. No administrator key or AgentMail credential may
be available in a Box.

## P08 — Onboarding, employees and integration settings

Dependencies: P02. Owner: frontend with backend support.
Skills: shadcn; respect current Base UI/Hugeicons styles.

1. Add onboarding for business website, offer, audience, tone, exclusions,
   timezone and campaign scope. Render the interpreted source, filters, prospect
   cap, enrichment allowance and send policy for confirmation before any run.
2. Add three employee cards/forms for names and versioned instructions. Show
   actual idle/busy/blocked/disconnected status; tool allowlists remain backend
   policy. Keep authorization independent of prompt edits.
3. Add Settings sections for integrations, Codex connection, sending window,
   limits, pause and roles. Consume the runtime endpoints once P07 lands; show
   pending/unavailable until then, never simulated connection success.
4. Add `/employees`; change `/squads` to a typed redirect. Retain the current
   `/overview` sign-in destination temporarily; P13 changes it to `/leads` only
   when the functional CRM route is ready. Create shared state components as needed.

Files: `src/routes/_dashboard/`, `src/components/{onboarding,employees,settings}/`,
sidebar constants and profile queries. Gate: frontend checks, V03's campaign
form/persistence/validation subset against P02 APIs, and V11's setup empty/loading
states. Research execution belongs to P21 and Apollo sourcing to P09; V04's
functioning runtime
controls and complete provider error recovery are accepted in P13 after P07.

## P20 — Declare the lead, booking and evidence schema contract

Dependencies: P02. Owner: CRM/backend.
Skills: Convex expert.

1. Declare the §4.3 `prospects`, `leadEvents`, `bookings` and `evidence` tables in
   `convex/schema.ts` exactly as the architecture specifies them, with every listed
   index. This card is the single declaration site: P21, P09, P11 and P19 all write
   these rows, and none of them may redefine a table or open a second lead store.
2. Add the matching domain unions and shared validators to `convex/lib/validators.ts`:
   `salesStage`, `qualification`, the bounded `sourceRefs` and `contact` shapes, the
   `leadEvents` kind/actor unions and the `bookings.proposal` discriminated union.
   Reuse the existing bounded-string and version helpers rather than starting a
   parallel validation style.
3. Add `prospects.search_company_name` with `searchField: companyName` and
   `filterFields: [workspaceId, salesStage, campaignId, ownerIdentityKey]`, and
   `bookings.by_prospectId_and_state` for the at-most-one-active check. Declare an
   index only where the specification names it; P19 adds another before enabling a
   further filter combination.
4. Retype the forward references that were left as bounded strings pending these
   tables, per site and deliberately. An internally produced reference becomes an
   `Id`; an externally supplied one — worker-bridge payloads, the `x-prospect-id`
   header — stays a validated string. Record which sites you changed and why.

Files: `convex/schema.ts`, `convex/lib/validators.ts`, `plan/evidence/P20.md`.
Gate: the schema pushes cleanly, existing lint/typecheck/build pass, and every
§4.3 field and index named in this card exists under the specified name. No
business mutation belongs here — that behavior is P19's and those writers are
P21's and P09's. Handoff: the declared tables plus the validator names that P11,
P19 and P21 import.

## P21 — Execute the sales pipeline and source-backed research

Dependencies: P07, P08, P20. Owner: pipeline/backend.
Skills: Workflow + Convex expert + file storage.

1. Replace the dev fixture with the real mission workflow in
   `convex/workflows/sales.ts`: confirmed campaign → prospect branches →
   Researcher evidence → fit decision → Outreach draft proposal. Pass persisted IDs
   between steps and bound every operation. Company discovery and contact
   enrichment are Apollo stages owned by P09; this card defines the stage seams
   they plug into and must run end to end on prospects from an operator-confirmed
   or already-persisted source.
2. Implement the filtered tool router and capability transport that P07's card
   named and did not deliver. Restrict tools at the host and backend, treat every
   website and email string as data, and carry the capability set on the worker
   request envelope instead of trusting a model-supplied request.
3. Implement the three role instruction templates and their typed output contracts,
   and persist concise briefs as `evidence` rows with optional storage blobs.
   Enforce candidate, tool and page caps, and deduplicate by canonical domain with
   retained provenance.
4. Support partial success, rejected leads and missing contacts. Preserve each
   branch's terminal reason and return safe retry/attention actions. Independent
   per-prospect branches share the one-model-run slot: serialize model work, never
   human waits, and one prospect's pending decision must not stop siblings from
   reaching drafts.

Files: `convex/{prospects,evidence}.ts`, `convex/workflows/sales.ts`,
`convex/integrations/firecrawl.ts`, `worker/src/`, role templates,
`plan/evidence/P21.md`.
Gate: the G2 capability/budget boundary, the V03/V07/V12 research portions and
V14's independent draft/contact-needed/partial-result branches, exercised against
the real Firecrawl integration with backend receipts. Apollo-sourced discovery and
enrichment are explicitly out of scope and complete in P09. Acceptance does not
require P10 send or P13 UI. No auto-send tool is introduced.

## P09 — Add Apollo discovery and contact enrichment

Dependencies: P04, P21. Owner: pipeline/backend.
Skills: Workflow + Convex expert.

1. Plug Apollo company discovery into P21's Scout stage and Apollo contact
   enrichment into its qualified-contact stage. Do not restructure the workflow,
   redefine a §4.3 table or open a second lead store — P20 owns the schema and P21
   owns the stage seams.
2. Enforce up to five accepted prospects, candidate caps and paid enrichment
   reservations through the existing usage boundary. Deduplicate by canonical
   domain and provider identity, retain provenance, and distinguish revenue metric,
   currency and period where one is used.
3. Handle exhausted credit and missing contacts honestly: a qualified prospect with
   no reusable valid contact becomes `contact_needed` with a clear next action, and
   never a manufactured address.

Files: `convex/integrations/apollo.ts`, `convex/prospects.ts`,
`convex/workflows/sales.ts`, `plan/evidence/P09.md`.
Gate: the Apollo half of G2 — real discovery plus one bounded enrichment through
the controlled capability, with backend receipts. This is the only card that needs
the P04 OAuth grant; every other pipeline behavior is accepted in P21. Handoff:
real sourced prospects and contact facts written to the P20 tables.

## P10 — Exact drafts, approval and safe sending

Dependencies: P05, P06. Owner: mail/backend.
Skills: Convex expert + HTTP actions + Workflow.

1. Add immutable draft revisions, exact normalized recipient/subject/body and
   evidence links; approvals bind the revision and conversation version. Distinct
   approve/request-changes/reject operations enforce roles and expected versions.
2. Implement send-intent reservation and immediate final preflight: active
   campaign/workspace, current approval, no new reply/takeover/suppression,
   sending window/limit, no successful attempt for that revision and no unresolved
   attempt in the conversation across revisions. A replacement requires the
   recorded delivery-uncertain decision described in the architecture.
3. Execute the one-attempt AgentMail action outside the worker. Record durable
   intent before network I/O and provider references afterward. Disable blind
   Workflow/component send retries. Reconcile uncertain requests with the same
   supported idempotency identity; expired ambiguity needs human attention.
4. Add definitely-unsent/rejected/uncertain UI result codes, atomic allowance
   accounting, approval invalidation and a documented point where dispatch is
   committed. A reply after the provider accepts mail cannot retract it.

Files: `convex/{drafts,approvals,sendAttempts,suppressions}.ts`,
`convex/integrations/agentmail.ts`, workflow send boundary. Gate: G3's exact-draft
approval/preflight/send subset, V13 draft conflicts, V15 outbound and V18 backend
uncertainty/reconciliation through an internal controlled diagnostic procedure.
Exercise V17 preflight against staged conversation versions/takeover/suppression
facts; real inbound-driven invalidation and takeover APIs belong to P11. Full
V15/V17 UI arrives in P13. Concurrent approvals create one logical attempt.
Use verification-mail authorization already present; app approval does not
independently authorize a builder to contact real prospects.

## P11 — Shared inbox, replies and conversation ownership

Dependencies: P07, P10. Owner: mail/backend.
Skills: HTTP actions + Convex expert + Workflow.

1. Ingest signed AgentMail events through the selected component; map inbox and
   provider thread IDs to workspace/conversation and dedupe application effects.
   Unmatched valid mail stays in a workspace-scoped unassigned queue under human
   takeover, without reply workflows/drafts/sends. Add versioned `associateProspect`
   for an owner/operator to link an existing same-workspace lead/campaign; keep
   takeover until explicit resume and normal policy checks pass.
2. Persist ownership/internal notes/takeover state, increment conversation
   version on incoming replies, invalidate stale approvals and cancel pending
   follow-ups before scheduling model work. Enforce immediate explicit opt-out
   suppression; unclear cases stop automation pending review.
3. Start a linked reply workflow; classify interested/question/not-now/not-
   interested/unsubscribe/automated/needs-review and create a response draft.
   Every external response still needs its own exact approval.
4. Add thread-list/detail queries using component references, delivery receipts,
   assignments, human takeover/resume/close and internal-note mutations. Avoid a
   second independent message/transport database.

Files: `convex/{conversations,inbox,webhooks}.ts`,
`convex/workflows/reply.ts`, AgentMail adapter hooks. Gate: remaining G3 backend
ownership/inbound/reply-drafting checks and V15–V18 backend portions with signed
duplicate/out-of-order events. Use authenticated API calls/Convex subscriptions
for the two-session persistence check; P13 owns the rendered inbox/decision UI.

## P12 — Mission Control board and addressable detail

Dependencies: P06, P08. Owner: frontend.
Skills: shadcn.

1. Replace Overview's empty activity card with the four-column live board,
   campaign filter, New mission, required-decision count and recent activity.
   Keep the date picker for historical receipts/activity, not unfinished work.
2. Show accurate outcome, owner, priority, current step, freshness and counts.
   Apply the spec's failed/paused/cancelled mapping; do not call failure approval.
3. Build a reloadable mission detail route with output, evidence, decisions,
   comments, run receipts, next action and linked prospect. Preserve campaign
   filter in URL/back navigation. Add archive/restore only; trash is deferred.
4. Implement keyboard/focus flow and narrow-screen column/detail navigation.

Files: existing `OverviewDashboard`, `src/components/{missions,decisions,activity}/`,
dashboard route files. Gate: V08–V11 against real Convex records, not static
arrays, limited to the board, mission detail, general empty/error and keyboard
flows. P13 completes draft/inbox/CRM links and full related scenarios. Avoid a
second board state store. `/overview` is the execution surface supporting Leads.

## P13 — Connect the Leads CRM, booking and supervision UI

Dependencies: P11, P12, P19, P21. Owner: frontend/integrator.
Skills: shadcn; review auth of every new query.

1. Build `/leads` as the working CRM home: pipeline/list and due-action modes,
   supported indexed owner/stage/campaign filters, company-name search,
   pagination, due next actions,
   detail links, source/qualification/contact facts, notes and append-only history.
   Show every stage through booking and explicit won/lost; prevent misleading
   automatic stage regression. Use P19 APIs and the existing `prospects` records.
2. Add booking proposal forms for a link or up to three timezone-explicit slots,
   exact-approved email linkage, human confirmation with the agreed start/end,
   timezone and supporting basis, reschedule/cancel/completed/no-show controls.
   Show proposed versus confirmed accurately; do not imply calendar synchronization.
3. Add inbox list filters, thread history, ownership/internal notes/takeover,
   unassigned lead association and explicit resume, and one shared Decisions
   implementation with exact preview,
   evidence, revision conflicts, request changes and rejection reasons. Render
   safe message content; no raw HTML injection, tracking-image loads or optimistic
   “sent”. Reuse lead/evidence/decision sections across CRM, inbox and missions.
4. Finish real runtime/provider connection controls and role-aware actions for
   owner/operator/viewer. Only after `/leads` works, update `afterSignIn` and
   `afterSignUp` in `src/hexclave/client.ts` and the existing signed-in redirect
   in `src/routes/sign-in.tsx`. Keep `/overview` as linked Mission Control;
   optionally redirect `/prospects` to `/leads` rather than duplicating the CRM.
5. Align sidebar and landing copy around search/research → outreach → booking
   with a lead manager. Walk the complete flow in two sessions, including mobile,
   stale revisions, uncertainty, next actions and a human-confirmed meeting.

Files: `src/components/{leads,prospects,bookings,inbox,decisions,settings}/`,
dashboard/lead-detail routes, `src/hexclave/client.ts`, `src/routes/sign-in.tsx`,
sidebar, marketing index/navbar and missing bounded read models. Gate: V03–V04
UI, V08–V18 applicable and V23–V24; deferred UI portions from early tasks now pass.
Handoff: complete visible CRM/conversation/booking flow, with error and uncertainty
recovery accessible without developer tools.

## P14 — Recovery, budget enforcement and full acceptance

Dependencies: P09, P13. Owner: independent reviewer + implementers.
Skills: Convex reviewer, relevant runtime/HTTP skills.

1. Run V01–V19 and V23–V24 applicable core scenarios, including direct tenant attacks,
   stale worker results, two simultaneous starts/approvals, invalid/duplicate
   webhook, lost model session, delivery uncertainty, explicit opt-out, CRM stage
   conflicts, overdue next actions and evidence-based booking transitions.
2. Verify one physical model run per workspace by interrupt/stop confirmation,
   not merely a lease timeout. Verify quotas at tool/send boundaries and safe
   refusal when an integration cannot enforce them.
3. Exercise startup/recovery from a fresh worker image; ensure credentials never
   enter public queries, artifacts, errors or logs. Inspect huge payloads and
   bounded indexes/pagination against the spec.
4. Fix observed failures, run affected scenarios and existing checks, record
   `plan/evidence/P14.md`. Freeze core scope once the controlled full round trip
   plus CRM/booking and recovery gates pass. No early probe subset may substitute
   for its deferred integrated gate. Do not add a test suite during this review.

Gate: no unresolved critical core acceptance failure. Mark optional source,
schedule/audit and trash behavior omitted, not failed core. Record pre-existing
build/lint warnings distinctly from newly introduced issues.

## P15 — Optional: one schedule or follow-up

Dependencies: P14. Owner: backend; stretch, never a release prerequisite.

Choose one: recurring discovery **or** one suggested follow-up after the first
conversation. Recurring discovery stores timezone/cadence/version/next occurrence
and atomically dedupes an occurrence before starting Workflow. Follow-up stores
conversation version and an exact new approval; reply/takeover/suppression/pause
make it obsolete. Convex owns cadence; no Codex/ASCII cron. Use one scheduler
path, implement edit/pause/run-now and label running-cancel separately. Validate
DST policy for supported local-time zones. Gate: V19 plus V17 where applicable.
If this optional scope is not selected, mark skipped with reason. Audit screenshots/PDFs remain deferred.

## P16 — Prepare and publish the constrained public app

Dependencies: P14. Owner: release integrator.
Skills: Convex expert/HTTP + hosting integration instructions; no Sites migration.

1. Follow G4: add/pin `@convex-dev/static-hosting`, run its setup in a reviewed
   branch, merge its generated routes/config with worker and mail endpoints, and
   review the generated deployment script before using it. Serve Vite `dist`.
2. Build a public sanitized read-only tour and an opt-in isolated execution flow.
   The execution mode uses the user's own connected sandbox; if a separate
   API-funded demo is needed, obtain that explicit product/funding decision first.
   Enforce demo quotas, recipient allowlist and owner-approved live execution.
3. Prepare production secret destinations, callback URLs, Hexclave allowed
   origins, component registrations, deployment selection, worker image version,
   release/rollback commands and last-known-good artifact. Verify app routing
   cannot swallow webhook/bridge HTTP paths.
4. Present the concrete release artifact/target if publishing is not already
   authorized, then deploy after that authorization. Recheck routes directly
   (`/leads`, lead/booking detail, `/overview`, sign-in/handler, mission detail),
   webhook signature behavior, asset loading and owner login on the public host.

Files: deployment/component config, public tour/read models, release procedure
and `plan/evidence/P16.md`. Gate: V20 and live `.convex.site` URL from a fresh
browser without an invite. A default Convex HTTP URL without uploaded assets is
not a deployed frontend. If shipping P15, include its changed acceptance in release.

## P17 — Agency trial, corrections and video

Dependencies: P16. Owner: product/release.

Prepare a concise invitation for a real agency user and send only within existing
outreach authorization. Have them complete lead search/research, CRM ownership
and status updates, reviewed outreach, inbox reply and proposed/confirmed booking;
record consented, sanitized observations, then fix actual blockers. Do not invent a
testimonial or claim user validation without participation. Record V21's 2:50
demo with real controlled send/reply receipts, a lead's next action and a clearly
labeled controlled meeting confirmation. Label prepared work honestly.
Prepare a fallback clip for provider latency and a concise social post for
review. Publish/share only when authorized. Gate: usable video under three
minutes, honest feedback evidence (or clearly documented external blocker),
release still working after fixes. Files: `plan/evidence/P17.md`, linked media
and social draft; keep large binary recordings outside source control.

## P18 — Final submission and handoff

Dependencies: P17. Owner: project owner/release.

Recheck the official event page, root log, public repository visibility, live
host, sponsor behavior, video length and social links using V22. Update factual
deployment/component/model fields in `hackathon.md` with its skill; add no PII
or speculative implementation claims. Prepare exact submission fields in
`plan/evidence/submission.md`. Obtain only still-missing publication/submission
authorization, submit through the official form, and record the receipt/time.
Do not mark done for a prepared-but-unsubmitted packet. Preserve a short
operations handoff: pause all work, revoke a Box credential, reconnect account,
reconcile mail, inspect failed Workflow, and roll back release. Gate: confirmed
submission receipt before the published deadline and an independently usable app.

## P19 — Lead CRM and booking backend

Dependencies: P11, P20. Owner: CRM/backend.
Skills: Convex expert + HTTP actions/Workflow where the existing send flow is used.
This is core and must land before P13; its higher number does not make it later
than release. P20 declares the tables and P21/P09 write pipeline rows to them;
this card adds behavior only, and coordinates `convex/prospects.ts` with P21.

1. Implement the CRM contract on P20's `prospects` table, without a second lead
   database:
   active-member `ownerIdentityKey`, full `salesStage`, reason/version, dated next
   action and contacted/replied timestamps. Implement indexed `list`/`getDetail`,
   `updateStage`, `assign`, `setNextAction` and `addNote` using expected versions,
   idempotent operation keys and owner/operator/viewer policy. Support only filter
   combinations backed by indexes; add an index before enabling another combination.
   Add `search` backed by the company-name search index specified in the architecture,
   with workspace equality scoping, supported filters and relevance pagination.
2. Add `leadEvents` as append-only ownership/status/note/next-action/booking
   history. Make each business update and its event atomic. Derive automatic
   CRM transitions from accepted research, send and reply facts; a later scrape
   must not regress contacted/booked/won/lost leads. Human corrections require
   a reason. Won/lost are explicit business decisions, never inferred from mail
   acceptance or a booked meeting. Preserve previous state and actor/source/time.
3. Add `bookings` with `proposed|confirmed|cancelled|completed|no_show`, version,
   lead/owner/conversation references and the architecture's typed proposal:
   booking link or at most three future intervals with IANA timezone. Implement
   `propose`, `get`, indexed `list`, `confirm`, `reschedule`, `cancel` and
   `recordOutcome`. Reuse P10/P11 draft approval/send functions for any external
   proposal, revised times or scheduling response; no separate send capability.
4. Require an authorized human to confirm the actual agreed start/end/timezone
   and a short supporting basis, storing confirmer/time and genuine available
   evidence references. A sent link, model suggestion or ambiguous reply remains
   proposed. Validate invalid/ambiguous local times explicitly. Use provider
   confirmation/event IDs only after an optional calendar connector is verified;
   manual confirmation records an honest human assertion, not calendar creation.
5. Implement one active proposal/confirmed booking per lead, reschedule history,
   cancellation reason and completed/no-show outcomes. Atomically update related
   CRM stage/next action/history, invalidate obsolete scheduling drafts, and keep
   prior agreement details. Rescheduling requires a new agreed time; merely sending
   proposed alternatives does not modify the confirmed meeting.

Files: `convex/{prospects,leadEvents,bookings}.ts`, the P10/P11 draft, approval
and send functions a booking proposal reuses,
existing conversation/send integration and `plan/evidence/P19.md`. Gate: backend
checks and V23/V24 backend operations with controlled records and authenticated
API/subscription clients, including role/workspace denial, stale versions,
pagination, timezone evidence and false-confirmation guards. P13 accepts rendered
CRM/booking flows and P14 repeats full V23/V24. Automatic calendar synchronization
is optional and cannot replace this core manual-confirmation contract.
