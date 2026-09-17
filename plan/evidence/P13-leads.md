# P13 frontend B — Leads CRM, booking lifecycle, signed-in home

Branch `opensquad/P13-leads`, worktree
`/Volumes/main/Code/opensquad-worktrees/P13-leads`, base `2fea805`
(lane-assignment commit). Builds on the P19 backend contracts and P13
part A's shared Decisions surface.

The shared dev deployment `flexible-grasshopper-949` was NOT pushed to:
`convex codegen` regenerated the local typed bindings only (it does not
modify the running deployment — confirmed via `convex codegen --help`).
Every read that depends on a new function (`conversations.listForProspect`,
`missions.listForProspect`, `decisions.listForDraft`) sits inside a scoped
`CatchBoundary` that renders an honest "not available yet on this
deployment" state rather than a broken page — the deploy happens at
integration.

## Bounded backend additions (each one exists because an index could not answer it)

| Function | Index used | Bound | Why needed |
|---|---|---|---|
| `conversations.listForProspect` | `conversations.by_prospectId` | paginated (`MAX_LIST_LIMIT` page + cursor) | "this lead's threads" — no conversation index is keyed by prospect |
| `missions.listForProspect` | `missionProspects.by_prospectId` | capped collect + `hasMore` | "which live mission can carry the proposal draft's approval ask" — missions are linked to prospects only through `missionProspects` |
| `decisions.listForDraft` | `decisions.by_draftId` | `MAX_LIST_LIMIT + 1` + `hasMore` | booking card → the draft's open `draft_approval` ask, for the `/decisions/$decisionId` link |
| `prospects.countOverdue` | `by_workspaceId_and_nextActionDueAt` | `MAX_LIST_LIMIT + 1`, returns `{count, hasMore, bound}` | the /leads attention tile — an honest "N+" cap, never a full scan |
| `prospects.list` `unscheduled` mode | `by_workspaceId_and_nextActionDueAt` | existing pagination | leads with NO `nextActionDueAt` — the absent-indexed-value range (`lt(EPOCH_MS_MIN)`) |

All validate workspace membership and cross-check prospect/mission/draft
workspace ownership; a foreign id throws NOT_FOUND (existence never leaks).

## What shipped

- `/leads` — real CRM list replacing the labelled placeholder. Two URL
  modes: `pipeline` (campaign/stage/owner filters over
  `by_workspaceId_and_campaignId_and_salesStage`,
  `by_workspaceId_and_salesStage`, `by_workspaceId_and_ownerIdentityKey`)
  and `due` (window filters `overdue|today|next_7d|next_30d|unscheduled`
  over `by_workspaceId_and_nextActionDueAt`, computed in the workspace
  timezone by `dueWindowBounds`); `?q=` runs `search_company_name`;
  cursor pagination; `withFilters` clears cursors on every filter change;
  row → `/leads/$prospectId` carrying the whole list context so "Back to
  leads" restores it.
- Attention block at the top of `/leads`: open decisions
  (`decisions.listOpen` count via `useOpenDecisionCount` — the same call
  the sidebar badge makes), unassigned mail
  (`conversations.attentionCounts.unassigned`), overdue next actions
  (`prospects.countOverdue`, bounded) linking to
  `/leads?mode=due&due=overdue`. Mission Control stays one deliberate step
  away via the header link.
- `/leads/$prospectId` — header (company, domain, stage/qualification
  chips, campaign, owner, last-contacted/replied facts) + five tabs:
  - **Overview** — the record (fit reason, source refs with profile links
    and provider record ids, enrichment contact with provider-verified /
    selection-reason provenance, next action + due), then three edit
    controls (stage move — `reason` required on every human move, per the
    backend; owner assignment by `membershipId`; next-action editor with
    `civilTimeToUtcMs` due fields that REFUSE DST-gap and DST-repeat wall
    times) and the notes box.
  - **Evidence** — `evidence.listForProspect`, source URL + confidence
    (supported/hypothesis/unverified) + excerpt + retrieved-at per row.
  - **Activity** — `leadEvents.list` append-only timeline (kind label,
    stage pairs, human/workflow/system actor, note bodies, booking links).
  - **Conversation** — `conversations.listForProspect` rows linking into
    `/inbox/$conversationId`; degrades honestly if the function is not yet
    deployed.
  - **Booking** — the whole §9 lifecycle, below.
