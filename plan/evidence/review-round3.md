# Review round 3 — P01–P10 readiness audit for P11/P12

Date: 2026-09-14. Scope: six parallel read-only audits across the merged
P01–P10 surface — frontend (P08), domain layer (P02), send boundary (P05/P10),
mission/decision lifecycle (P06), worker runtime + daemon (P03/P07), and a
cross-cutting seam pass — plus a follow-up fix pass on this branch. Static
review plus lint/build/tsc; no deployment or provider calls.

## Confirmed defects and fixes

### Send boundary / inbox seams

1. **`delivery_uncertain` ask was opened outside the outcome transaction —
   HIGH.** `sendApprovedDraft`/`reconcile` recorded `uncertain` and then
   opened the human ask in a second step; a crash between them left an
   uncertain attempt with no decision to resolve it. `recordSendOutcome`
   now opens the ask inside the same mutation (idempotent on
   `delivery_uncertain:${attemptId}`); the redundant post-commit calls are
   removed. — `convex/sending.ts`.

2. **`coveredByAttemptId` back-links stranded covered attempts — MED.** When
   a §8.7 covering (replacement) attempt was cancelled or definitively
   failed, the covered attempt's link stayed set, bypassing the
   contactability guard while nothing was actually sent. A
   `clearCoverageOnDeadAttempt` helper now unlinks covered rows on all three
   cancel paths and on `definitively_failed`, and `insertReservedAttempt`
   allows relinking over a dead covering attempt. — `convex/sendAttempts.ts`.

3. **`prepareReconcile` mislabeled in-flight sends as `resolved` — MED.** A
   `dispatched`/`sending` attempt inside the reconcile window reported
   `resolved`, letting the caller treat a still-uncertain provider state as
   final. `vPrepareResult`/`vDispatchOutcome` gained an `in_flight` branch
   mapped in the action. — `convex/sending.ts`.

4. **`recordReceipt` `.unique()` could throw on a cross-workspace
   `providerMessageRef` collision — LOW.** Now `.collect()` + workspace
   match — robust even if a provider reuses a ref. — `convex/sendAttempts.ts`.

5. **`applyInboundContext` was not idempotent per message — MED (P11 path).**
   Re-applying the same inbound message ref re-mutated conversation state.
   It now early-returns when the seam `messageRef` was already applied. —
   `convex/drafts.ts`.

6. **`listForConversation.state` was a raw `v.string()` cast to the state
   union — LOW.** Now validates against `vSendAttemptState`; the unsafe cast
   is gone (narrowing hoisted for the index closure). —
   `convex/sendAttempts.ts`.

7. **`usage.getByOperationKey` returned whichever bucket row sorted first —
   LOW.** A multi-bucket operation could hide a still-`reserved`/`uncertain`
   row behind a settled sibling. It now prefers a live row and scans all
   matching rows. — `convex/usage.ts`.

### Missions / decisions

8. **Lifecycle mutations threw `CONFLICT` on retry instead of returning the
   already-applied doc — MED.** `pause`/`resume`/`cancel`/`archive`/
   `restore` asserted `expectedVersion` before the no-op check, so a
   retry with the original version failed. Idempotent state checks now run
   before the version assert. — `convex/missions.ts`.

9. **`completeMissionTx` left open decisions dangling — MED.** The
   completion path skipped `retireAllOpenDecisions` while cancel/fail had
   it — a completed mission could keep open asks in the operator queue.
   Retire now runs before the terminal transition; the retire path was
   widened to `MutationCtx | WriteCtx` (a workflow step can't `sendEvent`,
   and the completing workflow has no parked awaits left). —
   `convex/workflows/steps.ts`, `convex/decisions.ts`.

10. **`closeAskOnMission` bypassed the transition machinery — MED.** It
    patched mission state directly. It now calls `assertMissionTransition`
    and records a state-change activity event when the last required ask
    resumes the mission. — `convex/decisions.ts`.

11. **`failMission` did not cancel a live owning workflow — LOW.** It now
    mirrors `cancelMissionWork`'s workflow cancellation. —
    `convex/missions.ts`.

