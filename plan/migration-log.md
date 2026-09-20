# Migration log

The record of how the pre-pivot data model was moved to [PLAN.md](PLAN.md) §7,
and the runbook production still has to be taken through. Companion to
[MIGRATION.md](MIGRATION.md), which holds the reasoning; this file holds what
actually happened and what will actually be typed.

Nothing in the production runbook runs without the owner's explicit go, per
`AGENTS.md` and EXECUTION §0 "Who may touch a deployment".

---

## 1. Path taken

**Clean-slate (MIGRATION.md "Decision" + §6).** The owner confirmed on
2026-09-20 that there are no real users and no data worth keeping on either
deployment. §1–§5 (compatibility release C, widen → backfill → narrow, the
down migrations) were therefore **not built and not executed**; they stay in
MIGRATION.md as the reference for the day real data exists.

What the clean-slate path still insists on, and what this task built:

| §6 step | Where it lives |
|---|---|
| §6.1 freeze + drain | runbook §4 A, executed against the code production runs **today** — see the note there |
| §6.2 export | runbook §4 B |
| §6.3 clear everything except `workspaces`, `memberships`, `suppressions` | `convex/migrations/clear.ts` + `convex/migrations/tables.ts` |
| §6.4 two shape migrations | `convex/migrations/shape.ts` |
| §6.4 trial credit buckets | **not here** — T02's grant, see §6 Open items |
| §6.5 deploy the final schema | runbook §4 G |
| §6.6 prove suppression works | precondition query `convex/migrations/verify.ts`; the live preflight itself is a manual check, runbook §4 I |
| §6.7 unfreeze | runbook §4 J |
| §6.8 record it | this file |

Component: `@convex-dev/migrations@0.3.6`, registered in
`convex/convex.config.ts` between Firecrawl and static hosting (static hosting
must stay last — it owns the root catch-all). Nothing in the request path
touches it; it is cutover-only tooling.

---

## 2. What happened on dev (2026-09-20)

Recorded as it happened, not as the runbook says it should have happened.
**The runbook was not followed on dev.** On test data that cost nothing, but
it did cost us the rehearsal, and that is stated plainly below rather than
papered over.

**~21:40 — first census (spikes.md §8, read-only).** Dev still ran the
pre-pivot code and held pre-pivot documents:

| Table | Rows |
|---|---|
| `workspaces` | 31 (`automationState` on 31/31, `inboxRef` on 6/31) |
| `memberships` | 31 |
| `suppressions` | 1 |
| `prospects` | 40 (8 with a contact) |
| `campaigns` | 30 |
| `conversations` | 10 |
| `drafts` | 5 |
| `usageReservations` | 101 |
| `businessProfiles` | 1 |
| `quarantinedEmailEvents` | 3 |
| `_scheduled_functions` | 33, **all `success`, none pending** |

All of it seed/test data from the pre-pivot build.

**~22:30 — the owner cleared dev from the dashboard and started `convex dev`
from `main`.** Specifically:

- the clear included **`workspaces` and `memberships`**, which MIGRATION §6.3
  says to keep;
- **no freeze was recorded** (no `automationState` pause, no verification that
  the pause held, no `reserved`/`requesting`/`uncertain` drain);
- **no export was taken first** — there is no pre-clear dev backup;
- the single `suppressions` row survived the clear, but its `workspaceId` now
  pointed at a deleted workspace. An opt-out owned by a workspace that does
  not exist suppresses nothing — it is a row, not a protection.

**~23:35 — the final T01 schema was rejected on push** until the last
pre-pivot rows were cleared by the owner: 1 `businessProfiles`, 3
`quarantinedEmailEvents`, and the orphaned `suppressions` row. Dev has run the
final PLAN §7 schema since, with **every schema table empty**.

Rows remain only in tables that are **no longer in the schema** — `missions`,
`runs`, `decisions`, `missionProspects`, `missionComments`,
`providerConnections`, `runtimeConnections`, `runtimeControlRequests`. They
are unreachable from application code (`ctx.db.query` only accepts names in
the data model) and are deleted from the dashboard at clean-up time. They do
not block a deploy.

Dev environment after the reset: `ENRICH_API_KEY`, `FIRECRAWL_API_KEY`,
`FIRECRAWL_WEBHOOK_SECRET`, `VITE_HEXCLAVE_PROJECT_ID` set;
`AGENTMAIL_API_KEY` and `AGENTMAIL_WEBHOOK_SECRET` no longer set.

