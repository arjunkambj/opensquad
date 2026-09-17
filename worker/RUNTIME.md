# OpenSquad worker — pinned runtime notes (P03, extended by P07)

Scope: Box-side worker. P07 lands the production shape: the worker daemon
polls the Convex bridge (`/worker/*` on the deployment's `.convex.site`
endpoint) for owner control commands and bounded model work, and posts
heartbeats/results back. Provider credentials (ASCII, AgentMail, Firecrawl,
OpenAI) never enter the Box or this process.

## Production daemon (`src/daemon.ts` + `src/main.ts`)

`dist/main.js` is the systemd service unit's `ExecStart` (see
`deploy/opensquad-worker.service`). Boot order:

1. `OPENSQUAD_*` env validation → exit 78 (`EX_CONFIG`) on missing/invalid.
2. Inherited-credential hygiene gate → exit 78 if builder/provider material
   leaked in (the workspace's own managed-login cache is allowed).
3. Spawn `codex app-server --stdio`, `initialize`/`initialized` handshake.
4. One `account/read` for posture, then three poll loops:

   | Loop | Interval | Endpoint | Purpose |
   |---|---|---|---|
   | control | 2.5 s | `POST /worker/control/claim` | `inspect_account`, `start_login`, `cancel_login`, `logout`, `interrupt_turn` — stays responsive while a turn runs |
   | work | 3 s | `POST /worker/claim` | at most one leased request at a time; backend `workspaceExecutionSlots` is authoritative |
   | liveness | 15 s | `POST /worker/runtime-heartbeat` | phase/version/turn ref only — never a lease |

5. A claimed request runs ONE bounded turn: rate-limit posture check →
   scoped `thread/start` (or `thread/resume` when the dispatch carries
   `input.session.codexThreadRef`) → `turn/start` with `outputSchema` →
   15 s lease heartbeats that may order `stop` → terminal handling →
   `POST /worker/result` (worker computes the canonical `sha256:` digest)
   or `POST /worker/failure`. `activity` events are deduped by `eventId`.

6. Exit codes: `0` clean stop; `1` unexpected failure incl. app-server death
   (systemd `Restart=on-failure`); `78` dead credential (401) — provisioning
   replaces the runtime, no restart loop.

Lease expiry without a result leaves the backend slot `uncertain`; the
sweep enqueues `interrupt_turn` (when a turn ref was reported), and only a
`terminated:true` control result releases the slot — stale generations and
leases can never mutate business state.

`OPENSQUAD_CODEX_SANDBOX=externalSandbox` switches `turn/start` to the
external-sandbox policy (`networkAccess:"restricted"`) for Box images where
bubblewrap cannot initialise; the default is `readOnly` + no network.

## Staging fault/replay helpers (developer-owned, `internalMutation` only)

Callable exclusively via `npx convex run` — none are public mutations, none
are reachable over HTTP, and the public demo cannot invoke them:

- `workerOperations:devSeedFixture` — workspace+mission+run+connection+one
  pending `workerRequest`+credential; returns the one-time worker token.
- `workerOperations:devSeedWorkerRequest` — additional dispatch on a mission.
- `workerOperations:devMintCredential` — extra scoped credential (`scopes`).
- `workerOperations:devRotateGeneration` — retires all generation-N creds.
- `workerOperations:devExpireLease` — force a lease past expiry for V06.
- `workerOperations:devEnqueueControl` — owner control commands on the wire.
- `workerOperations:devDumpBridge` — read the transport tables (no secrets).
- `workerOperations:sweepExpiredLeases` — the production sweep (also run
  by cron); safe to invoke manually.

V05 replay: post the same `resultId`+digest twice → `duplicate:true`.
V06 expiry: `devExpireLease` → result → 409; sweep → `uncertain`; enqueue
`interrupt_turn` → `terminated:true` → slot released.
V18 stop: heartbeat returns `instruction:"stop"` → worker interrupts the
turn and reports `cancelled` (retry-safe).

## Scripts

Root: `pnpm worker:build`, `pnpm worker:typecheck`, `pnpm worker:dev`
(builds then runs `worker/dist/main.js` — requires a live `OPENSQUAD_*`
env, e.g. exported from a dev-seeded credential). The root `build` script
includes the worker build as the typecheck gate.

## Pinned versions (verified 2026-09-13, see plan/evidence/P03.md)

| Component | Pin | Notes |
|---|---|---|
| Node.js | 24.21.0 (LTS) | e.g. `node:24.21.0-bookworm-slim`, or installed in a clean named ASCII snapshot |
| Codex CLI | `@openai/codex@0.154.0` | npm wrapper resolves `@openai/codex-linux-x64@0.154.0` inside a Linux Box |
| Box SDK | `@asciidev/box-sdk@0.0.34` | Convex/control side only — the SDK is NOT needed inside the Box |
| pnpm | 11.21.0 | `pnpm install --frozen-lockfile` inside `worker/` |

## Package isolation

`worker/` is deliberately NOT in the root `pnpm-workspace.yaml` and NOT a
dependency of the Vite app. `worker/pnpm-workspace.yaml` makes it its own
workspace root; `worker/pnpm-lock.yaml` pins its dependency set independently.

## Box-side layout

- `/opt/opensquad/worker/` — built bundle: `dist/`, production `node_modules/`,
  `package.json`.
- `/var/lib/opensquad/` — service account home; `CODEX_HOME=/var/lib/opensquad/.codex`
  holds the managed-login cache for THIS workspace's Box only.
- `/etc/opensquad/worker.env` — 0600 `opensquad:opensquad`; exactly the four
  `OPENSQUAD_*` names from `worker/.env.example` (bridge URL, runtime id,
  generation, scoped worker token). No provider keys: never inject
  `ASCII_API_KEY`, `AGENTMAIL_*`, `FIRECRAWL_*`, `OPENAI_*`, deploy keys.

## Build/refresh inside the image

```sh
# Build in a clean checkout, then ship dist/ with the package and lockfile:
cd /opt/opensquad/worker
pnpm install --frozen-lockfile
pnpm build
# In the runtime image, install only runtime dependencies beside prebuilt dist/:
pnpm install --frozen-lockfile --prod
```

Protocol types are generated from the installed binary and committed; bump the
Codex pin → regenerate → review the diff.

## Lifecycle semantics the adapter encodes (verified against SDK 0.0.34)

- `create`: `Idempotency-Key` header supported natively; persist key + request
  fingerprint BEFORE the call. Same key+body → same box (24 h retention);
  `409 idempotency_in_progress`/`idempotency_key_reused` are distinct.
- `create`/`resume` accept `noEnv: true` (withholds inherited account creds)
  and `ttlSeconds`. Trial accounts: default 1 h TTL counts from creation,
  auto-stop can't be disabled, max 2 h — the adapter always sets explicit TTL.
- `stop` = pause: saves disk then archives; a failing snapshot refuses the stop
  (`force: true` accepts data loss — not used by default).
- `update` (PATCH) sets `ttlSeconds` for TTL extension.
- `deleteBox` requires `X-Ascii-Confirm-Delete: <boxId>` (must equal target;
  mismatch → 409, nothing deleted). Returns a deletion operation to poll.
- `command` runs sync (≤600 s) or `detached` + `commandStatus` polling.
  Commands are never auto-retried by ASCII; `502 box_direct_failed` may mean
  the command is already running — the adapter records `uncertain`.
- `idle`/`running` reflect only the built-in prompt harness — our systemd
  worker doesn't move them; worker heartbeat is authoritative.

## Accepted probe and remaining image work

P03's live evidence records owner device-code login, a bounded turn, preserved
managed login and saved-thread resume in disposable ASCII Boxes. See the live
gate section of `plan/evidence/P03.md`; the earlier blocked section is history.
P07 still owns the reusable clean worker snapshot, verified sandbox support,
protocol-generation parity and production bridge. `from` accepts named ASCII
snapshots, not Docker references.

Provisioning probes reject Codex login files at Box birth. The service's
restart check permits its workspace-owned managed login cache while continuing
to reject other builder/provider credentials. It creates the work directory
before spawning Codex; configuration exit 78 requires a provisioning fix.

## P04 diagnostic drivers (NOT the employee image)

`src/boxmcp.ts` + `src/p04gate.ts` are the P04 Apollo/Firecrawl diagnostic
probe: `p04gate.js` runs on the builder host and drives one disposable Box;
`boxmcp.js` runs inside it and configures a RAW diagnostic
`[mcp_servers.apollo]` connection in its throwaway CODEX_HOME. That raw
connection is the trusted-operator diagnostic surface only — the employee
image contract above (`/etc/opensquad/worker.env`, the systemd unit, the
pinned package set) ships NO MCP servers; the filtered workspace gateway is
P07. See plan/evidence/P04.md for the deferred-OAuth state and resume steps.

## P21 runtime exercise driver (NOT the employee image)

`src/p21box.ts` puts the production daemon (`dist/main.js`) into one
disposable Box bound to a real deployment bridge. Until a named worker
snapshot exists, worker delivery is the manual half of provisioning; this
driver is it. Subcommands: `up` (create, resume an archived Box, or reuse a
live one — the recorded lifecycle is only replaced after a definitive 404;
values staged in `worker/.p21box/worker.env` are written into the Box as
worker.env — never inside the create body), `adopt <boxId>` (use a
`connect`-provisioned Box; the env is reconstructed inside the Box from
printenv or `/etc/opensquad/worker.env`), `bridge` (host probe:
unauthenticated `POST /worker/claim` must answer 401), `bootstrap`
(Node 24.21.0 + `@openai/codex@0.154.0` + the dependency-free dist bundle),
`start` (env is read line-wise, never sourced; the daemon must still be
alive ~10 s after spawn or `start` reports the exit), `status`, `stop`,
`down`. The driver default TTL is 7200 s — the trial account cap;
`--ttl <seconds>` or `P21BOX_TTL_SECONDS` overrides (integer, 60–86400,
validated before any provider call). Deployment-side,
`OPENSQUAD_BOX_TTL_SECONDS` bounds what `connect`/`reconnect` request.

`p04gate auth` relays the Apollo OAuth URL and polls until the in-box probe
finishes; `--auth-budget-ms` (in-box phase budget, default 55 min) and
`--oauth-timeout-secs` (OAuth leg, default 2400 s) are validated and
forwarded to the probe, and the host watch outlives the forwarded budget by
20 minutes so the callback ferry never dies before the probe does.
