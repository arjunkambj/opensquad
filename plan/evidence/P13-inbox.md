# P13 frontend A — Inbox, Decisions, settings/runtime controls

Branch `opensquad/P13-inbox`, worktree
`/Volumes/main/Code/opensquad-worktrees/P13-inbox`, base `4ac81cb`
(the tasks.json `baseRef` `8f6f0f4` predates the lane-assignment commit —
the branch actually forked at `4ac81cb`).

Frontend-only lane: no functions were pushed, no `convex dev`/`deploy`/
`codegen` run. The shared dev deployment `flexible-grasshopper-949` was
read via `convex data` and written via `convex run` mutations with a
`--identity` impersonation of the verification owner — the same probe
mechanism the P10 script and the P11 gate pass used.

## Commits

```
27ba870 feat(settings): section navigation, account identity and suppressions
3647995 feat(decisions): split queue/detail view and draft revision editing
c7c8a33 feat(nav): Inbox and Leads sidebar entries with attention badge
1e9ec78 feat(inbox): conversation list and thread detail at /inbox
9595492 feat(nav): shared queue keyboard navigation hook
```

## Checks

| Check | Result |
|---|---|
| `pnpm lint` (oxlint) | PASS — 0 warnings, 0 errors, 935 files |
| `pnpm exec tsc -b` | PASS |
| `pnpm exec tsc -p convex/tsconfig.json --noEmit` | PASS |
| `pnpm -C worker run typecheck` | PASS (after `pnpm -C worker install --frozen-lockfile`; the worktree's worker deps were not installed — install them before `pnpm build`) |
| `pnpm build` | PASS — `tsc -b` + `vite build` + worker `tsc -p tsconfig.json`; only the pre-existing >500 kB chunk advisory |
| `pnpm exec tsr generate` | n/a — `tsr` is not installed; `vite build` regenerates `src/routeTree.gen.ts` (committed) |

## What shipped

- `/inbox` — layout route owns `tab|cursor|limit` URL search (defaults
  omitted from clean URLs); open/unassigned/takeover/closed tabs map
  exactly to the two indexes `conversations.list` exposes; forward-only
  pager; the `list` query lives inside a `CatchBoundary` scoped to the rows
  so a stale/foreign cursor renders "This page link is no longer valid"
  with First-page/reset instead of killing the route (ux §227).
- `/inbox/$conversationId` — merged thread (component inbound bodies +
  immutable draft revisions), plain-text rendering only (`html` is never
  projected), honest outbound state vocabulary (`draft`, `sent`,
  `definitely_unsent`, `rejected`, `delivery_uncertain` — "accepted by the
  provider" is never "Delivered"), pending-draft link to its own
  `/decisions/$decisionId`, pinned `contextVersion` with a live-update stale
  card, takeover/resume/close/reopen, human-owner + employee assignment,
  unassigned → lead association (separate from resume, and the screen says
  association dispatches nothing), internal notes, suppression warning when
  `lastInboundFrom` is on the list.
- `/decisions` — queue/detail split at `xl`, queue stays mounted for focus
  restore, URL-backed `mission`/`cursor`, no kind/resolved filters (no
  bounded query exists — documented in the route file); j/k/Enter/Escape
  shared with Inbox; heading focused once per decision.
- Edit draft — `EditDraftDialog` on the approval panel calls
  `drafts.revise` with `expectedRevision`, sends only changed fields, uses a
  per-intent requestId, keeps typed text through CONFLICT; the dialog states
  before the click that saving withdraws this ask and opens a fresh one.
- Sidebar — Inbox (badge = `attentionCounts.needsAttention`) and Leads
  (labelled placeholder) added; active matching is exact-or-prefix so
  `/settings-export` cannot light up `/settings`; `/prospects` → `/leads`.
- `/overview` attention block — "Unassigned mail" reads
  `attentionCounts.unassigned` (real count) and links to
  `/inbox?tab=unassigned`; overdue next-actions stays explicitly
  unavailable (no supporting query).
- `/settings` — `?section=` now selects one of seven sections instead of
  stacking them; nav marks owner-only sections before they are opened;
  Account is a real identity card (Hexclave email first, display name as a
  label, Manage-account link to `/handler/account-settings`) and the
  signed-out render is a loading state rather than a blank page;
  Suppressions card under Sending (list/add manual address-or-domain/remove,
  verified unsubscribe/bounce rows remain backend-written); runtime card
  names the next step per recorded state and counts the login challenge
  down live; automation copy states pausing cannot recall mail already with
  the provider; sending-policy copy states the policyVersion bump retires
  approvals.

## Fixture on `dev:flexible-grasshopper-949`

Workspace `jn7c5sj0rh7rza1ssz9yxsea898ee1pz` ("P12 Verification Workspace",
owner `…|a84641bb`, sole active member — the account the earlier lanes'
browser sessions used). All addresses below are `.invalid` fixtures; no
real prospect or mailbox is involved.

| Row | Id | State |
|---|---|---|
| workspace inboxRef | — | `p13-inbox@agentmail.invalid` via `drafts:assignWorkspaceInbox` |
| conversation A | `kx7403py8rv6dk6km2yrsrmrns8ehrzw` | `unassigned`, frozen (`unassigned_inbound`), unread 1, from `walker@fixture.invalid` — association target |
| conversation B | `kx78vkk62bc3pewjy2cs42v0c18ehfjf` | `open`, associated to P21 Probe Co / P12 board verification campaign, carries draft rev 2 + one human note; resumed once during seeding (`dispatched:true`, reply mission `k978gmx0…` parks on runtime — expected: no runtime connection exists) |
| conversation C | `kx7750dzm9erxc0mcbwepm0as58eh45p` | `closed` (+still frozen) — closed tab + reopen target |
| draft | `m173c218fb41swmgx07kmyfps18ehn6t` | revision 2, `basedOnContextVersion` 5, recipient `rep@fixture.invalid` |
| decision | `jx72pthyk3m9t4hf5gn8jb0mds8ehpw2` | open `draft_approval` on rev 2 — the approve/request-changes/reject/edit-draft target |
| decision | `jx77d12dhtcsqhpp5a9qeeqyhd8efe6c` | open `missing_information` — the resolve-with-answer target |
| decision | `jx7aaw6srtvrhv33c7be3gk7v98eeyat` | `cancelled` — closed-decision rendering |
| decision | `jx77x8pgj7qewm2fgwgbwej4c58egqcs` | `superseded` draft_approval — the retired-ask rendering |

## Contract-level verification (CLI, impersonated owner)

Every query/mutation the new UI calls was run with the same arguments the
component sends, against the fixture above:

- `conversations.list` — `open` → B only; `unassigned` → A only;
  `takeover` → A+B+C (all frozen, matching the `humanTakeover` index);
  `closed` → C. `hasMore:false`, `cursor:null` on each.
- `conversations.attentionCounts` → `{unassigned:1, openTakeover:1,
  needsAttention:2}` — the sidebar badge renders 2, the unassigned tab
  badge renders 1. The `openTakeover` vs takeover-tab distinction is
  documented in the component — the tab lists every frozen thread
  (3), the badge counts only open frozen ones (1).
- `conversations.get`/`thread`/`listNotes` on B → prospect+campaign refs,
  one `outbound` entry `{state:"draft", revision:2}`, note list ordered
  newest-first.
- `conversations.associateProspect` → A: `state:open`, `humanTakeover`
  kept, `takeoverReason:"awaiting_resume"`, contextVersion bumped; a
  system note recorded.
- `conversations.resume` — on unassigned A: `CONFLICT` "only an open
  conversation can resume" (the UI gates on state and surfaces this); on
  associated B at v3: `dispatched:true`, `missionId` returned — the reply
  mission then parks on the missing runtime, which the mission surface
  shows as its own honest state.
- `conversations.setTakeover` at `expectedContextVersion:1` against v4 →
  `CONFLICT "conversation context is v4, not v1"` — the exact error shape
  the detail's stale card and action errors display.
- `conversations.close` on C → `closed`, contextVersion 2.
- `drafts.revise` (rev 1 → 2, body-only change) → new draft
  `basedOnContextVersion:5`; the previous `draft_approval` moved to
  `superseded` and a fresh required ask `jx72pthyk3…` opened — the arc the
  Edit-draft dialog promises before the click.
- `sending.preflight` on the current draft → `{permitted:false,
  code:"no_current_approval"}` → the panel renders "Not approved yet",
  not a fake green check.
- `runtimeConnections.getStatus` → `{exists:false}` → "Not connected",
  Connect button (owner).
- `suppressions.list` → `[]`; `suppressions.check rep@fixture.invalid` →
  `{suppressed:false}`.
- `employees.list` → Scout/Researcher/Outreach (assignment picker);
  `workspaces.listMembers` → one active owner (human-owner picker).

## Browser acceptance (J3, J4, J6)

Dev server: `pnpm dev` → `http://localhost:5173` (preview id
`c040c8d8-031b-4f5a-ab6a-d9ca07744e9f`). Sign in as the verification
owner; all routes confirmed serving (200) including `/inbox`,
`/inbox/$id`, `/leads`, `/prospects`, `/settings?section=runtime`.

The rendered walk is the user's two-session pass; each row below is the
step and the expected honest outcome. Items marked **CLI-proven** have
their backend behavior already recorded above; the browser pass confirms
rendering, focus and keyboard behavior, which the CLI cannot see.

### J3 Inbox

1. `/inbox` — four tabs, `open` active; row B shows Open chip,
   "Automation frozen" only if a hold is on (B is currently resumed — the
   take-over button is the live action), Draft-ready chip, unread dot.
   Sidebar Inbox badge reads 2. **CLI-proven data; badge rendering is
   browser.**
2. `?tab=unassigned` — row A, "No lead linked". `?tab=takeover` — A+B+C.
   `?tab=closed` — C. `?cursor=bogus` — boundary error inside the list,
   tabs survive; "Try again"/"First page" recover. URL contains no `tab`
   when on `open`.
3. j/k move the focus ring between rows; Enter opens the focused row;
   the detail H1 takes focus once; Escape returns to the same tab/page
   and focus lands back on the row.
4. Conversation A — "Reply came from" + lead picker; pick "P21 Probe Co —
   discovered — P12 board verification campaign" → "Link the lead" →
   state flips to open, still frozen (`awaiting_resume`); Resume then
   returns the named block (`recipient_unknown` — A has no draft and the
   lead has no contact) with the hold kept on. **CLI-proven resume
   contract; block naming is browser.**
5. Conversation B — thread shows the rev-2 outbound draft entry with the
   pending-draft link "Review and approve this draft" → lands on the open
   `draft_approval`; notes card shows the seeded note + system notes;
   Take over with a reason → frozen card updates (held-since/by); Resume →
   checks pass → `dispatched` toast naming the reply run.
6. Conversation C — read-only notes ("reopen it to add a note"), Reopen →
   returns to open.
7. Two sessions: session A opens B (pins v6+); session B takes B over →
   A's action area is replaced by the stale-version card naming the new
   version; "Load the current version" restores controls. **CONFLICT shape
   CLI-proven.**
8. Mobile viewport (<1280px): list → detail replaces list with "Back to
   inbox"; ≥1280px: list stays beside detail.

### J4 Decisions

1. `/decisions` — queue grouped by mission; the open `draft_approval` and
   `missing_information` asks render; j/k + Enter as in the inbox; ≥1280px
   split shows the pick-a-decision pane.
2. Open `jx72pthyk3…` — exact recipient/subject/body (rev 2, payload hash,
   context/brief/policy versions, evidence), send-checks card reads "Not
   approved yet — which is what this screen is for", Approve/Request
   changes/Reject/**Edit draft**.
3. Edit draft → change the subject → "Save as a new revision" → new
   revision, this ask supersedes live and the queue shows the fresh ask.
   **CLI-proven revise arc.**
4. Request changes with a comment → ask resolves not-approved; or Reject
   with a reason → terminal. Approve is exercisable but schedules a real
   send intent against `rep@fixture.invalid` — safe to approve: the send
   boundary refuses dispatch without a real inbox/provider message, and
   the parked attempt is honestly visible; leave rejected/unapproved if a
   parked intent is unwanted in the fixture.
5. Two sessions: A opens the ask (pins version v), B edits the draft →
   A's stale banner names the new version; typing in A's comment box
   survives. **CONFLICT shape CLI-proven.**
6. Superseded/cancelled asks render the closed card with outcome copy and
   never re-offer buttons.

### J6 Settings/runtime

1. `/settings` — nav shows Account/Workspace/Sending/Automation/Members/
   Runtime/Integrations; owner-marked chips on the owner-only sections;
   `?section=` deep links land on the section.
2. Account — real email + display name, "Manage account" → Hexclave
   handler. No editable-looking read-only fields.
3. Sending — policy fields owner-gated; Suppressions card lists/adds/
   removes (manual rows only).
4. Runtime — `{exists:false}` → "Not connected" + next-step hint; Connect
   provisions a real Box (owner) — live provisioning is the P07/J6 gate;
   sign-in challenge rows show a live countdown when one exists.
5. Integrations — pending/backend-managed rows render muted; only the
   assigned AgentMail inbox row reads as live. Nothing claims a
   connection that does not exist.
6. Second session / non-owner: owner-only sections show the permission
   note instead of the controls. (Only one real member exists on this
   workspace — same single-owner constraint recorded in P12's evidence;
   a second owner session could not be seated.)

## Bounded-query gaps handed to the integrator

- `decisions` has no `byDraft` or `listResolved` — the pending-draft link
  resolves through `drafts.get` + `decisions.listOpen(mission)` and the
  queue offers no resolved view or kind filter until a bounded query
  exists.
- `conversations.thread` merges component inbound + app drafts with no
  shared cursor — `hasMore` means truncated, not fetchable; an "older
  messages" fetch needs a backend contract.
- `conversations.list` is forward-only — there is no previous-page cursor;
  Back/First-page is the recovery, by design, recorded here because the
  pager cannot offer "Previous".
- `workspaces.listMembers` is unbounded (`.collect()`) — fine at demo
  scale; the owner picker would need a bounded query at workspace sizes
  beyond it.
- `prospects.list` in the associate picker is capped at 50 with an honest
  "first N" note — no company-search query exists for it yet.
- No overdue-next-action query exists — the overview attention block
  says so rather than rendering a count.

## Merge surface with `main` (moved after the fork)

`main` advanced to `4abcd5b` ("merge: qa-web frontend fixes") while this
branch was open. Two of its commits overlap this lane:

- `8611ec6` added a queue-local `onQueueKeyDown` j/k handler to
  `DecisionQueue`. This branch replaces it with the shared
  `use-queue-navigation` hook — a strict superset (same keys, plus
  `detailOpen` tracking and focus restoration to the originating row).
  Take this branch's `DecisionQueue` wholesale.
- `a193a8f` kept the stacked settings sections and added element-id +
  `scrollIntoView` deep links, plus an account card fix using the
  **deprecated** `app.urls.accountSettings`. This branch implements the
  lane spec instead — `?section=` selects and renders one section (nav
  marks owner-only sections before opening) and the Account card links
  `/handler/$` `account-settings`, which `HexclaveHandler` maps to its
  real `AccountSettings` page in-app (verified in
  `components-page/hexclave-handler-client.js:40`). Conflict files:
  `src/routes/_dashboard/settings.tsx`,
  `src/components/settings/SettingsSections.tsx` — the integrator should
  take this branch's versions (theirs are interim scroll behavior).

## Known limitations / deferrals

- Browser session evidence requires the verification owner's Hexclave
  login — CLI proof covers every backend contract the UI consumes; the
  rendered walk (focus, keyboard, live-update staleness, mobile
  breakpoints) is the checklist above for the signed-in pass.
- No `delivery_uncertain` decision could be seeded — it exists only after
  a real send attempt; the panel's render is unchanged from P10/P12
  review, untested against live data here.
- Inbound message bodies in the thread come from the agentmail component,
  which only the signed webhook writes — `AGENTMAIL_WEBHOOK_SECRET` is set
  on the deployment but is not available locally, so the seeded threads
  show outbound-draft entries and empty inbound halves; the plain-text
  inbound render is the same code path P11's evidence graded.
- `pnpm -C worker install` was needed once in this worktree; record it in
  the worktree README/procedure for future lanes.
