# Orchestration seam review

Date: 2026-09-14. Review branch: `opensquad/review-orch`, based on `8200731`
(P06 + P07 + P10 integrated). Scope: the cross-module contracts — mission
lifecycle vs workflow reconcile vs worker transport vs send boundary —
read against `plan/README.md`, architecture §4.2–4.4/§6/§8 and the P06/P07/
P10 evidence. No provider calls, no deployment, no test files added.

## Confirmed bugs and fixes

### 1. `boundedString` crashed on non-string envelope fields — HIGH

- **Root cause:** `boundedString` (`convex/lib/validators.ts:46`) called
  `.trim()` directly on its argument. Fields carved out of `v.any()`
  payloads are `unknown` at runtime, so a non-string crashed with an
  uncaught `TypeError`. The bridge maps unclassified throws to **503**
  (`bridgeErrorResponse`, `convex/http.ts`), while the documented contract
  is **400 INVALID** — a malformed-but-authenticated worker callback looked
  like a transient backend failure (and retries of it can never succeed).
- **Reachable via:** `parseWorkerResult` (`result.summary`, `/worker/result`),
  `applyControlResult` (`challenge.loginId`, `challenge.verificationUrl` —
  `convex/workerBridge.ts:1395-1400`), `assertWorkerRequestInput`
  (`input.prompt`/`context`/`artifacts`, `convex/lib/validators.ts:1169+`),
  `assertLifecycleRequestConfig` (`config.image`, `:1713+`). The dead
  `typeof input.prompt !== "string"` check that sat *after* the crashing
  call confirmed the intent was never delivered.
- **Fix:** `boundedString` now throws `invalid("<field> must be a string")`
  for non-strings; the dead post-check in `assertWorkerRequestInput` was
  removed. Every downstream validator (`normalizeEmailAddress`,
  `assertLoginVerificationUrl`, envelope field checks) inherits the
  behavior — 400 INVALID instead of an unclassified 5xx.
- **Touched:** `convex/lib/validators.ts`. Commit `86babfc`.

### 2. `MISSION_TRANSITIONS` could not express terminal reconcile from `queued`/`paused` — HIGH

- **Root cause:** `failMission`/`completeMissionTx` transition through
  `assertMissionTransition`, but the table lacked `queued → failed`,
  `paused → failed` and `paused → completed`
  (`convex/lib/validators.ts:531+`). Two real paths hit the missing edges:
  a workflow that fails before the dispatch gate commits leaves the mission
  `queued`, and `missions.pause` can commit between the last step and the
  `onComplete` callback leaving the mission `paused`. The illegal-transition
  throw then propagates out of `onMissionWorkflowComplete` — and the
  workflow component's workpool **swallows onComplete errors**
  (`@convex-dev/workflow` component `complete.js`, "TODO: store failures")
  — leaving the mission permanently non-terminal with a dead workflow.
  Silent wedge: board shows In flight/Backlog forever, no retry can fire.
- **Fix:** added `queued → failed`, `paused → failed`, `paused → completed`.
  These edges exist only for the reconcile paths; user-facing mutations
  (`pause`/`resume`/`cancel`) never target `failed`/`completed`.
- **Touched:** `convex/lib/validators.ts`. Commit `82986cb`.

### 3. `onMissionWorkflowComplete` ignored the returned outcome and callback identity — HIGH

- **Root cause:** `convex/workflows/steps.ts` treated **any** `success`
  result as mission-complete. But `devFixtureMissionWorkflow` also returns
  `success` with `outcome: "cancelled"` when it abandons — its awaited ask
  was superseded/retired, or its generation went stale
  (`checkContinuation` → `abandon`). On a live mission that wrote
  `completed` — Done on the board — while required asks sat unresolved and
  prospect branches had no recorded outcome. Separately, neither completion
  callback verified `args.workflowId` against the durable row, so a stale
  workflow generation's callback could reconcile onto a newer generation.
- **Fix:** a `success` result carrying `outcome: "cancelled"` on a live
  mission now lands `failed` (honest terminal — the workflow stopped before
  finishing its stages; still reachable for cancel/archive). The mission
  callback ignores a `workflowId` that isn't the mission's current one;
  `onProspectWorkflowComplete` gains the same `childWorkflowId` guard so a
  superseded branch generation can never finalize the current branch row.
- **Touched:** `convex/workflows/steps.ts`. Commit `7b1fa02`.