12. **`dispatchWorkerRequest` lacked the workflow-ownership guards that
    `openRequiredDecision` has — MED.** Terminal-state, workflow-ownership
    and generation checks now mirror the decision path. —
    `convex/workerOperations.ts`.

### Runtime lifecycle (worker bridge side)

13. **`runResume` could leave a live Box after a mid-flight disconnect —
    HIGH.** The post-resume recheck skipped the emergency stop whenever
    `latest.boxRef === connection.boxRef` — but `disconnect` never clears
    `boxRef`, so a same-generation dying connection always took the
    leave-it-alone branch and the just-resumed box ran to its 7-day TTL
    with revoked env inside. The stop is now skipped only when a NEWER
    generation still references the box. — `convex/runtimeConnections.ts`.

14. **A failed teardown wedged the connection in `stopping` forever —
    MED.** `recordLifecycleOutcome` only mapped `failed` → `error` while
    `provisioning`; a failed `stop`/`delete` left `stopping` with no owner
    path (disconnect no-ops on it). `stopping` now also lands on `error`,
    which `disconnect` can re-drive. — `convex/runtimeConnections.ts`.

15. **No recovery for a lost lifecycle schedule or dead driver — MED.**
    `pending`/`accepted`/`uncertain` ops could wedge a connection
    mid-transition forever. New `sweepLifecycleOperations` (cron, 5 min)
    re-drives `uncertain`, stale `accepted` (past the action timeout) and
    stale `pending` (past 60 s) rows on a new `by_state_and_updatedAt`
    index; `markLifecycleAccepted` now returns an exclusive claim so a
    late-firing duplicate schedule can't double-drive an op. —
    `convex/runtimeConnections.ts`, `convex/schema.ts`, `convex/crons.ts`.

16. **`connect`-revive orphaned boxes known only on terminal create ops —
    MED.** The orphan scan only looked at `connection.boxRef`; an
    `uncertain`/`failed` create records the box on the op ledger row, not
    the connection. The revive path now also scans prior create/resume ops
    for recorded box refs lacking a live/completed teardown. —
    `convex/runtimeConnections.ts`.

### Control channel / daemon

17. **`enqueueControlCommand` deduped by command kind only — MED.** An
    `interrupt_turn` for turn B deduplicated onto turn A's live request —
    B kept running while the owner saw "enqueued". The same-kind match now
    also compares `turnId`/`threadId`/`loginId` payload refs. —
    `convex/runtimeControlRequests.ts`.

18. **`listOutstanding` was member-guarded while documented as owner
    diagnostics — LOW.** A viewer could observe the live control queue.
    Now `requireWorkspaceOwner`. — `convex/runtimeControlRequests.ts`.

19. **A claimed control row could expire mid-execution under a pending
    stream — LOW.** The +30 s floor was written only to the returned row;
    a queued stream could expire a running `start_login` and drop its
    terminal post as a 409. Still-claimed rows now get the same floor bump.
    — `convex/workerBridge.ts`.

20. **Daemon claimed work while unauthenticated — MED.** `#workTick` gated
    on `phase === "boot"` only, so a fresh box, post-logout state, `apiKey`
    account or a failed boot read still claimed work and failed it. Claims
    now require `#accountReady`; a 60 s recheck re-reads account state
    while unauthenticated so transient boot failures aren't sticky, and
    `inspect_account` mirrors its read onto the flag. — `worker/src/daemon.ts`.

21. **A contract-invalid result reported as `interrupted` after lease
    expiry — LOW.** A 400/INVALID from the result post returned silently;
    the row expired to `uncertain` → interrupt → `interrupted`, hiding the
    real cause. The daemon now posts `output_contract_violation` on a 400
    while the lease is live. — `worker/src/daemon.ts`.

22. **Unhandled-rejection paths on app-server child death — LOW.** A
    `#write(reply)` throwing `AppServerClosedError` inside the `void`'d
    server-request handler surfaced as `unhandledRejection`, and `stdin`
    had no `error` listener. Both are now handled. —
    `worker/src/codex/appserver.ts`.

