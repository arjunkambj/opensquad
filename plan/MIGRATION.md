# Migration runbook

Moves an existing deployment from the pre-pivot data model to
[PLAN.md](PLAN.md) §7 without losing conversations, suppressions, approvals or
usage history. Owned by the integrator (EXECUTION T01 + T06). Dev first, then
production, never the other way round.

Why this is mandatory, not optional: Convex validates every existing document
against the pushed schema. Documents in kept tables still carry fields the
removal dropped (mission / run / decision ids, the old source plan) and lack
fields the new model requires, so a straight deploy of the new schema **fails**
on any deployment that has data. Tables that were removed from the schema
(`missions`, `runs`, `employees`, …) do not block a deploy; their rows simply
become unreachable and are cleaned up at the end.

## Tenancy note (2026-09-21)

The tenant is now the auth provider's organization (PLAN §4, EXECUTION T44):
`workspaces` became `orgs` keyed by `hexclaveOrgId`, every `workspaceId` became
`orgId`, and `memberships` no longer exists. Wherever this runbook says
"keep `workspaces`, `memberships` and `suppressions`", read "keep `orgs` and
`suppressions`"; the clear step's confirmation literal is
`yes-clear-every-app-table-except-orgs-suppressions`. One thing this runbook
cannot decide: production's pre-pivot `workspaces` rows carry no organization
id, so at cutover each kept row is either mapped to its owner's personal
organization through the auth provider's server API, or cleared together with
its suppressions' ownership re-pointed. That is the owner's call
(`plan/migration-log.md`, open item 8); the shape migration fails loudly on
such rows rather than inventing an id.

## Decision (2026-09-20): clean-slate path

The owner confirmed there are no real users and no data worth keeping, on dev
or production. **Use §6.** Sections §1–§5 stay as the reference for the day
real data exists; they are not executed now. Still take the export (§6.2), and keep `workspaces`, `memberships` and
`suppressions` in place (§6.3) — an opt-out is the one thing that must never be
lost, and it only works while the workspace that owns it still exists.

## 0. Decide the path (user decision, before T01)

Run on production, read-only:
`npx convex data <table> --prod --limit 5` for `workspaces`, `prospects`,
`conversations`, `suppressions`, and the row counts from the dashboard.

- **Only seed/test data** → *Clean-slate path* (§6): export, clear, deploy.
  Short; keeps workspaces, memberships and suppressions, clears the rest.
- **Any real workspace, conversation or suppression** → *Full path* (§1–§5).
- Suppressions are the one table that is preserved on **both** paths: losing
  an opt-out is the only irreversible harm here.

## 1. Mapping

