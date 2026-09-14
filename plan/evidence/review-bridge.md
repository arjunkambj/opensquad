# P07 independent review — scoped worker bridge + runtime lifecycle

Date: 2026-09-14. Review branch: `opensquad/review-bridge`, worktree
`opensquad-worktrees/review-bridge`. Base: `8200731` (P07+P10 integrated main).
Scope: `convex/workerBridge.ts`, `convex/workerOperations.ts`,
`convex/runtimeConnections.ts`, `convex/runtimeControlRequests.ts`,
`convex/crons.ts`, `/worker/*` routes in `convex/http.ts`, and the Box worker
(`worker/src/daemon.ts`, `bridge.ts`, `contracts.ts`, `codex/*`, `envcheck.ts`,
`main.ts`) read against architecture §4.4/§7.7 and worker/RUNTIME.md.

No provider call, disposable Box, live Codex turn, deployment or test file was
added. All findings are code-traced defects; each fix is a focused commit on the
review branch. Other worktrees were not touched.

## Confirmed defects and fixes

1. **Workflow steps wedge forever on disconnect/reconnect — HIGH.**
   `retireRuntimeInternals` patched live workerRequests to `cancelled` but never
   sent the stored `continuationEventId` nor finished the run receipt, so a
   workflow parked on `awaitEvent` never woke and the run stayed `running`.
   Retirement now routes through `cancelMissionWorkerRequests` (which gained a
   `reason` override so the error reads `runtime_retired`), delivering the
   completion event and finishing each run. — `aed9402`.

2. **Lease-expiry interrupt confirmation could never release the slot — HIGH.**
   The daemon answered `terminated:false` whenever the targeted turn wasn't
   running (worker restarted, turn already finished) — the exact answer that
   proves the turn dead — and the sweep skipped enqueueing `interrupt_turn`
   when no `currentCodexTurnRef` was recorded (e.g. worker stalled before its
   first heartbeat). An `uncertain` slot had no release path short of a manual
   disconnect. The daemon now reports `terminated:true` for a provably-dead
   target and treats a bare `interrupt_turn` (no turnId) as "interrupt whatever
   is running, or confirm nothing is"; the sweep always enqueues it. —
   `bffdf2e` (+ stale-ref clearing on confirmed termination in `65c8dfc`).

3. **Control-claim starvation + double execution — HIGH.** `claimControl`
   picked the oldest live row including `claimed` ones, so a claimed
   `start_login` (minutes-long device-code wait) starved every queued
   `cancel_login`/`interrupt_turn` — the owner's cancel was undeliverable — and
   each poll re-delivered the claimed command, which the daemon re-executed
   concurrently; a second `start_login` executor posted a terminal `failed`
   onto the live login. Backend now prefers pending and only re-delivers a
   claimed row when nothing is pending; the daemon tracks in-flight
   controlRequestIds and skips re-deliveries. Claimed re-delivery also writes
   the advertised 30 s expiry floor back to the row. — `0b1eada`, `bffdf2e`.

4. **Disconnect could race a fresh Box into a dying runtime — HIGH.**
   `disconnect` kept the generation, so a pending/accepted `create`/`resume`/
   `extend_ttl` still passed the driver's generation gate: the box could be
   provisioned after the `stop` op 404'd, leaking a live Box and stamping
   `connecting` over `stopping`. Disconnect now fails those ops; the driver
   refuses create-family ops on stopping/stopped/disconnected connections; and
   create/resume re-check the connection after the box is ready, stopping a box
   that landed mid-disconnect. — `1a4ac3d` (resume half in `2bd48db`).

5. **Stale-generation lifecycle outcomes rewrote live connection state — HIGH.**
   `recordLifecycleOutcome` applied `connectionState`/`boxRef`/`error` with no
   generation check, so e.g. a gen-N `stop` completing after a reconnect could
   stamp `stopped` onto gen N+1. Outcomes for a moved-on generation are now
   ledger-only, and a create-family completion never rewrites a dying
   connection. — `1a4ac3d`.

