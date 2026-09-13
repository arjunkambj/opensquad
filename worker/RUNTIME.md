# OpenSquad worker — pinned runtime notes (P03)

Scope: Box-side worker spike. The Convex-side bridge routes and Box
provisioning flow belong to P07; this package is the code that runs *inside*
the ASCII Box.

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
# at image build time (named snapshot "from" — see open question below):
cd /opt/opensquad/worker
pnpm install --frozen-lockfile --prod
pnpm exec tsc -p tsconfig.json        # or ship prebuilt dist/
codex app-server generate-ts --out src/generated/codex   # regenerate on codex bump
codex app-server generate-json-schema --out protocol
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

## Open questions for the owner (recorded in plan/evidence/P03.md)

1. Exact ASCII `from` snapshot/image name for the pinned worker image —
   `from` accepts named snapshots, not Docker references.
2. Whether the managed Codex device-code login completes end-to-end inside a
   real Box (owner's ChatGPT account) — locally proven only to `login/start` +
   cancel on codex-cli 0.154.0.

## P04 diagnostic drivers (NOT the employee image)

`src/boxmcp.ts` + `src/p04gate.ts` are the P04 Apollo/Firecrawl diagnostic
probe: `p04gate.js` runs on the builder host and drives one disposable Box;
`boxmcp.js` runs inside it and configures a RAW diagnostic
`[mcp_servers.apollo]` connection in its throwaway CODEX_HOME. That raw
connection is the trusted-operator diagnostic surface only — the employee
image contract above (`/etc/opensquad/worker.env`, the systemd unit, the
pinned package set) ships NO MCP servers; the filtered workspace gateway is
P07. See plan/evidence/P04.md for the deferred-OAuth state and resume steps.
