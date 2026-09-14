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