23. **`Restart=on-failure` restarted a permanently broken image every 5 s
    forever — LOW.** `StartLimitIntervalSec=300`/`StartLimitBurst=5` leave
    the unit failed after 5 rapid failures. —
    `worker/deploy/opensquad-worker.service`.

### Frontend

24. **`EmployeeCard` submitted the live-prop `instructionVersion` — MED.**
    The optimistic-concurrency check could never fire for a dirty editor;
    it now snapshots `baseVersion` (the `BusinessStep` pattern). —
    `src/components/employees/EmployeeCard.tsx`.

25. **Employees list flashed "Disconnected" while the runtime query loaded
    — LOW.** The loading gate now covers both queries. —
    `src/components/employees/EmployeesView.tsx`.

26. **No router-level error or not-found boundary — MED.** A thrown query
    unmounted the app to a blank screen. `__root` now renders an
    `ErrorState` with retry and an `EmptyState` not-found page. —
    `src/routes/__root.tsx`.

### Hygiene / hardening

27. **`parseWorkerResult` accepted credential-shaped strings — HIGH belt.**
    `OPENSQUAD_WORKER_TOKEN` is readable inside the Box by the sandboxed
    model (same uid as the daemon), so a hostile prompt could instruct the
    model to echo it into a result field. Results are now rejected when any
    string field matches `osw_…`/`osl_…`; with the daemon's 400→failure
    path this lands as `output_contract_violation`. The uid separation
    itself is an image change — tracked as a P11 precondition. —
    `convex/lib/validators.ts`.

28. **`devDumpBridge` emitted live device codes despite claiming "no
    tokens" — LOW.** `verificationUrl`/`userCode` are bearer material; the
    dump now projects `_id`/`expiresAt` only. `devSeedWorkerRequest` also
    fails clearly when the mission has no `workflowId` instead of passing
    `""` to the component. — `convex/workerOperations.ts`.

29. **`sanitizeSafeResult` stripped challenge keys only at top level —
    LOW.** `verificationUrl`/`userCode` are now stripped recursively at any
    depth. — `convex/workerBridge.ts`.

30. **`sniffMimeType` 400'd `text/*` artifacts starting with `{`/`[` —
    LOW.** JSON-looking bytes are valid text; the sniff mismatch now allows
    a `text/*` declaration over a `application/json` sniff. —
    `convex/http.ts`.

31. **`setSendingPolicy` bumped `policyVersion` on no-op updates — LOW.**
    A same-values save invalidated every pending approved draft. It now
    compares normalized values and returns without writing on no-ops;
    `assertIanaTimezone` returns the canonical IANA name so case variants
    compare equal. — `convex/workspaces.ts`, `convex/lib/validators.ts`.

32. **Evidence version drift — LOW.** P06/P10 evidence recorded
    `@convex-dev/workflow 0.4.7`; the lockfile pins `0.4.6`. Corrected.

## Open items handed to later tasks

- **P11 precondition:** run the app-server child under a uid distinct from
  the daemon (image change) so `worker.env`/`/proc` environ are
  uid-separated; the result-side credential scan is only a compensating
  control.
- **P11:** verified events for unassigned inboxes are dropped without a
  receipt row — write a quarantined receipt or reconcile component tables.
- **P11:** enforce `employees.enabled` in employee-selection/reply paths.
- **P14:** non-benign `sendEvent` failures inside apply/sweep mutations —
  probe the component's failure modes before swallow-with-record.
- **Plan:** `convex/prospects.ts` is claimed by both P09 and P19 — the
  integrator must sequence which task creates the file.
- Residual lows: sweep `.take()` bounds converge via cron; `lastPollAt`
  shared across claim routes; artifact store→link crash window orphans a
  blob (≤5 MiB); `runloop.ts` is dead code; runtime heartbeat staleness on
  the client.

## Verdict

**P11 and P12 READY** after this fix pass. Verified: `pnpm lint` (1 known
shadcn warning), `pnpm build`, root + worker `tsc`, `pnpm plan check` all
clean.