| Old | New | Rule |
|---|---|---|
| `campaigns` row | `agents` row | **One agent per workspace** (the trial rule). The *primary* campaign — the active one, else the most recently updated — becomes the agent. Every other campaign of that workspace is folded in: its prospects are re-pointed to the primary agent and tagged `legacyCampaignId`, its brief is appended to the agent's `instructions` under a dated heading, and the campaign row is kept read-only in a `legacyCampaigns` table so nothing is silently discarded. `name` = primary campaign title. `mode`: campaign `active` → `review`, anything else → `paused`; **never `autopilot`** — Autopilot requires fresh consent (PLAN §9.3). `instructions` = brief + instruction text. `icp`, `goal`, `tone` from the workspace's `businessProfiles` where present, else empty with `onboardingStep: "icp"` so the user is walked through it. `legacyCampaignId` kept for traceability. |
| `campaigns.sourcePlan` | — | dropped (provider-specific, no equivalent). |
| `prospects` row **with** `contact` | `prospects` row (person) | same `_id` — nothing that references it changes. Person fields from `contact`; `companyName` / `canonicalDomain` stay as the person's company. `agentId` = mapped agent. `origin: "legacy"`, so `sourceLeadId` is absent **by schema variant, not by omission** (see "Final-schema variants" below). `emailStatus`: contact email present → `found`, else `locked`. `approval`: `approved` if the prospect was ever contacted, else `pending`. `research: { status: "not_researched" }` — no score, shown as "Not researched yet"; researched only if the user asks. |
| `prospects` row **without** `contact` | `prospects` row, archived | kept, `stage: "rejected"`, `stageReason: "legacy_company_only"`, hidden from the default Contacts view, visible under an "Archived" filter. Not deleted: `leadEvents`, `evidence`, `conversations` may point at it. |
| `prospects.salesStage` | `prospects.stage` | `new`/`qualified` → `researched`; `contacted` → `contacted`; `replied` → `replied`; `interested` → `interested`; a prospect with a `bookings` row in state `confirmed` (the old system only set that on an explicit human confirmation) → `meeting_booked`, booking row kept as is; any other meeting stage, or a booking in any non-confirmed state → `meeting_proposed` (PLAN §9.5); `lost`/`disqualified` → `closed_lost` / `rejected`. Exact source union is read from the old validators in T01; any unmapped value fails the dry run rather than defaulting. |
| `conversations`, `conversationNotes`, `emailEventReceipts`, `quarantinedEmailEvents` | unchanged | strip removed id fields only. Add `source: "live"` to existing message-bearing rows so none is mistaken for backfill. |
| `drafts`, `approvals`, `sendAttempts` | unchanged | strip removed id fields. Pending drafts from the old system are marked `superseded` — they were written by a runtime that no longer exists and must not be sent by the new loop. Approved-and-sent history is untouched. |
| `suppressions` | unchanged | verified row-for-row (count + checksum of normalised addresses) before and after. |
| `usageBuckets`, `usageReservations` | kept | old metrics (`sends`, research) keep their rows as history. **No reservation is released by the migration.** `reserved` rows whose operation provably never reached a provider (no `providerOperations` row, no `sendAttempts` row past `reserved`) → `released`. Everything else — `uncertain`, or `reserved` with any evidence of a started call — is reconciled first (send ledger lookup by idempotency key); if it still cannot be proven uncharged it is **committed**, never released, and listed in the migration log. New lifetime buckets (`credits`, provider caps) are **granted at the trial size minus nothing** — history is not charged against the new allowance. |
| `providerOperations`, `activityEvents`, `leadEvents`, `evidence`, `bookings` | kept | strip removed id fields; unknown legacy `activityEvents.kind` values are kept under a `legacy` kind so the feed never throws. |
| `workspaces` | extended | `plan: "trial"`, `webhookToken` generated. Existing platform-key inbox: `inboxRef` kept, connection status `legacy_platform_inbox` — receives mail as before until the user connects their own key (§4). |

### Final-schema variants (what "narrow" must accept)
The final schema cannot make `sourceLeadId` and a score unconditionally
required, because migrated and not-yet-researched leads legitimately lack
them. PLAN §7 models this with discriminated unions, and the migration writes
exactly these variants:
- `origin`: `{ kind: "sourced", sourceLeadId, strategyIds }` \| `{ kind: "legacy", legacyCampaignId }` \| `{ kind: "manual" }`.
- `research`: `{ status: "not_researched" }` \| `{ status: "researching", startedAt }` \| `{ status: "researched", aiScore, aiScoreReason, summary, researchedAt }` \| `{ status: "failed", lastError }`.
Dedupe on `sourceLeadId` applies to `origin.kind = "sourced"` only. The
verification step asserts every migrated prospect is `legacy` +
`not_researched` and validates against the final schema **before** deploy B.

## 2. Technique: widen → backfill → narrow

Uses `@convex-dev/migrations` (resumable, batched, idempotent, dry-run).

1. **Compatibility release C (deploy A).** A tagged commit
   (`release/compat-C`) and **the only rollback target** in this runbook.
   Schema accepts both shapes: every new field `v.optional`, every removed
   field still declared `v.optional`, new tables added, `campaigns` still
   present. Code reads new-or-old for **every** field the backfill touches and
   never *requires* a field the backfill removes. C is what makes rollback
   possible: Convex object validators reject undeclared fields, so any commit
   older than C **cannot** be deployed onto data that has new fields, and any
   commit newer than deploy B cannot run on un-migrated data.
