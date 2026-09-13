# Hackathon log

- **Project:** OpenSquad
- **Event:** Convex All Gas Hackathon
- **What it does:** A frontend foundation for a sales and outreach CRM, with Hexclave sign-in, a dashboard shell, and date-range overview.
- **Live app:** not deployed
- **Repo:** https://github.com/arjunkambj/opensquad
- **Frontend:** not deployed
- **Convex deployment:** not deployed
- **Components:** @agentmail/convex, @firecrawl/firecrawl-convex
- **Convex features:** schema, indexes, queries, mutations, HTTP actions, internal mutations/actions
- **Auth:** Other
- **AI models:** none
- **Started:** 2026-09-13T12:00:25Z
- **Last updated:** 2026-09-14T01:30:00Z

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
