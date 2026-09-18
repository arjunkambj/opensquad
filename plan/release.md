# OpenSquad public release runbook (P16)

Status: **prepared, not published.** This document is the release procedure and
production checklist for the constrained public deployment. Executing the
"Publish" section creates a production deployment and sets public traffic live —
do not run it until the user authorizes publishing through the integrator.

## Release target

| Item | Value |
|---|---|
| Convex project | `opensquad` (team `arjun-kamboj-43d32`) |
| Deployment | the project's **production** deployment (`prod:*`), created by the first authorized `pnpm run deploy` — its generated name is recorded here after creation |
| Public URL | `https://<prod-name>.convex.site` (HTTP actions + static frontend on one origin) |
| Client API origin | `https://<prod-name>.convex.cloud` (embedded in the bundle as `VITE_CONVEX_URL` by the deploy build) |
| What is public | the Vite SPA (`/`, `/tour` when flag-enabled, `/sign-in`, `/handler/*`, signed-in app routes), the authenticated worker bridge `POST /worker/*`, `POST /agentmail/webhook` (Svix-signed), `POST /firecrawl/webhook` (HMAC + per-crawl token) |
| What is never public | provider secrets, `OPENSQUAD_*` worker credentials, `HEXCLAVE_SECRET_SERVER_KEY`, `CONVEX_DEPLOY_KEY`, workspace records without auth |

The development deployment `dev:flexible-grasshopper-949` stays the staging
target (`pnpm run deploy:dev` uploads to whatever `CONVEX_DEPLOYMENT` selects —
verify it points where you intend before running).

## Route ownership (verified — see `plan/evidence/P16.md`)

App-owned root routing per `plan/integrations.md` §G4: `convex.config.ts`
mounts `staticHosting` **without** `httpPrefix`; `convex/http.ts` keeps every
exact app route and registers the static GET catch-all LAST via
`registerStaticRoutes`. Convex resolves exact `(path, method)` routes before
prefix routes; the catch-all is GET-only.

| Path | Method | Handler | Public response |
|---|---|---|---|
| `/worker/claim`, `/worker/control/claim`, `/worker/control/result`, `/worker/runtime-heartbeat`, `/worker/heartbeat`, `/worker/activity`, `/worker/result`, `/worker/failure`, `/worker/tool`, `/worker/artifact` | POST | app bridge | 401 without valid bearer credential |
| same paths | GET | app 405 guard | `405 METHOD_NOT_ALLOWED` — never `index.html` |
| `/agentmail/webhook` | POST | app → component verifier | 401 unsigned / bad signature |
| `/agentmail/webhook` | GET | app 405 guard | 405 |
| `/firecrawl/webhook` | POST | component (`httpPrefix /firecrawl/`) | 401 unsigned / bad signature |
| `/firecrawl/webhook` | GET | app 405 guard | 405 |
| `/`, `/leads`, `/overview`, `/tour`, `/sign-in`, `/handler/*`, unknown extension-less paths | GET | staticHosting | `index.html` (SPA fallback) |
| `/**/*.ext` missing assets | GET | staticHosting | 404 |
| any reserved path | PUT/DELETE/… | — | 404 `No matching routes found` |

## Production checklist

### 1. Environment variables — every name in `.env.example`

Set each `[convex]` name on the **production** deployment
(`pnpm exec convex env set NAME --prod` or dashboard → deployment settings).
`[vite]` names must be present on the release machine's environment or
`.env.local` at build time — the deploy build injects `VITE_CONVEX_URL` itself.