2. **Backfill.** Migrations in `convex/migrations/`, each idempotent and
   independently re-runnable, in this order:
   `m01_workspaces` → `m02_agentsFromCampaigns` → `m03_prospectsToPeople` →
   `m04_stripRemovedIds` (one per kept table) → `m05_supersedeLegacyDrafts` →
   `m06_usageBuckets` → `m07_conversationSource`.
   Every migration first runs with `dryRun: true` and logs counts + the first
   failing document id.
3. **Verify** (§3). Nothing proceeds on a failed check.
4. **Narrow (deploy B).** Final schema from PLAN §7: new fields required,
   removed fields gone, `campaigns` removed. If any document still violates it,
   the deploy fails safely and nothing changes.
5. **Clean up** (a week later, not during the hackathon): delete rows of tables
   no longer in the schema.

## 3. Verification (recorded in `plan/migration-log.md`)

Counts before vs after, per workspace:
- agents = campaigns; people + archived = old prospects; **no prospect `_id` changed**.
- conversations, notes, approvals, sendAttempts, suppressions: identical counts;
  suppressions also identical address checksum.
- every `prospects.agentId` resolves; every `conversations.prospectId` resolves.
- zero documents with a removed field (`m04` dry run reports 0).
- zero drafts in a sendable state that predate the cutover.
- zero agents in `autopilot`; exactly one agent per workspace; every extra
  campaign present in `legacyCampaigns`.
- every migrated prospect validates against the **final** schema (run the
  final validators over the table in a query before deploy B).
- prospects whose booking is `confirmed` are `meeting_booked`, and no other
  prospect is.
- **Suppression works, not just exists:** for a sample of suppressed
  addresses per workspace, a real send preflight through the ledger is
  refused with the suppression reason.
- no reservation changed from `uncertain`/started to `released`.
Spot checks in the UI: open three old conversations end to end; confirm a
suppressed address is refused by the send ledger; confirm Usage shows history.

## 4. Cutover

### 4.0 Prerequisite: a freeze that actually freezes
`PLATFORM_PAUSED` does not exist yet when this runs (EXECUTION T02 introduces
it, after T06) and the deployed code never reads it. The freeze uses what the
running application already enforces:
1. **Pause every workspace** with the existing lever: set
   `workspaces.automationState = "paused"` for all rows via an internal
   mutation (remember the prior value per workspace in `migration-log.md` for
   the unfreeze). `convex/sending.ts` (send preflight) and `convex/inbox.ts`
   (inbound automation gate) both refuse unless it is `"active"`.
2. **Verify the freeze, do not assume it:** trigger a send preflight for a
   test draft in one workspace → refused with "workspace automation is
   paused"; deliver a signed test inbound event → stored, no draft produced.
3. **Drain in-flight sends.** Wait until `sendAttempts` has **zero rows in
   `reserved` *and* `requesting`**. `requesting` means a provider call is on
   the wire; it resolves to `acknowledged`, `definitively_failed` or
   `uncertain` within the action timeout. Then reconcile every `uncertain`
   attempt by idempotency key. Do not proceed while any of the three states is
   non-empty.
4. **Drain scheduled work.** List pending scheduled functions (dashboard →
   Schedules, or `_scheduled_functions`). They reference functions **by path**,
   and T05 later renames paths — a pending call to a moved function fails with
   "function not found" when it fires. Therefore: with the workspaces paused,
   let short-lived ones finish, **cancel** the rest, and record what was
   cancelled. Crons are safe (redefined by each deploy). T05 has the same
   precondition (see EXECUTION T05).
5. Inbound mail is not frozen — it keeps being stored throughout; only
   automation on top of it is paused.

### 4.1 Steps
1. `npx convex export --prod --path backups/pre-pivot-<date>.zip` (outside git).
   Record the currently deployed commit.
2. Deploy **C**. Smoke test: app loads, old conversations open, freeze still holds.
3. Run the backfill migrations in order, each dry run first.
4. Verify (§3). Any failure → stop; the deployment is on C, which runs on
   fully, partially or un-migrated data, so there is no time pressure.
5. Deploy B (final schema).
6. The legacy platform webhook route stays mounted through B and beyond — see
   EXECUTION T10 "Legacy inboxes". It is removed only when no workspace is in
   `legacy_platform_inbox` state.
