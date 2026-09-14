# P10 module review — approvals/drafts/suppressions/usage + send receipts

Date: 2026-09-14. Scope: `convex/{approvals,drafts,suppressions,usage,
sendAttempts,decisions,sending}.ts` read against architecture §4.2–4.4/§6/§8
after the review-send fixes merged. Static review only — no deployment,
provider calls or test files. Extends `review-send.md` (same surface, deeper
pass) and complements `review-orch.md` (seams).

## Confirmed defects and fixes

1. **`sendAttempts.listReceipts(providerMessageRef)` read across workspaces —
   MED.** The `by_providerMessageRef` branch never intersected the result
   with `args.workspaceId`: a member of workspace A who knew a provider
   message ref could read workspace B's receipts (event ids, types, inbox
   refs, provider facts). The workspace filter is now applied inside the
   query. — `acacc7d`.

2. **Public `decisions.resolve` consumed artifact-bound asks without their
   owning ceremony — MED.** A client could resolve an open `draft_approval`
   ask directly with `{approved: true}`: no `approvals` row was written and
   `decision.approvalId` stayed unset, so the send boundary's
   `no_current_approval` gate could never be satisfied — the ask was burned
   and that revision could never gain an approval (only `drafts.revise`
   recovered). `delivery_uncertain` asks could similarly be resolved without
   `resolveDeliveryUncertainty`'s validations, burning the §8.7 covering
   decision. The public `resolve` now refuses both kinds with a pointer to
   the owning mutation; the shared write path moved to `applyResolution`,
   exposed to the owners as `internalMutation decisions.resolveBound` with
   an authenticated `resolvedBy`. — `daf1359`.

3. **`supersedeOpenDraftDecisions` missed asks recorded under other
   missions — MED (latent until P11).** The supersede scan filtered the
   *caller's* mission's open decisions by draft. A revision installed under
   a different mission (a P11 reply mission revising an outreach
   conversation) left the old revision's open `draft_approval` ask stranded:
   bound to a superseded draft, unresolvable (`approvals.*` → CONFLICT on
   current-draft mismatch), pinning `requiredDecisionCount` on the
   originating mission and never waking its `awaitEvent`. The scan now
   iterates the conversation's drafts and retires open asks via `by_draftId`
   regardless of owning mission. — `c97055d`.

4. **`usage.settleReservation` deadlocked on multi-bucket operation keys —
   MED (latent until P09).** Reserve dedupe is per `(operationKey, bucketId)`
   — one logical operation may legitimately debit several buckets — but
   settle collected by `(workspaceId, operationKey)` and threw CONFLICT when
   >1 row existed, leaking capacity forever. Settle now applies the target
   transition to every reservation under the key in one transaction; rows
   already in target replay, and any illegal transition rolls the whole
   batch back. — `c43d89b`.

5. **`requestChanges` replayed after `reject` silently succeeded — LOW.**
   Both operations write verdict `rejected`; the dedupe compared only the
   verdict, so reusing a reject requestId for requestChanges returned the
   reject row and the workflow kept `draftResolution: "rejected"`. The
   replay path now also compares the decision's recorded
   `answer.fields.draftResolution` — a cross-operation requestId reuse is a
   CONFLICT. — `25754b2`.

6. **`usage.reserve` rewrote `bucket.limit` on replayed calls — LOW.** The
   cap refresh ran before the dedupe early-return, so a stale caller could
   silently rewrite a shared bucket's limit. The refresh now runs only on
   the new-reservation path. — `25754b2`.

7. **`suppressions.list`/`usage.summary` used ad-hoc limits (200–500) —
   LOW.** Both now use the standard `boundedLimit` (default 25, max 50)
   contract like every other list query. — `25754b2`.

## Verified correct this round

- Usage lifecycle: `reserve` is only reachable when no reservation exists
  for the operationKey in ANY bucket (`getByOperationKey` precedes it), so
  the multi-bucket case needed a caller that does not exist yet — the fix
  (4) lands before P09 creates one. Settle transitions match the legal
  table; `uncertain` retains capacity per §8.7.
- Suppression cannot be bypassed: every send path funnels through
  `evaluateSendGates → matchSuppression`; email suppression never implies
  domain; domain requires a dotted name.
