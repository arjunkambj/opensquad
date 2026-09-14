# Send-path review — approvals/drafts dedupe and conversation mapping

Date: 2026-09-14. Review branch: `opensquad/review-send`, worktree
`opensquad-worktrees/review-send`. Base: `8200731` (P07+P10 integrated).
Scope: `convex/approvals.ts` and `convex/drafts.ts` read against
architecture §4.3/§6 — the exact-approval dedupe contract and the
conversation staging seam. No provider calls, deployment or test files.
Integrated at `main` after the bridge/orchestration review merges; both
files were untouched by those rounds so the merge was clean.

## Confirmed defects and fixes

1. **Approval requestId replay was not bound to the decision — HIGH.**
   `resolveDraftDecision` returned the recorded approval for a reused
   `requestId` without checking it belonged to the decision being resolved.
   Reusing the key against a different ask (e.g. the fresh `draft_approval`
   decision opened when a superseded draft got a new revision) silently
   returned a verdict recorded for unrelated content while the new ask
   stayed open — the send path then had no verdict bound to the new
   revision. The replay now requires `decision.approvalId` to match the
   recorded approval; a cross-decision reuse is a `CONFLICT`. The decision
   lookup was also moved ahead of the replay check so the binding can be
   verified. — `fa635b8`.

2. **Draft requestId replay was not bound to the revision target — HIGH.**
   `drafts.revise` and the internal `createRevision` returned any revision
   row carrying the `requestId`, regardless of which draft/conversation it
   recorded. The same key reused against a different draft produced a
   silent replay of an unrelated revision instead of a conflict. Replays
   now require the recorded `conversationId` (and for `revise`, that the
   recorded revision is exactly `current.revision + 1`). — `0f8443d`.

3. **`listForDraft` accepted an unbounded `limit` — LOW.** Every other
   list query routes through `boundedLimit`; this one took the raw
   argument. Now consistent. — `751c642`.

4. **`stageConversation` patch path could duplicate a provider thread —
   MEDIUM.** The create path enforces the unique
   `(inboxRef, providerThreadRef)` mapping transactionally, but the patch
   path assigned `providerThreadRef` unconditionally. Two conversations
   could claim the same provider thread, after which every create-path
   `.unique()` on that pair throws forever — poisoning inbound thread
   resolution for P11. The patch path now checks the index and conflicts
   on a different conversation holding the pair. — `3f5200f`.

## Verification

- `npx tsc -p convex/tsconfig.json --noEmit` — clean on the merged tree.
- `pnpm lint` / `pnpm build` — run on the combined head after integration.

## Scope limits

Static review only. The send boundary itself (`sending.ts`, reservations,
uncertainty reconcile) was verified live in `plan/evidence/P10.md`
(controlled AgentMail inboxes) and seam-reviewed in `review-orch.md`; this
round covered the dedupe/unique-mapping contracts those depend on.

---

## Round 2 — adversarial dispatch-boundary review

Date: 2026-09-14 (same day, second pass). Scope: `convex/sending.ts`,
`convex/sendAttempts.ts`, `convex/drafts.ts`, `convex/workflows/send.ts`,
`convex/usage.ts`, `convex/crons.ts` — the crash-window and uncertainty
contracts the first pass did not cover.

### Confirmed defects and fixes

1. **Post-request action failure recorded `definitively_failed` — HIGH.**
   `sendApprovedDraft`'s `ctx.runAction` catch mapped a thrown invocation
   error to `{ outcome: "rejected" }` → `recordSendOutcome` wrote
   `definitively_failed`, released the usage reservation and permitted a
   duplicate send — even though AgentMail may already have accepted the
   request. Thrown dispatch errors now map to `outcome: "uncertain"` /
   `reason: "dispatch_error"`, matching the reconcile path's conservative
   treatment (§8.7). — `9062d17`.

2. **Non-transactional wake scheduling — MEDIUM.** Sweeps, dispatch wakes
   and reconcile schedules were issued from actions AFTER the committing
   mutation; a crash between commit and schedule parked attempts forever.
   All wakes are now scheduled inside the committing mutation, and
   `sendAttempts` gained `nextPermittedAt` + `by_state_and_updatedAt` /
   `by_state_and_nextPermittedAt` indexes + a 5-minute global belt cron
   (`sweepStaleAttemptsGlobal`) that re-drives stale `requesting` rows and
   overdue `reserved` rows. — `9062d17`.