6. **Generation bump orphaned pending teardown — MEDIUM.** `connect`-revive and
   `reconnect` bump the generation and clear/keep `boxRef` while a gen-N
   `stop`/`delete` op was still pending; the generation gate then failed the op
   and the old box was never stopped (bounded only by the provider TTL).
   Teardown ops now pin `boxRef` at open time and stay valid across the bump. —
   `1a4ac3d`.

7. **`reconnect`-onto-existing-box could never produce a live worker — HIGH.**
   `runResume` resumed the box with `noEnv` and no bootstrap, so
   `/etc/opensquad/worker.env` kept the revoked token and stale generation —
   the worker exited 78 on first bridge call. `runResume` now rebuilds the
   create env (sealed credential of the live generation) and re-runs the image
   bootstrap after readiness. — `2bd48db`.

8. **`claimWork` mutated before validating input — MEDIUM (latent).** A
   non-inline `inputRef` threw after the request was leased and the slot held,
   leaking the slot into `uncertain`. Validation now precedes mutation. —
   `df7c74d`.

9. **Artifact dedupe ignored the digest — MEDIUM.** `checkArtifactGrant`
   returned the existing artifact for a reused `operationKey` regardless of
   `contentDigest`, silently dropping different content while reporting success.
   A digest mismatch is now a 409 conflict. — `eb3b8b8`.

10. **`runtimeHeartbeat` pinned a foreign `currentRunId` — LOW.** The reported
    run was stored on the connection without a workspace check (the
    agentSessions path did check). Both now require `run.workspaceId ===
    credential.workspaceId`. — `2849edb`.

11. **`start_login` could resurrect a dying runtime — MEDIUM.** A completed
    `start_login` unconditionally set `ready` — including on stopping/stopped/
    disconnected connections. Promotion now requires a live state, `startLogin`
    rejects `stopping`, terminal `cancel_login` clears all connection
    challenges (they are keyed to the start_login request, not the cancel), and
    `logout` clears them too. — `65c8dfc`.

12. **Model output could poison its own result envelope — LOW.** The daemon's
    `buildWorkerResult` spread model output after `schemaVersion`/`operation`,
    so a stray key rewrote the discriminator and the server necessarily
    rejected the digested result. Envelope fields now win. — `fcd564b`.

## Verification performed

| Check | Result |
|---|---|
| `tsc -p convex/tsconfig.json --noEmit` | exit 0 |
| `worker: pnpm install --frozen-lockfile` then `tsc -p tsconfig.json --noEmit` | exit 0 (worker is not a pnpm workspace member; deps installed locally in this worktree) |
| `pnpm lint` (oxlint, repo + changed files) | 0 errors; pre-existing `react(set-state-in-effect)` warning in `src/hooks/use-mobile.ts` only |
| `pnpm build` (`tsc -b` + vite + worker `tsc -p`) | exit 0; existing large-chunk advisory only |
| `git diff --check` | clean |
| `git status` after 10 fix commits | clean; commits `df7c74d..fcd564b`, no trailers |

Manual acceptance re-derivation (code-traced, not re-run against a deployment):
the worker bridge invariant set in the `workerBridge.ts` header now holds on
every path — claim validates before mutating; heartbeats/results/failures/
artifacts/activity all require scope + generation + lease-hash + live slot;
terminal transitions signal only the stored continuation event; every
cancellation path (mission cancel, dead-mission claim-time skip, lease sweep,
runtime retire) now delivers the event and finishes the run.

## Suspected / residual (not patched this round)

- `sweepExpiredLeases` and `sweepOrphanArtifacts` scan bounded prefixes
  (`take(64/256/128)`); backlogs beyond the cap wait for later runs. Point-of-use
  expiry checks cover correctness; a very large backlog could starve tail rows.
- `providerConnections.codex` keeps `ready` across `reconnect` until a
  control-command re-verifies — the managed login cache plausibly survives a
  resume, so this may be intentional; flag for the daemon-in-Box live gate.
- `requestAccountInspection`, `logoutAccount`, `interruptActiveTurn` enqueue on
  terminal connections where the command can only expire unclaimed; only
  `startLogin` guards state. Harmless but inconsistent.