### 4. `vSendWorkflowResult` drifted from `vDispatchOutcome` — MEDIUM

- **Root cause:** `convex/workflows/send.ts` declared `preflight_refused`
  without the optional `sendAttemptId` that `sendApprovedDraft` actually
  returns whenever a refusal follows a committed reservation (window wait,
  blocked-after-reserve, reconcile wait — `convex/sending.ts:1442-1448`,
  `1480-1494`, `1680-1686`, `1858-1862`). Convex `returns` validators reject
  extra fields, so the journaled step result would fail validation and the
  send workflow would die *after* a durable attempt row exists — the
  pipeline loses the parked attempt reference and re-entry lands on the
  `existing`-attempt path with no receipt of what it parked.
- **Fix:** `preflight_refused` now carries
  `sendAttemptId: v.optional(v.id("sendAttempts"))`, mirroring
  `vDispatchOutcome` exactly. The workflow is dormant until P09 starts it,
  so the drift is fixed before the seam goes live rather than after.
- **Touched:** `convex/workflows/send.ts`. Commit `efa8d50`.

### 5. `decisions.listForMission` was state-major, not "newest first" — LOW

- **Root cause:** the query paginated `by_missionId_and_state` with
  `.order("desc")`, which sorts `(missionId, state, _creationTime)` — the
  ask history was grouped by state, then creation. The contract says
  "newest first — the ask history".
- **Fix:** added `by_missionId_and_createdAt` to `decisions` and paginated
  on it. Pure additive index; no behavior change beyond ordering.
- **Touched:** `convex/schema.ts`, `convex/decisions.ts`. Commit `5ffca96`.

## Reviewed seams confirmed correct (no patch)

- `decisions.resolve` remains the only human-resolution path: editor scope,
  `expectedVersion`, `requestId` dedupe, answer validation, transactional
  `sendEvent` on the backend-recorded `continuationEventId`;
  `continuationSentAt` + `redeliverContinuation` cover repair.
- `retireDecision` wakes a parked `awaitEvent` with an error so the workflow
  re-gates via `checkContinuation` instead of hanging on a stale ask.
- `openRequiredDecision` enforces askKey uniqueness, rejects terminal
  missions, and only binds a `targetWorkflowId` the mission owns (own
  workflow or a registered branch child).
- `sendApprovedDraft`/`beginDispatch`/`recordSendOutcome`: intent row +
  provider idempotency key exist before any network I/O; exactly one
  in-flight `requesting` per attempt; `uncertain` retains capacity, opens
  the `delivery_uncertain` ask, and only the SAME key may replay inside the
  provider retention window (`prepareReconcile` gates it).
- `coveringDecisionValid` binds replacement sends to the recorded
  `delivery_uncertain` resolution (attempt ID + draft ID + payload hash +
  live context version) and is consume-once via `by_replacementDecisionId`.
- `approvals.*` verdicts bind exact revision + payload hash + context
  version in one transaction with the decision resolution.
- Worker bridge: credentials hash-verified, generation-scoped, revoked on
  reconnect/retire; claim is lease-token + single-slot atomic; heartbeats
  require `worker_heartbeat` scope and current generation and order
  `stop` for dead/cancelled missions; results are exactly-once via
  `resultId` + canonical digest; expired leases land `uncertain` and hold
  the slot until `interrupt_turn` confirms termination (§7.7); control
  results are exactly-once per `resultId`; login challenge material is
  owner-only, short-lived, deleted on settle and never in activity/board.
- Named workflow events (`mission-resume`, `decision:*`,
  `worker:request:*`) survive repeated send/consume cycles — the component
  creates a fresh event row per `send` once the previous is sent/consumed,
  and `awaitEvent` resolves a stale `sent` row then re-parks on re-check.
- `dispatchWorkerRequest` is idempotent on (mission, stepKey, generation)
  and creates the backend-owned continuation event; `markAwaitingRuntime`
  binds `waiting_for_runtime` to the exact live request.
- Frontend runtime consumers stay honest: `deriveEmployeeStatus` uses
  `enabled` + backend `live`; `RuntimeSection` shows
  "Connected — heartbeat stale" when `live` is false; overview mirrors the
  runtime signal without inventing activity.

## Suspected / bounded issues documented without speculative patches