- `stageConversation` patch-path thread-pair uniqueness (review-send fix)
  uses `existing.inboxRef` correctly — inboxRef is not patchable.

## Documented residuals (not patched)

- `matchSuppression` is exact-address: `jane+tag@x.com` evades a `jane@x.com`
  suppression. Exactness is required for approval binding; whether
  suppression should match the tag-stripped mailbox is a spec decision —
  flagged for P11's unsubscribe/bounce intake.
- `normalizeDomain` accepts public suffixes (`co.uk` suppresses all
  `*.co.uk` recipients) — needs PSL/registrable-domain validation if domain
  suppressions see real use; subdomain coverage is exact-match only.
- IDN/punycode TLDs are rejected by `EMAIL_DOMAIN` — a capability gap for
  international leads; note for P09 contact validation.
- Suppression add/remove writes no audit row (`recordActivityEvent` requires
  a missionId) — compliance-relevant removal is unaudited; add an audit
  surface when P11 wires automatic suppressions.
- `vSendRequestBody` accepts html/cc/bcc/headers/attachments the payload
  hash never covers — unreachable today (dispatch sends to/subject/text
  only); restrict the wire validator or extend the fingerprint before any
  future caller uses them.
- `dispatchAttempt` re-parks a `reserved` attempt indefinitely when daily
  capacity is permanently 0 (demo workspaces) — the send is fail-closed but
  the parked attempt blocks sibling sends until `cancelAttempt`.
- `openDraftApprovalDecision` returns silently when no workflow exists —
  reachable only on staged/probe data; `missions.create` always binds a
  workflow. Revisit if P11 stages draft asks pre-workflow.

## Verification

- `npx tsc -p convex/tsconfig.json --noEmit` — clean after each fix.
- `pnpm lint` — 0 errors, 1 pre-existing `use-mobile.ts` warning.
- `pnpm build` — clean (existing large-chunk advisory).

## Commits

- `acacc7d` fix(sendAttempts): scope listReceipts providerMessageRef reads to
  the workspace
- `daf1359` fix(decisions): route artifact-bound asks through their owning
  mutations
- `c97055d` fix(drafts): supersede open approval asks by draft, not by
  mission
- `c43d89b` fix(usage): settle every reservation under an operation key
- `25754b2` fix(convex): tighten replay bindings and list bounds —
  draftResolution dedupe, reserve limit refresh, boundedLimit

---

## Round 2 — frontend/concurrency + tooling pass

Date: 2026-09-14 (same day, second pass). Scope: the five versioned form
components, runtime-status rendering, `usage.summary` ordering, and the
P10 probe script.

### Confirmed defects and fixes

1. **Versioned forms sent the live-prop version, not the edit-base —
   MEDIUM.** `WorkspaceSection`, `SendingPolicySection`, `BusinessStep`
   and `WorkspaceStep` read `workspace.policyVersion`/`profile.version`
   from the live query result at submit time — a concurrent bump while
   dirty passed a version the user never saw, silently overwriting it.
   Each now snapshots `baseVersion` alongside `syncedAt`; `WorkspaceStep`
   uses the post-update version only for its follow-on `setSendingPolicy`
   call after its own bump. — `785e0ae`.

2. **`usage.summary` took-then-filtered — LOW.** `take(limit)` ran before
   the metric filter, so early buckets of other metrics could drop every
   matching row. Now collect → filter → slice (the index cannot eq
   `metric` without `scopeKey`). — `13d82a8`.

3. **Runtime card flashed "Not connected" while loading — LOW.**
   `status === undefined` (query in flight) rendered the not-connected
   label and enabled Connect. Now renders "Checking…" and gates
   `canConnect` on a resolved query. — `13d82a8`.

4. **`p10-probe.sh` masked `convex run` failures — LOW.** `cr()` always
   exited 0 through its sed/grep pipeline — a failed step saved a null id
   and kept going silently. It now propagates the run's exit status and
   prints a failure marker to stderr. — `13d82a8`.

### Commits

- `785e0ae` submit the edit-base version, not the live prop
- `13d82a8` loading flash, summary ordering, dispatch liveness, probe exit
  status