| Name | Destination | Required | Notes |
|---|---|---|---|
| `VITE_CONVEX_URL` | vite build | injected | Set by `static-hosting deploy`/`upload` to the target's `.convex.cloud` URL — never hand-edit for a release build |
| `VITE_CONVEX_SITE_URL` | vite build (dev) | dev only | Informational; production workers get `OPENSQUAD_BRIDGE_URL` |
| `VITE_HEXCLAVE_PROJECT_ID` | vite build **and** convex env | required | Backend reads it in `convex/auth.config.ts`; build reads it for the Hexclave client |
| `VITE_HEXCLAVE_PUBLISHABLE_CLIENT_KEY` | vite build | required | Public `pck_` key, safe in the bundle |
| `HEXCLAVE_SECRET_SERVER_KEY` | release machine only | optional | Never `VITE_*`, never on the deployment unless a server call needs it |
| `CONVEX_DEPLOYMENT` | release machine | required | Selects the deploy target (`prod:<name>`); keep it out of CI images |
| `ASCII_API_KEY` | convex env | required for runtime | Box provisioning; without it runtime connect fails closed |
| `FIRECRAWL_API_KEY` | convex env | required | App env schema blocks deploy without it |
| `FIRECRAWL_WEBHOOK_SECRET` | convex env | required in prod | Unset ⇒ component skips HMAC — never ship prod without it |
| `AGENTMAIL_API_KEY` | convex env | required for mail | Narrow send adapter + component inbound |
| `AGENTMAIL_WEBHOOK_SECRET` | convex env | required for mail | Unset ⇒ handler throws (fail closed) |
| `AGENTMAIL_BASE_URL` | convex env | optional | Staging/mock override only |
| `OPENSQUAD_WORKER_SEAL_KEY` | convex env | required for runtime | ≥16 chars; seals scoped worker credentials; rotate only with runtime replacement |
| `OPENSQUAD_WORKER_IMAGE` / `OPENSQUAD_WORKER_SETUP` | convex env | recommended | Pin the reviewed Box image/setup for release reproducibility |
| `OPENSQUAD_BRIDGE_URL` | convex env | optional | Defaults to the deployment's own `CONVEX_SITE_URL`; set only to override |
| `OPENSQUAD_DEMO_ALLOWED_RECIPIENTS` | convex env | required for demo send | Normalized allowlist; absent ⇒ demo sends blocked even in `demoMode` |
| `OPENSQUAD_DEMO_MAX_DAILY_SENDS` | convex env | required for demo send | Hard daily cap AND-ed with workspace limit; absent ⇒ 0 |
| `OPENSQUAD_DEMO_TOUR` | convex env | release decision | `"1"` serves the sanitized read-only tour; absent ⇒ disabled |
| `OPENSQUAD_DEMO_EXECUTION` | convex env | release decision | `"1"` allows `demo.optIn` isolated `demoMode` workspaces; absent ⇒ FORBIDDEN |
| `OPENSQUAD_BRIDGE_URL` + `OPENSQUAD_RUNTIME_ID` + `OPENSQUAD_RUNTIME_GENERATION` + `OPENSQUAD_WORKER_TOKEN` | worker (Box env) | per-runtime | Injected by the provisioning flow; never in repo or build |
| `CONVEX_DEPLOY_KEY` | release machine | CI only | Needed only if the release flow deploys without an interactive CLI login |

### 2. Hexclave project settings (dashboard)

- Allowed origins: add `https://<prod-name>.convex.site` (the site origin —
  sign-in redirects and the `/handler` callback run there).
- Redirect/callback URLs: `https://<prod-name>.convex.site/handler` plus any
  `redirect=` deep links the app uses.
- Publishable client key stays the same `pck_` value; no new key needed for a
  new origin unless the project scopes keys per origin — verify in dashboard.

### 3. Component registrations

All installed automatically by `convex deploy` from `convex/convex.config.ts`:
`agentmail` (+ `callbackPool`, `sendPool`), `firecrawl` (self-mounts
`/firecrawl/webhook` via `httpPrefix`), `workflow` (+ `workpool`,
`batchWorker`), `staticHosting` (storage + manifest only — no HTTP prefix).

### 4. External callback URLs to register