7. Smoke test with the owner workspace: sign in, Contacts, Inbox, Settings → Usage.
8. **Unfreeze:** restore each workspace's recorded `automationState`. Migrated
   agents are `review` or `paused`, so nothing sends until a human approves.

## 5. Rollback

Rule: **the rollback target is always compatibility release C.** Never "the
previous commit": pre-C code declares strict object validators and Convex
rejects documents carrying fields it does not declare, and the backfill also
removes fields that pre-C code requires. Pre-C code is reachable only through
a full data restore.

| Where it went wrong | What to do |
|---|---|
| Deploy C itself fails | nothing changed; fix and retry. The old app is still running. |
| During backfill (partially migrated data) | stay on C — it reads both shapes by design. Fix the migration and **resume** (migrations are idempotent and cursor-based). To abandon instead: run the inverse migrations (`m0x_down`, written alongside each `m0x`, restoring removed fields from the `legacy*` copies the forward step keeps until clean-up), verify counts equal the pre-migration census, stay on C. |
| Verify fails | same as above; B is not deployed. |
| After deploy B | redeploy **C** (its optional-everything schema accepts fully migrated data). Then resume forward or run the down migrations. |
| Data itself is wrong / corrupted | freeze (§4.0) → `npx convex import --prod --replace backups/pre-pivot-<date>.zip` → deploy the recorded pre-pivot commit (now valid again, because the data is pre-pivot) → replay provider mail events for the gap (webhook dedupe by event id makes replay safe) → re-apply suppressions added during the gap from `migration-log.md` **before** unfreezing. |

Because forward steps must be reversible until clean-up, a migration that
removes a field first copies it to a `legacy` sub-object on the same document
(declared optional in C, absent from B's schema → stripped by a final
`m08_dropLegacy` that runs only after the rollback window closes).

### Rehearsal (required on dev before production)
1. Seed dev from a production export.
2. Deploy C, run the backfill **and interrupt it half-way** (kill after `m03`
   has processed part of the table).
3. On that partially migrated data: confirm the app works on C; run the down
   migrations; confirm the pre-migration census matches and a suppressed
   address is still refused.
4. Run forward to completion, deploy B, then redeploy C over fully migrated
   data and confirm the app works.
5. Do the full restore once: import the export with `--replace`, deploy the
   pre-pivot commit, confirm it runs.
Record timings and results in `migration-log.md`. Rollback is decided by the
integrator and the owner together; it is never automatic.

## 6. Clean-slate path (test data only)

"Clear everything and re-import suppressions" is wrong: a suppression row is
owned by a `workspaceId`, and an imported row pointing at a deleted workspace
suppresses nothing. Ownership is preserved instead.

1. Freeze exactly as in §4.0 (pause workspaces, verify, drain `reserved` +
   `requesting` + `uncertain`, cancel scheduled calls).
2. Export as in §4.1.1 — still take the backup.
3. **Keep** `workspaces`, `memberships` and `suppressions` — same documents,
   same `_id`s, so every suppression still points at a live workspace that its
   owner can still sign in to. **Clear** every other app table (campaigns,
   prospects, leadEvents, evidence, bookings, conversations, notes, drafts,
   approvals, sendAttempts, receipts, quarantine, usage, providerOperations,
   activityEvents, businessProfiles) and the rows of tables no longer in the
   schema.
4. Bring the kept tables to the final shape with two tiny migrations
   (`workspaces`: add `plan`, `webhookToken`, reset inbox connection to
   not-connected and `onboardingStep` to the start; strip removed fields from
   all three). Trial credit buckets are granted here, as for a new workspace.
5. Deploy the final schema.
6. **Prove suppression works:** for each workspace with suppressions, run a
   send preflight to one suppressed address through the ledger → refused with
   the suppression reason. A matching row count is not proof.
7. Unfreeze. Every owner lands in onboarding with an empty workspace and their
   opt-outs intact.
8. Record the path taken, counts and the step-6 results in
   `plan/migration-log.md`.

Rollback on this path is the full restore row of §5 (import the export with
`--replace`, deploy the recorded pre-pivot commit).