- `cancelMissionWorkerRequests` (`convex/workerOperations.ts:214`) is dead
  code — `cancelMissionWork` never calls it. Wiring it in naively would be
  **worse**: it marks requests `cancelled` without releasing the held
  execution slot, leaking `held` forever. The current sweep path (lease
  expiry → `uncertain` → `interrupt_turn` confirm) is the spec-safe §7.7
  behavior. Left as-is; the helper should either release the slot or be
  removed when a real caller lands.
- A permanently dead worker with an in-flight request leaves the workspace
  slot `uncertain` until the owner reconnects (retire frees it) — the
  conservative §7.7 posture deliberately never frees a slot whose turn may
  still be running. Operator recovery is documented, not automatic.
- `retireRuntimeInternals` scans only `.take(64)` workspace workerRequests;
  `pending` rows beyond 64 for a retired connection linger until the
  1-minute sweep's stale-generation pass cancels them. Self-healing and
  bounded; noted rather than patched.
- After `drafts.revise`, a `waiting_for_user` mission can read `active`
  with a fresh open ask (`closeAskOnMission` clears the wait;
  `openRequiredDecision` doesn't re-mark it). The board column still shows
  `needs_you` via `requiredDecisionCount`; the state badge is the only
  drift. Fixing honestly needs the P09 redraft-loop design, so it is noted
  not patched.
- `applyControlResult` lets a second `challenge_issued` overwrite
  `resultId`/digest, so a replayed first response then conflicts (409)
  instead of duplicate-acking. Bounded by the control TTL; noted.
- `sendDraftWorkflow` is defined but not started anywhere — the P09 seam
  contract; dormant by design.

## Verification run

- `npx tsc -b` — clean.
- `npx tsc -p convex/tsconfig.json --noEmit` — clean (Convex functions +
  the new index).
- `pnpm lint` — 0 errors, 1 pre-existing `use-mobile.ts`
  set-state-in-effect warning.
- `pnpm build` — clean, including `worker/` after installing its missing
  `node_modules` in this worktree (the earlier worker failure was
  environmental, unrelated to the patches).
- `git diff --check` clean; five feature-wise commits on
  `opensquad/review-orch`; nothing pushed.

## Commits

- `86babfc` fix(bridge): reject non-string envelope fields as INVALID
  instead of crashing
- `82986cb` fix(missions): allow terminal reconcile from queued and paused
  states
- `7b1fa02` fix(workflows): honor abandoned outcomes in mission completion
  reconcile
- `efa8d50` fix(workflows): carry sendAttemptId on preflight_refused
  workflow results
- `5ffca96` fix(decisions): return mission ask history newest-first

---

## Round 2 — pause/dead-mission seam review

Date: 2026-09-14 (same day, second pass). Scope: mid-pipeline pause
handling in `workflows/steps.ts`/`devFixture.ts`, and run-receipt
completeness on dead-mission cancel paths.

### Confirmed defects and fixes

1. **Mid-pipeline pause permanently failed the mission — MEDIUM.**
   `devFixtureStage` and `registerBranches` threw `CONFLICT` on any
   non-`active` mission — a routine operator pause landing between the
   dispatch gate and a state-checked step failed the workflow, and
   `onMissionWorkflowComplete` transitioned the paused mission to
   `failed`, making resume impossible. Both steps now return `wait` /
   `abandon` signals; the workflow parks on `resumeEvent` for `wait`
   (matching the `gate:dispatch` contract) and returns `cancelled` on a
   terminal state. — `86b5e56`.

2. **Dead-mission cancel paths never finished the run receipt — MEDIUM.**
   `claimWork`'s dead-mission skip and `sweepExpiredLeases`'s pending-row
   cancel patched `workerRequests`→`cancelled` and delivered the
   completion event but skipped `finishRun` — a `running` run stayed
   `running` forever (`sweepRuns` only fires at mission termination, which
   may already have passed for a `completed` mission). Both paths now
   finish the run, mirroring `cancelMissionWorkerRequests`; and
   `completeMissionTx` sweeps in-flight runs on completion so a mission
   cannot reach `completed` with a live receipt. — `86b5e56`.

### Residuals

- `waiting_for_user` missions have no UI badge distinguishing a parked ask
  from a working one — cosmetic, P09+.
- `missions.workflowId` is a single field (the parent workflow); child
  branch workflows are tracked on `missionProspects.childWorkflowId` —
  adequate as designed.

### Commits

- `86b5e56` park on mid-pipeline pause; finish run receipts on
  dead-mission cancels