### Consequences, stated plainly

1. **The dev restore rehearsal (MIGRATION §5 last row) cannot be done from a
   pre-clear export, because no such export exists.** MIGRATION §5's
   "Rehearsal" section and T06's "Done when" both assume one. What can still
   be rehearsed on dev is the *mechanism* — export the current dev state,
   `import --replace` it back, confirm the deployment still runs — which
   proves the commands and the operator's hands, not the pre-pivot data path.
   That substitute is listed as an open item, not ticked as the real thing.
2. **The "a kept suppression is refused by a real preflight" proof cannot be
   done on the migrated dev rows, because there are none.** It becomes a
   wave-0 checklist item for the integrator: create a fresh workspace, add a
   suppression, run a real send preflight to that address, record the refusal
   and its reason here. Row counts are explicitly not accepted as proof
   (MIGRATION §6.6).
3. **Production is untouched.** It has not been read, cleared or deployed to.
   It gets MIGRATION §6 exactly, via §4 below, and only after the owner says
   go.
4. The production census of MIGRATION §0 / spikes §8 has **not** been taken.
   It is step A0 of the runbook.

---

## 3. The ordering problem, and how the cutover solves it

The two facts that collide:

- the final PLAN §7 schema **rejects** pre-pivot documents — kept rows carry
  fields the pivot removed and lack fields the new model requires, and Convex
  validates every existing document against the pushed schema;
- the migration code that fixes those documents **cannot be deployed under
  that schema**, because deploying it means pushing the schema it comes with.

So "deploy the final schema, then run the migrations" is impossible, and
"run the migrations, then deploy" has nowhere to run them from.

**Chosen resolution: a short-lived cutover deploy with schema validation off.**

A cutover commit on a branch (`cutover/prod-<date>`, never merged into `main`)
is `main` plus **one** change: `convex/schema.ts`'s `defineSchema(...)` gains
`{ schemaValidation: false }`. The field definitions, indexes and every line
of application code are already the final ones — the only difference is that
Convex does not enforce the document shape while the cutover runs. That commit
is deployed, the clear + shape migrations + verification run under it, and
then `main` itself is deployed with validation back on. The final deploy is
the real gate: if any document still violates PLAN §7, that deploy fails and
changes nothing.

Why not the alternatives:

- **A widened compatibility schema (MIGRATION §2's release C)** — every new
  field `v.optional`, every removed field still declared. It works, but it is
  a second hand-written schema to keep correct, and its whole value is that
  pre-C application code keeps running against half-migrated data. On the
  clean-slate path there is no half-migrated state worth serving: the app is
  frozen and 22 of 25 tables are being emptied. The cost is real and the
  benefit is not.
- **Clear everything from the dashboard, including `workspaces`** — what
  happened on dev. It destroys the one thing that must never be lost: a
  suppression is owned by a `workspaceId`, so clearing `workspaces` turns
  every opt-out into a row that matches no preflight. Rejected.
- **Re-import suppressions afterwards** — same defect. The imported row points
  at a workspace id that no longer exists. Rejected (MIGRATION §6 preamble).

Two things the cutover deploy does **not** fix, deliberately:

- rows in tables that are no longer in the schema are unreachable either way;
  they are deleted from the dashboard after the rollback window closes;
- `schemaValidation: false` turns off validation for the whole deployment
  while it is deployed. That is why the window is minutes, why the
  application is frozen throughout, and why step G is not optional.

---

## 4. Production cutover runbook

Read this whole section before typing anything. Conventions:

- **(owner)** — the owner runs it. **(integrator)** — the integrator runs it.
- **Every production command needs the owner's explicit go, each time.** The
  runbook being approved is not the go for the next command.
- Commands assume the repository root, the cutover branch checked out where
  stated, and a production deploy key in the environment. `npx convex deploy`
  targets **production** by default; `run`, `data`, `export` and `import` need
  `--prod` explicitly.
- Stop at the first unexpected result. Nothing here is time-critical once the
  freeze holds.

### A. Freeze and drain — against the code production runs *today*

Production currently runs the **pre-pivot** build. None of the code in
`convex/migrations/**` is deployed yet, and `PLATFORM_PAUSED` (T02) does not
exist. The freeze therefore uses the lever the *running* application already
enforces: `workspaces.automationState`. The pre-pivot `convex/sending.ts`
(send preflight) and `convex/inbox.ts` (inbound automation gate) both refuse
unless it is `"active"` (MIGRATION §4.0).

- **A0 (owner + integrator).** Take the production census that MIGRATION §0
  and spikes §8 defer. Read-only:
  ```sh
  npx convex data --prod workspaces --limit 5
  npx convex data --prod memberships --limit 5
  npx convex data --prod suppressions --limit 5
  npx convex data --prod prospects --limit 5
  npx convex data --prod conversations --limit 5
  ```
  plus the row counts per table from the production dashboard. Record them in
  §5's "before" column. If this census shows a real workspace, a real
  conversation or a suppression that belongs to a real person, **stop**: the
  path decision was made on the premise that none exists, and it has to be
  remade with the owner before anything else happens.
- **A1 (owner).** Record the currently deployed production commit (dashboard →
  Deployment, or `git rev-parse HEAD` of whatever was last deployed). Write it
  in §5. It is the rollback target for a full restore and nothing else is.
- **A2 (owner).** Pause every workspace: set `automationState = "paused"` on
  every row of `workspaces`, and **write down each workspace's prior value**
  in §5 so the unfreeze can restore it. The pre-pivot `setAutomationState` is
  an owner-authenticated *public* mutation, so `npx convex run` cannot drive
  it per workspace — edit the rows in the production dashboard's data editor.
  If the census shows too many rows to hand-edit, add a throwaway
  `internalMutation` that pauses all rows to the **pre-pivot** checkout,
  deploy only that, and record what was deployed.
- **A3 (integrator).** Verify the freeze; do not assume it. Trigger a send
  preflight for a test draft in one workspace → it must be refused with
  "workspace automation is paused". Deliver a signed test inbound event → it
  must be stored with no draft produced. Record both in §5.
- **A4 (integrator).** Drain in-flight sends. `sendAttempts` must have **zero
  rows in `reserved` and zero in `requesting`**; then reconcile every
  `uncertain` attempt by idempotency key. Do not proceed while any of the
  three is non-empty. `requesting` means a provider call is on the wire.
- **A5 (integrator).** Drain scheduled work. List pending
  `_scheduled_functions` (dashboard → Schedules). Scheduled calls reference
  functions **by path**, and both this cutover and T05 change paths, so a
  pending call to a moved function fails with "function not found" when it
  fires. With the workspaces paused, let short-lived ones finish and
  **cancel** the rest. Record what was cancelled in §5. Crons are re-registered
  by each deploy and need nothing.
- **A6.** Inbound mail is **not** frozen and must not be — it keeps being
  stored throughout. Only automation on top of it is paused.

### B. Export

- **B1 (owner).**
  ```sh
  npx convex export --prod --path ~/opensquad-backups/pre-pivot-<YYYY-MM-DD>.zip
  ```
  MIGRATION §4.1 says "outside git", and it means it: `backups/` is **not**
  in `.gitignore`, so an export written into the repository would be a
  candidate for commit. Write it outside the working tree — the path above, or
  anywhere the owner keeps backups. Record the file's path, size and SHA-256
  in §5. **Do not continue until the file exists and is non-zero.** This is
  the only rollback that reaches pre-pivot code.

### C. Deploy the cutover commit

- **C1 (integrator).** From the integrated `main` tip that contains T06:
  ```sh
  git checkout -b cutover/prod-<YYYY-MM-DD>
  ```
  Edit `convex/schema.ts` only, turning
  `export default defineSchema({ … })` into
  `export default defineSchema({ … }, { schemaValidation: false })`, and
  commit it as `chore(migration): deploy with schema validation off for the cutover`.
  This branch is never merged into `main`.
- **C2 (integrator).** Verify locally before it goes anywhere:
  ```sh
  pnpm lint && pnpm exec tsc -b && pnpm exec tsc -p convex/tsconfig.json --noEmit && pnpm build
  ```
- **C3 (owner's go, integrator runs).** Push functions only — the SPA is not
  rebuilt here:
  ```sh
  npx convex deploy
  ```
  If this fails, nothing has changed: production is still on the pre-pivot
  commit and still frozen. Fix and retry.

### D. Clear (MIGRATION §6.3)

Empties every schema table **except** `workspaces`, `memberships` and
`suppressions`. The clearable list is derived from `convex/schema.ts` at
runtime, so a table added later is cleared by default rather than forgotten
(`convex/migrations/tables.ts`).

- **D1 (integrator).** Dry run — reports the first table with rows and deletes
  nothing:
  ```sh
  npx convex run --prod migrations/clear:clearAppTables \
    '{"confirm":"yes-clear-every-app-table-except-workspaces-memberships-suppressions","dryRun":true}'
  ```
- **D2 (owner's go, integrator runs).** For real. It deletes one batch and
  schedules itself for the next until nothing is left:
  ```sh
  npx convex run --prod migrations/clear:clearAppTables \
    '{"confirm":"yes-clear-every-app-table-except-workspaces-memberships-suppressions"}'
  ```
  The confirmation literal is an argument validator, not a convention: any
  other value is rejected, so `'{}'` cannot empty a deployment.
  Add `"oneBatchOnly":true` to step through it by hand instead of letting it
  self-schedule. It is resumable: a re-run continues from what is still there.
- **D3 (integrator).** Confirm it finished:
  ```sh
  npx convex run --prod migrations/clear:clearProgress '{}'
  ```
  Required: `cleared: true`, `nonEmpty: []`. Record it in §5.

### E. Shape migrations (MIGRATION §6.4)

Three, through the migrations component: batched, cursor-resumable,
idempotent (each writes the document with `db.replace`, so a second run writes
the same value), dry-run supported.

- **E1 (integrator).** Dry run each — runs one batch and rolls it back:
  ```sh
  npx convex run --prod migrations/shape:workspacesToFinalShape   '{"dryRun":true,"reset":true}'
  npx convex run --prod migrations/shape:membershipsStripRemoved  '{"dryRun":true,"reset":true}'
  npx convex run --prod migrations/shape:suppressionsStripRemoved '{"dryRun":true,"reset":true}'
  ```
  Record counts and, on any failure, the first failing document id — every
  guard in `shape.ts` names the document it refused.
- **E2 (owner's go, integrator runs).** For real, in this order:
  ```sh
  npx convex run --prod migrations/shape:workspacesToFinalShape   '{}'
  npx convex run --prod migrations/shape:membershipsStripRemoved  '{}'
  npx convex run --prod migrations/shape:suppressionsStripRemoved '{}'
  ```
  Or as one serial run:
  ```sh
  npx convex run --prod migrations/shape:run \
    '{"fn":"migrations/shape:workspacesToFinalShape","next":["migrations/shape:membershipsStripRemoved","migrations/shape:suppressionsStripRemoved"]}'
  ```

  What `workspacesToFinalShape` does, so §5 can be read against it:
  *preserves* `name`, `ownerIdentityKey`, `timezone`, `createdAt`,
  `updatedAt`, and the send policy where the stored value is structurally
  valid; *resets* `plan: "trial"`, `automationState: "paused"` with
  `pauseReason: "onboarding_pending"`, `inboxConnection: "none"` with every
  inbox field dropped, `opensObserved: false`, and a freshly generated
  `webhookToken`; *removes* every pre-pivot field by writing the document
  rather than patching it. A workspace with no `ownerIdentityKey` fails the
  batch by design — it would be a workspace nobody can ever sign in to.
  §6.4's "reset `onboardingStep`" needs nothing: in the final schema that
  field lives on `agents`, which step D emptied.

  `membershipsStripRemoved` and `suppressionsStripRemoved` strip removed
  fields only. A suppression with no `normalizedValue`, an unmapped `kind` or
  an unmapped `reason` fails the batch rather than being written as something
  no preflight will match.

- **E3 (integrator).** Re-run one of them to confirm idempotence; the second
  run must report the same document count and change nothing.

### F. Verify the §6.6 precondition

- **F1 (integrator).**
  ```sh
  npx convex run --prod migrations/verify:suppressionOwnership '{}'
  ```
  Required: `ok: true`, `orphaned: 0`, `orphanedIds: []`, `truncated: []`.
  Record `suppressionsScanned`, `ownedByLiveWorkspace`,
  `workspacesWithSuppressions` and
  `workspacesWithSuppressionsAndNoActiveMember` in §5.

  A non-zero `orphaned` means the opt-outs it names protect nobody. **Stop.**
  The query never repairs anything — what to do with a dangling opt-out is the
  owner's decision, not a verification step's.
  A non-empty `truncated` means the scan hit its cap and the answer is
  partial; a partial scan is not a proof.

### G. Deploy the final schema

- **G1 (owner's go, integrator runs).** Back to `main`, validation on:
  ```sh
  git checkout main
  npx convex deploy
  ```
  This is the real gate. If any document still violates PLAN §7 the deploy
  fails and nothing changes — production stays on the cutover commit, which
  runs fine, so there is no time pressure. Fix, redeploy the cutover commit if
  needed, re-run E/F, retry.
- **G2 (integrator).** Confirm the deployed schema has validation on (the
  cutover commit is not in `main`'s history) and that the function list no
  longer contains anything pre-pivot.
- **G3 (owner's go, integrator runs).** Rebuild and publish the SPA:
  ```sh
  pnpm run deploy
  ```
  (`static-hosting deploy` builds, runs `npx convex deploy`, then uploads the
  static assets.)

### H. Trial credits for the kept workspaces

- **H1 (owner's go, integrator runs).** The kept workspaces were created
  before the credit model existed and hold no buckets. **T06 does not grant
  them** — the grant is T02's code and must not be duplicated here. The
  cutover runs T02's grant over every kept workspace.
  ```sh
  npx convex run --prod workspaces/trialGrant:backfillTrialBuckets '{}'
  ```
  **This function does not exist yet.** T02 must provide an idempotent,
  internal, batched mutation that grants the trial buckets for workspaces that
  have none — see §6 Open items for the exact requirement. Until it exists,
  this step is blocked and the kept workspaces have no allowance.

### I. Prove suppression works (MIGRATION §6.6)

- **I1 (integrator).** For **each** workspace that holds suppressions (count
  from step F1), take one suppressed address and run a real send preflight
  through the ledger. It must be **refused with the suppression reason**.
  Record the workspace, the reason string and the refusal in §5.
  A matching row count is not proof and is not accepted.
- **I2 (integrator).** Sign in as the owner: the workspace loads, it is empty,
  and onboarding starts at the first step.

### J. Unfreeze and clean up

- **J1 (owner).** Restore each workspace's recorded `automationState` from
  §5's "prior value" column. Note that `workspacesToFinalShape` set every
  workspace to `paused` / `onboarding_pending` on purpose: an empty,
  un-onboarded workspace must not be returned to `active` just because it was
  active before the pivot. In practice the unfreeze is a no-op for any
  workspace that has not been through onboarding; record the decision per
  workspace rather than bulk-restoring.
- **J2 (integrator).** Confirm no pending `_scheduled_functions` row points at
  a pre-pivot or pre-T05 function path.
- **J3 (owner + integrator), after the rollback window closes (not on cutover
  day).** Delete the rows of tables no longer in the schema — `missions`,
  `runs`, `decisions`, `missionProspects`, `missionComments`,
  `providerConnections`, `runtimeConnections`, `runtimeControlRequests` — from
  the production dashboard. They are unreachable from code, so this is
  tidying, not a fix. Keep the export until it is done.

### Rollback

The only rollback on the clean-slate path is the **full restore** row of
MIGRATION §5. There is no compatibility release C to fall back to, because
none was built.

| Where it went wrong | What to do |
|---|---|
| C3 (cutover deploy) fails | Nothing changed. Production is on the pre-pivot commit and frozen. Fix and retry. |
| D/E fails part-way | Stay on the cutover commit — validation is off, so partially cleared or partially migrated data is deployable and readable. Both steps are resumable: fix and re-run. |
| F fails | Same. G is not deployed, so the final schema has not been pushed. Do not proceed. |
| G1 fails | The deploy is rejected atomically; production stays on the cutover commit. Re-run E/F and retry. |
| Data is wrong, or the decision is reversed after G | **(owner)** Confirm the freeze still holds (§A), then: `npx convex import --prod --replace ~/opensquad-backups/pre-pivot-<date>.zip`, then deploy the commit recorded in A1 (valid again, because the data is pre-pivot again). Then replay provider mail events for the gap — webhook dedupe by event id makes replay safe — and re-apply any suppression added during the gap from §5 **before** unfreezing. |

Rollback is decided by the owner and the integrator together. It is never
automatic.

---

## 5. Verification results — production

**Not yet run.** Production has not been read, cleared or deployed to. Fill
this in at cutover; leave the rows in place and unticked until then.

### Census and freeze

| Item | Value | Recorded by | When |
|---|---|---|---|
| A0 row counts per table (before) | | | |
| A0 real vs test data judgement | | | |
| A1 deployed pre-pivot commit | | | |
| A2 prior `automationState` per workspace | | | |
| A3 send preflight refused while paused | | | |
| A3 inbound event stored, no draft | | | |
| A4 `sendAttempts` reserved / requesting / uncertain at zero | | | |
| A5 scheduled functions cancelled | | | |
| B1 export path · size · SHA-256 | | | |

### Migration

| Item | Result | Recorded by | When |
|---|---|---|---|
| C3 cutover deploy | | | |
| D1 clear dry run | | | |
| D2 clear, total rows deleted per table | | | |
| D3 `clearProgress` → `cleared: true` | | | |
| E1 shape dry runs (counts, first failing id if any) | | | |
| E2 workspaces migrated | | | |
| E2 memberships migrated | | | |
| E2 suppressions migrated | | | |
| E3 re-run idempotent | | | |
| F1 `suppressionOwnership` → `ok`, counts | | | |
| G1 final schema deployed, validation on | | | |
| G3 SPA deployed | | | |
| H1 trial buckets granted for kept workspaces | | | |

### The checks that are not row counts

| Item | Result | Recorded by | When |
|---|---|---|---|
| I1 per workspace: suppressed address refused by a **real** preflight, with the reason | | | |
| I2 owner signs in, empty workspace, onboarding starts | | | |
| J1 automation state restored / deliberately left paused, per workspace | | | |
| J2 no pending scheduled call on an old function path | | | |
| J3 out-of-schema tables deleted | | | |

---

## 6. Open items

1. **The full-restore rehearsal on dev is not done, and cannot be done as
   written.** MIGRATION §5's rehearsal and T06's "Done when" both assume a
   pre-clear dev export; none was taken (§2). The substitute — export current
   dev, `npx convex import --replace` it back, confirm the deployment still
   runs — exercises the commands and the operator but not the pre-pivot data
   path. Owner to decide whether the substitute is accepted or whether the
   rehearsal is dropped with the reason recorded. Not ticked either way until
   then.
2. **The "a kept suppression is refused by a real preflight" proof is a
   wave-0 checklist item.** Dev has no migrated rows to prove it on (§2). The
   integrator creates a fresh workspace, adds a suppression, runs a real send
   preflight to that address, and records the refusal and its reason in §5.
3. **T02 must provide the trial-credit grant the cutover runs (step H1).**
   Required: an **internal**, batched, idempotent mutation in
   `convex/workspaces/` that grants the PLAN §6 trial buckets to every
   workspace that has none, and is safe to run twice. Suggested names, to be
   confirmed by T02: `internal.workspaces.trialGrant.backfillTrialBuckets({})`
   over all workspaces, built on the per-workspace
   `internal.workspaces.trialGrant.grantTrialBucketsForWorkspace({ workspaceId })`
   that workspace creation also calls. Until it exists, kept workspaces have
   no allowance and step H is blocked.
4. **`generateWebhookToken` is module-private in `convex/workspaces.ts`.**
   `convex/migrations/shape.ts` could not import it (and T05 is moving that
   file), so it imports the shared `WEBHOOK_TOKEN_LENGTH` and repeats the
   construction — the same 32 CSPRNG bytes as lower-case hex. Two copies of a
   security-relevant generator is one too many: when T05 lands, export it from
   its new home and have `shape.ts` import it.
5. **The migrations component's function signatures carry no `returns`
   validator.** `migrations.define` registers the mutation itself with the
   component's own `args` validator and no return validator, so the three
   shape migrations are the one place in `convex/` that does not meet
   EXECUTION §0.6's "validators on args and returns". `clearAppTables`,
   `clearProgress` and `suppressionOwnership` — all hand-written — do.
6. **Rows in out-of-schema tables are still present on dev** (`missions`,
   `runs`, `decisions`, `missionProspects`, `missionComments`,
   `providerConnections`, `runtimeConnections`, `runtimeControlRequests`).
   Unreachable from code; delete from the dev dashboard whenever convenient.
7. **`convex/_generated/api.d.ts` was hand-edited** for the four new
   `migrations/*` modules and the `migrations` component, because task agents
   have no deployment access. The integrator regenerates after the merge and
   takes codegen's version over this one.
