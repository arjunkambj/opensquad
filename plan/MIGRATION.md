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

## Decision (2026-09-20): clean-slate path

The owner confirmed there are no real users and no data worth keeping, on dev
or production. **Use §6.** Sections §1–§5 stay as the reference for the day
real data exists; they are not executed now. Still take the export in §6.2
and still carry `suppressions` across — it costs nothing and an opt-out is the
one thing that must never be lost.

## 0. Decide the path (user decision, before T01)

Run on production, read-only:
`npx convex data <table> --prod --limit 5` for `workspaces`, `prospects`,
`conversations`, `suppressions`, and the row counts from the dashboard.

- **Only seed/test data** → *Clean-slate path* (§6): export, clear, deploy.
  Fifteen minutes, nothing to map.
- **Any real workspace, conversation or suppression** → *Full path* (§1–§5).
- Suppressions are the one table that is preserved on **both** paths: losing
  an opt-out is the only irreversible harm here.

## 1. Mapping

| Old | New | Rule |
|---|---|---|
| `campaigns` row | `agents` row | 1:1, same workspace. `name` = campaign title. `mode`: campaign `active` → `review`, anything else → `paused`; **never `autopilot`** — Autopilot requires fresh consent (PLAN §9.3). `instructions` = brief + instruction text. `icp`, `goal`, `tone` from the workspace's `businessProfiles` where present, else empty with `onboardingStep: "icp"` so the user is walked through it. `legacyCampaignId` kept for traceability. |
| `campaigns.sourcePlan` | — | dropped (provider-specific, no equivalent). |
| `prospects` row **with** `contact` | `prospects` row (person) | same `_id` — nothing that references it changes. Person fields from `contact`; `companyName` / `canonicalDomain` stay as the person's company. `agentId` = mapped agent. `sourceLeadId` absent, `source: "manual"`. `emailStatus`: contact email present → `found`, else `locked`. `approval`: `approved` if the prospect was ever contacted, else `pending`. `aiScore` absent (shown as "not scored"; scored on the next research pass only if the user asks). |
| `prospects` row **without** `contact` | `prospects` row, archived | kept, `stage: "rejected"`, `stageReason: "legacy_company_only"`, hidden from the default Contacts view, visible under an "Archived" filter. Not deleted: `leadEvents`, `evidence`, `conversations` may point at it. |
| `prospects.salesStage` | `prospects.stage` | `new`/`qualified` → `researched`; `contacted` → `contacted`; `replied` → `replied`; `interested` → `interested`; `meeting_*` → `meeting_proposed` (never auto-`meeting_booked`, see PLAN §9.5); `lost`/`disqualified` → `closed_lost` / `rejected`. Exact source union is read from the old validators in T01; any unmapped value fails the dry run rather than defaulting. |
| `conversations`, `conversationNotes`, `emailEventReceipts`, `quarantinedEmailEvents` | unchanged | strip removed id fields only. Add `source: "live"` to existing message-bearing rows so none is mistaken for backfill. |
| `drafts`, `approvals`, `sendAttempts` | unchanged | strip removed id fields. Pending drafts from the old system are marked `superseded` — they were written by a runtime that no longer exists and must not be sent by the new loop. Approved-and-sent history is untouched. |
| `suppressions` | unchanged | verified row-for-row (count + checksum of normalised addresses) before and after. |
| `usageBuckets`, `usageReservations` | kept | old metrics (`sends`, research) keep their rows as history. Open `reserved`/`uncertain` reservations for removed metrics are released. New lifetime buckets (`credits`, provider caps) are **granted at the trial size minus nothing** — history is not charged against the new allowance. |
| `providerOperations`, `activityEvents`, `leadEvents`, `evidence`, `bookings` | kept | strip removed id fields; unknown legacy `activityEvents.kind` values are kept under a `legacy` kind so the feed never throws. |
| `workspaces` | extended | `plan: "trial"`, `webhookToken` generated. Existing platform-key inbox: `inboxRef` kept, connection status `legacy_platform_inbox` — receives mail as before until the user connects their own key (§4). |

## 2. Technique: widen → backfill → narrow

Uses `@convex-dev/migrations` (resumable, batched, idempotent, dry-run).

1. **Widen (deploy A).** Schema accepts both shapes: every new required field
   is `v.optional`, every removed field is still declared `v.optional`, new
   tables added, `campaigns` still present. Code reads new-or-old. Deploys
   cleanly on existing data.
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
- zero agents in `autopilot`.
Spot checks in the UI: open three old conversations end to end; confirm a
suppressed address is refused by the send ledger; confirm Usage shows history.

## 4. Cutover

1. Announce nothing is needed from users; pick a quiet moment.
2. **Freeze:** set `PLATFORM_PAUSED=true` (stops sourcing, AI, sends) and
   confirm no `sendAttempts` are in flight (`reserved`/`uncertain` = 0, or
   reconcile them first).
3. `npx convex export --prod --path backups/pre-pivot-<date>.zip` (kept out of
   git). Note the production commit currently deployed.
4. Deploy A → run backfill → verify → deploy B.
5. Inbound mail keeps flowing the whole time: the legacy platform webhook route
   stays mounted through deploy B and is removed only when no workspace is in
   `legacy_platform_inbox` state.
6. Smoke test on production with the owner workspace: sign in, Contacts,
   Inbox, Settings → Usage.
7. **Unfreeze:** `PLATFORM_PAUSED=false`. All agents are `review` or `paused`,
   so nothing sends until a human approves.

## 5. Rollback

- **Before deploy B:** redeploy the previous commit. Widened data is a
  superset of the old shape; the old code ignores the extra optional fields.
  No data restore needed.
- **After deploy B:** redeploy deploy A's commit (still reads both shapes). Only
  if data itself is wrong: `npx convex import --prod --replace backups/pre-pivot-<date>.zip`,
  then redeploy the pre-pivot commit. Mail received between export and restore
  is re-delivered by replaying the provider's events for that window (webhook
  dedupe by event id makes replay safe). Suppressions added in that window are
  re-applied from the migration log **before** unfreezing.
- Rollback is decided by the integrator + user together; it is never automatic.

## 6. Clean-slate path (test data only)

1. `PLATFORM_PAUSED=true`.
2. Export as in §4.3 (still take the backup).
3. Export `suppressions` separately; clear all app tables from the dashboard.
4. Deploy the final schema directly (no widen step needed on empty tables).
5. Re-import `suppressions`. Unfreeze.
6. Record in `plan/migration-log.md` that the clean-slate path was used and why.