- `recordWorkerActivity` throttles before the eventId dedupe — a replayed event
  inside 5 s gets 429 rather than a clean ack (daemon ignores it; cosmetic).
- `enqueueControlCommand` same-command dedupe can pin a second `interrupt_turn`
  (different turn) onto the first's row; marginal.
- `deliverCompletion` swallows only already-sent/consumed; a `sendEvent` failure
  of another kind (e.g. deleted workflow) would roll back the whole apply
  mutation — behaviour unprobed against a live component.
- Daemon: per-request `workDir` subdirectories are never deleted (bounded disk
  growth inside the Box); `maxToolCalls` is carried in the input contract but
  not enforceable via the app-server protocol (prompt-level only);
  `approvalPolicy:"never"` + read-only/no-network sandbox + the declining
  server-request handler are the tool boundary — `boxmcp.ts`/`livegate*.ts`
  are spike diagnostics not wired into `main.ts`.
- A resumed box may briefly start its service with the previous env file
  before `bootstrapBox` rewrites it; the setup command is the restart point.
- `sniffMimeType` treats a text/markdown body beginning with `{`/`[` as
  JSON — an edge-case 400 for markdown files that open with a brace.
- `devEnqueueControl`/`devRotateGeneration` bypass owner-path guards —
  dev-only internal surface, unreachable from HTTP/clients.

## Scope limits

Static review + typecheck/lint/build only. The worker daemon was not run inside
a Box and no Convex deployment was pushed from this worktree — the control
channel, sweep and lifecycle races above are code-traced. The P07 evidence
(`plan/evidence/P07.md`) covered the happy-path bridge scenarios on an isolated
deployment; this review covered the adversarial/lifecycle seams it did not.

---

## Round 2 — daemon/control-channel + lifecycle seam review

Date: 2026-09-14 (same day, second pass). Scope: `applyResult`/`applyFailure`,
`applyControlResult`/`applyControlEffects`, the lifecycle driver
(`runCreate`/`runStop`/`runDelete`/`retryLifecycleOperation`), `connect`/
`disconnect` revive paths, and `worker/src/daemon.ts` control handling.

### Confirmed defects and fixes

1. **`parseWorkerResult` required `summary` on ops that don't declare it —
   HIGH.** `draft`/`classify_reply` result contracts carry no `summary`;
   the parser bounded it unconditionally → every conformant result of those
   operations was rejected INVALID and dropped by the daemon, wedging the
   request through lease-expiry to failed. `summary` is now required only
   for discover/research/contact and bounded-if-present otherwise. —
   `55b5d1c`.

2. **Unconfirmed termination released the execution slot — MEDIUM.**
   `termination_unconfirmed`/`interruption_unconfirmed` failure reports ran
   `releaseSlot` unconditionally — freeing the slot while the model turn
   may still be running, permitting concurrent execution on one
   app-server. Those codes now record `uncertain`, keep the slot held,
   and enqueue `interrupt_turn` so the confirmation handshake owns the
   release (§7.7). — `55b5d1c`.

3. **Control-result effect throw rolled back the terminal patch — MEDIUM.**
   `applyControlEffects` could throw (`safeResult.account` malformed)
   AFTER `runtimeControlRequests` was patched terminal — rolling back the
   whole mutation left the row `claimed` and the daemon re-executed the
   command forever. The account shape is now validated BEFORE the patch; a
   bad result records `failed`. — `55b5d1c`.

4. **Pinned teardown could kill a reclaimed box — MEDIUM.** A stale
   generation's `stop`/`delete` pinned to `boxRef` survived a generation
   bump that RECLAIMED the same box (reconnect keeps `boxRef`) — the stale
   op would kill a box a live runtime was using. The driver now skips a
   pinned teardown when a newer generation holds the same `boxRef` outside
   a dying state. — `9154d5a`.

5. **Disconnect during `bootstrapBox` leaked a live box — MEDIUM.**
   `runCreate` re-read the connection between readiness and bootstrap but
   not after — a disconnect committing inside the up-to-5-minute setup
   window recorded the fresh box on the ledger yet never stopped it. The
   connection is re-checked after bootstrap; a moved-on connection stops
   the box immediately. — `9154d5a`.