| Provider | URL to register | Secret |
|---|---|---|
| AgentMail webhook | `https://<prod-name>.convex.site/agentmail/webhook` | `AGENTMAIL_WEBHOOK_SECRET` on the deployment |
| Firecrawl crawl callbacks | `https://<prod-name>.convex.site/firecrawl/webhook` — registered per-crawl by the component | `FIRECRAWL_WEBHOOK_SECRET` |
| Worker bridge base | `https://<prod-name>.convex.site` (default `CONVEX_SITE_URL`) | per-runtime `OPENSQUAD_WORKER_TOKEN` |

### 5. Worker image version (last-known-good runtime)

- Codex binary: `@openai/codex` **0.154.0** (`codex app-server --stdio`).
- Worker bundle: `worker/dist` built from the release commit
  (`worker/package.json` 0.1.0), systemd unit `worker/deploy/opensquad-worker.service`.
- Box image/setup: pin via `OPENSQUAD_WORKER_IMAGE`/`OPENSQUAD_WORKER_SETUP`
  once the reviewed image reference exists; record the exact ref in release
  evidence.

### 6. Last-known-good artifact

- The release commit SHA and its `dist/` tree are the rollback unit. Keep the
  produced `dist/` (or the git tag) — `static-hosting upload --prod` of that
  tree restores the frontend atomically (the manifest publish is transactional;
  a failed upload leaves the previous site live).

## Publish procedure (run only with authorization)

1. Preconditions: P14 acceptance passed; all `[convex]` env vars set on the
   prod deployment; Hexclave origins updated; worker image ref chosen.
2. `CONVEX_DEPLOYMENT=prod:<name>` (or deploy key present), then
   `pnpm run deploy` — this runs `pnpm run build` with the prod
   `VITE_CONVEX_URL`, `convex deploy`, then the atomic static upload.
3. Smoke checks in a fresh browser, no invite:
   - `GET /` 200 (SPA), `GET /leads` 200 (SPA fallback), `GET /missing.js` 404;
   - sign-in round trip via `/handler`;
   - `POST /worker/claim` → 401 JSON; `GET /worker/claim` → 405 JSON;
   - `POST /agentmail/webhook` unsigned → 401; `POST /firecrawl/webhook`
     unsigned → 401;
   - `/tour` renders only if `OPENSQUAD_DEMO_TOUR` was enabled.
4. Register the AgentMail webhook URL in the AgentMail dashboard; verify one
   signed test event lands.
5. Connect one workspace runtime from a real Box; confirm worker heartbeats
   and a claim/heartbeat/result round trip.
6. Record release commit, prod URL, component list, worker image ref and the
   smoke results in `plan/evidence/P16.md` (integrator: then `hackathon.md`).

## Rollback procedure

Per §G4: pause new dispatch, keep the prior frontend artifact and a compatible
backend commit, stop incompatible workers, redeploy the known-good version to
the **same** deployment, resume only after auth/bridge/webhook checks.

- **Frontend-only rollback:** from the last-known-good checkout,
  `pnpm exec static-hosting upload --prod -d dist` re-uploads a retained
  `dist/` tree without rebuilding (add `--build` to rebuild first). The
  manifest publish is atomic; the site never serves a half-switched tree.
- **Full rollback (backend + frontend):** `git worktree` the last-known-good
  commit, `pnpm install --frozen-lockfile`, then `pnpm run deploy` against the
  same `prod:` selection.
- **Never** ship a schema change that the rollback revision cannot read during
  a release window; existing data must stay valid under both revisions.
- Incompatible running workers: retire their runtime generation (revokes
  credentials) before resuming dispatch on the rolled-back backend.
- Provider-side rollback is not claimed: AgentMail/Firecrawl webhook
  registrations keep pointing at the same URL; no provider rollback command is
  asserted here.

## Open decisions relayed to the user/integrator

- **Publish authorization** — creating the prod deployment and setting secrets.
- **Demo enablement** — whether to set `OPENSQUAD_DEMO_TOUR` /
  `OPENSQUAD_DEMO_EXECUTION` and the allowlist/cap values at release.
- **API-funded demo runtime** — if judges should execute without connecting
  their own Codex account, that is a separate product/funding decision; this
  lane implements only the user-connected-sandbox opt-in.