3. **Dispatch-ready reserves were invisible to the belt — MEDIUM.** The
   `ready` path inserted `reserved` without `nextPermittedAt`; a caller
   dying between the reserve commit and `beginDispatch` left an unindexed
   row no sweep could find. The row now stamps `nextPermittedAt: now`. —
   `ea2d2ae`.

4. **Transitive uncertainty had no durable link — MEDIUM.** A replacement
   send created a new uncertain attempt while the original stayed
   unlinked, requiring a fresh covering decision per prior uncertain row.
   `sendAttempts.coveredByAttemptId` now records the coverage chain — one
   human decision covers the chain's tail. — `9062d17`.

5. **Parked `reserved` attempts survived invalidation — MEDIUM.** A
   window-/capacity-parked attempt authorized against a superseded
   revision or pre-inbound context blocked corrected sends with
   `unresolved_attempt`. `cancelParkedConversationAttempts` now cancels
   `reserved` rows (never `requesting`/`uncertain` — provider effect may
   have occurred) inside `installRevision` and `applyInboundContext`. —
   `9062d17`, `fffbb7c`.

6. **`requesting` reported as `already_resolved` — LOW.** A live provider
   request could be returned through the resolved shape, letting a
   journaled caller record "resolved" for in-flight mail. Added the
   `in_flight` outcome to `vDispatchOutcome` and `vSendWorkflowResult`. —
   `9062d17`.

7. **Replay misreported replacement dispatch — LOW.** A replayed
   `resolveDeliveryUncertainty` always returned `dispatched: false`; it
   now queries `by_replacementDecisionId` and reports truthfully. —
   `9062d17`.

8. **`recordReceipt` self-poisoned on a third delivery — LOW.** `.unique()`
   on the application-key index threw once two `handled` rows existed,
   wedging the receipt path for that logical event permanently; the dedupe
   only needs existence — `.first()`. — `9c9c0f0`.

9. **`usage.commit` bound < send bound — LOW.** `providerReference` was
   bounded at 300 while message ids run to 400 — a long provider id threw
   inside `recordSendOutcome` and wedged the attempt `uncertain`. Now 400.
   — `b77994e`.

10. **Any-throw retry on `reserveSendIntent` — LOW.** `sendApprovedDraft`
    retried every thrown error, relabeling deterministic failures as
    transient conflicts; retries are now gated on `thrownCode ===
    "CONFLICT"`. — `9062d17`.

11. **Cross-mission ask strand + foreign-workflow regression — MEDIUM.**
    The round-1 by-draft supersession could pass a retired decision's
    `targetWorkflowId` belonging to another mission into
    `openRequiredDecision`, rolling back the entire revision install; and
    `openDecision:false` installs stranded the prior ask. Supersession is
    now unconditional, and the fresh ask's workflow prefers the explicit
    waiter → a retired ask from the same mission → the mission workflow. —
    `fffbb7c`.

### Residuals (documented, not fixed)

- `payloadHash` covers the payload fields that exist today (to/subject/
  text). Any future field (inReplyTo, attachments, contentType) must be
  added to the hash or exact-approval is bypassable — noted for P11+.
- `openDraftApprovalDecision` silently no-ops when no workflow exists —
  verified graceful; a draft can exist without an approval path on
  workflow-less staged data. Revisit if P11 opens asks pre-workflow.
- The send workflow (`workflows/send.ts`) remains dormant scaffolding —
  `sendApprovedDraft` is the live path (P10 verified); workflow wiring is
  a later task.

### Verification

- `npx tsc -p convex/tsconfig.json --noEmit` — clean.
- `pnpm lint` — 0 errors (1 pre-existing `use-mobile.ts` warning).
- `pnpm build` — clean. `pnpm plan check` — valid.

### Commits

- `9062d17` harden dispatch boundary — uncertain on unknown outcome,
  transactional wakes, transitive coverage, in_flight outcome,
  CONFLICT-only retry, honest replay reporting
- `fffbb7c` retire parked send intents and strand-proof supersession on
  revision
- `9c9c0f0` honest receipt dedupe under re-delivery; chronological listing
- `b77994e` align providerReference bound with the 400-char messageId bound
- `ea2d2ae` stamp nextPermittedAt on dispatch-ready reserves