6. **Revive could orphan a box whose teardown failed — MEDIUM.** `connect`
   on a terminal connection cleared `boxRef` unconditionally; a failed or
   never-pinned prior stop left the box running until provider TTL. Revive
   now opens a pinned `stop` when no live/completed teardown covers the
   old box. — `9154d5a`.

7. **`retryLifecycleOperation` raced a live driver — LOW.** `accepted` ops
   were unconditionally rescheduled — a second driver could run
   concurrently with a first still inside a multi-minute provider wait.
   Rescheduling is now limited to `uncertain` ops (or `accepted` silent
   past the action timeout). — `9154d5a`.

8. **`ValidatorError` check missed `ArgumentValidationError` — LOW.**
   Convex arg validation throws `ArgumentValidationError` — unmapped, it
   hit the 503 fallback and the daemon retried a permanently-invalid
   payload forever. Both names now map to the documented 400. — `9154d5a`.

9. **Stale turn refs outlived their request — LOW.** Terminal request
   states never cleared `connection.currentCodexTurnRef`/`currentRunId`,
   steering owner interrupts and the lease sweep at dead turns.
   `applyResult`/`applyFailure` now clear both when the settled request
   owns them. — `55b5d1c`.

10. **Logout could be overwritten by a late login completion — LOW.** A
    live `start_login` surviving a `logout` could later complete and
    re-promote the runtime to `ready`. `logout` now expires live
    `start_login` requests on the connection. — `55b5d1c`.

11. **`runtimeControlRequests` scans read lifetime history — LOW.**
    `enqueueControlCommand`, `cancelLogin`, `listOutstanding` and
    `retireRuntimeInternals` collected ALL states under the connection
    prefix on every call — unbounded growth into a hot path. All now eq
    `pending`/`claimed` on the index. — `9154d5a`, `55b5d1c`.

12. **`dispatchWorkerRequest` lacked a liveness guard — LOW.** A request
    pinned `runtimeGeneration` at dispatch on a terminal connection could
    never be claimed (revive retires the generation). Dispatch now
    requires `provisioning`/`connecting`/`ready`. — `13d82a8`.

### Daemon-side fixes (`worker/src/daemon.ts`)

13. **Dropped control-result post re-executed the command — MEDIUM.**
    `#executingControls` cleared in `finally` even when the result post
    failed — the bridge's claimed-row redelivery re-RAN the command (a
    second device-code start_login mid-entry). Settled outcomes are now
    stored until the bridge acks; a redelivered row reposts the identical
    result with its original `resultId`. — `ef9e3e8`.

14. **Unconfirmed termination left the daemon running — MEDIUM.** On
    `interruption_unconfirmed`/`termination_unconfirmed` the daemon kept
    polling while an orphan turn could still run. It now kills the
    app-server child and exits non-zero — process death is the only
    reliable termination proof; the supervisor restart + queued
    `interrupt_turn` then confirm and release the slot. `turnStart`
    failures split: an `AppServerError` (rejected start) reports
    `turn_start_failed`; a timeout/transport error reports
    `turn_start_unconfirmed` (the turn may be live). — `ef9e3e8`, server
    set extended in `55b5d1c`.

### Residuals

- Artifact upload→link still has a crash window that orphans a storage
  blob with no row (un-enumerable without a storage list API);
  `sweepOrphanArtifacts` covers the row→blob direction only.
- `claimWork`/`claimControl` ARE throttled (`throttlePoll`,
  `BRIDGE_MIN_POLL_INTERVAL_MS`) — the suspected missing rate limit was
  already present.

### Commits

- `55b5d1c` per-op result validation, honest uncertain on unconfirmed
  termination, pre-patch control validation, logout ordering, ref cleanup
- `9154d5a` box-leak windows and stale-driver races
- `ef9e3e8` daemon repost-not-reexecute + unconfirmed-termination exit
- `13d82a8` dispatch liveness guard (with misc fixes)
- `3fff79a` drop unused catch binding