- Booking tab — opens with the load-bearing sentence ("a booking here
  records what the lead AGREED to — nothing sends an invitation or writes
  to a calendar"). Proposed bookings render what was OFFERED (the link or
  the slots + their timezone, passed slots marked); confirmed bookings the
  AGREED time + the typed confirmation basis + who recorded it; cancelled
  keep the times and the reason. Actions by state: propose (link or ≤3
  slots under one picked IANA zone), write the proposal email
  (`draftProposal` → draft + `draft_approval` ask, thread picker limited to
  open threads on this lead, mission picker limited to live missions with
  a dispatched workflow — both requirements enforced server-side),
  record the agreed time (confirm, `confirmationNote` required),
  reschedule (required reason; the dialog says the stale draft is retired
  in the same step), cancel (required reason), record outcome
  (completed/no-show, only enabled once `startsAt` has passed — the
  backend refuses earlier). Every write sends the pinned
  `expectedVersion`; a version that moved shows a re-pin banner and never
  silently re-pins; every write uses a per-intent `requestId`
  (`useIntentId`). The booking's draft renders via `BookingDraftLink` —
  payload hash, revision, recipient, send-attempt state from
  `sending.preflight`, a bookingVersion-pin warning, "Edit the draft"
  (shared `EditDraftDialog` → `drafts.revise`) and a link to its open ask
  on `/decisions/$decisionId` (resolved by `decisions.listForDraft`).
  Approval stays on the shared queue — nothing here re-implements it.
- Auth home — `afterSignIn`/`afterSignUp` → `/leads`; the signed-in
  redirect in `sign-in.tsx` defaults to `/leads`;
  `after_auth_return_to` handling unchanged (same-origin path only —
  `//` and scheme URLs refused, open redirects impossible). The shell
  error boundary, dashboard 404 and root 404 now point at `/leads`;
  `/prospects` still redirects there.

## Checks

| Check | Result |
|---|---|
| `pnpm lint` (oxlint) | PASS — 0 warnings, 0 errors, 955 files |
| `pnpm exec tsc -b` | PASS |
| `pnpm exec tsc -p convex/tsconfig.json --noEmit` | PASS |
| `pnpm worker:build` / `pnpm worker:typecheck` | PASS (after `pnpm -C worker install --frozen-lockfile` — the worker is a separate workspace and needed its own install) |
| `pnpm build` | PASS — `tsc -b` + `vite build` + worker build; only the pre-existing >500 kB chunk advisory |
| Route tree | regenerated by `vite build` — `/leads` + `/leads/$prospectId` registered |

## Browser walk (signed-out — all that exists without a session)

- `GET /leads`, `/sign-in`, `/prospects`, `/overview`, `/decisions`,
  `/leads/<fake-id>` → all 200 on the dev server (SPA shell; the
  `_dashboard` layout's `useUser({or:"redirect"})` bounces signed-out
  visitors to `/sign-in?after_auth_return_to=<path>`).
- `after_auth_return_to` sanitisation verified in code
  (`sign-in.tsx` `internalPath`): `https://evil.example` and `//host`
  are refused; only same-origin paths survive — verified by inspection,
  not exercised (no session).

## Deferred / not verifiable here

- **All signed-in manual checks** — no Hexclave session exists in this
  environment. The V-scenario walk (filter the list, open a lead, move a
  stage, propose → draft → approve → confirm → reschedule → record
  outcome) needs an operator session AND a `convex deploy` of the three
  new bounded reads.
- **Backend additions are compile-verified, not behaviour-verified** —
  they were never run against data (deploy deferred to integration). The
  UI degrades honestly until then (scoped CatchBoundaries).
- **Fixture verification** — part A seeded
  `jn7c5sj0rh7rza1ssz9yxsea898ee1pz` on the shared deployment; the same
  probe pattern applies once the functions are pushed.
