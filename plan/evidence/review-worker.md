# Worker review cleanup

Date: 2026-09-14. Review branch: `review/worker-cleanup`.
Scope: handwritten worker code in the unpushed P03/P04 implementation, read
against the task cards, integration contracts and recorded live evidence.
The P04 Apollo OAuth gate remains deliberately deferred. No provider probe,
model turn, deployment, push, email or production action ran during this review.
No repository test files were added.

## Findings repaired

- Service startup treated the owner's persisted Codex login as an inherited
  credential leak. Runtime checks now permit that cache; birth checks retain
  their strict default. The work directory is created before child spawn,
  malformed generation values are rejected, and systemd does not restart-loop
  on configuration exit 78.
- Bootstrap repeated its non-idempotent command when the operation key already
  existed. Repeats now poll the saved process; an unknown dispatch requires
  reconciliation. Request fingerprints now use SHA-256 rather than persisting
  plaintext provisioning env/scripts; matching legacy diagnostic receipts are
  upgraded while retaining their recovery references.
- A fast terminal notification could precede waiter subscription after a start
  or interrupt response. A bounded in-memory terminal buffer now replays to
  waiters. Login completion requires the exact pending login ID; null/unrelated
  IDs cannot complete it. Already-aborted waits stop immediately.
- The bounded run loop ignored a supplied saved thread and accepted API-key
  account state. It now resumes the supplied thread and requires managed
  ChatGPT account state. Unconfirmed termination reports error and retains the
  active run/turn references for supervision.
- A repeated create could create a second Box after the provider's 24-hour
  idempotency retention expired. Saved Box receipts now reconcile by inspection;
  an expired request without a Box receipt is refused for manual reconciliation.
- Runtime notes now distinguish P03's accepted live disposable-Box evidence
  from remaining P07 image/bridge work and show a build with dev dependencies
  before installing runtime-only dependencies.

## Local acceptance evidence

- `pnpm --dir worker install --frozen-lockfile` — passed; lockfile unchanged.
- `pnpm --dir worker typecheck` and `pnpm --dir worker build` — passed after
  the final worker source edits.
- `pnpm lint` — passed with the existing `src/hooks/use-mobile.ts`
  set-state-in-effect warning only.
- `git diff --check` — passed.
- Inline local manual probes using placeholder values and temporary files:
  birth check rejected a dummy cache; runtime check accepted it while rejecting
  a foreign credential env name; malformed/unsafe generations were rejected.
- Local adapter doubles showed one bootstrap dispatch across two calls, repeat
  polling of the original process, rejection of changed arguments, no replay
  after an ambiguous dispatch, and deterministic hashed fingerprints.
- A local disposable stdio child emitted completion in the response chunk;
  both turn/login waiters recovered it. Unrelated/null login IDs were ignored
  and a pre-aborted wait rejected immediately. No Codex binary/auth was used.
- A local runloop double observed `thread/resume` for the saved thread, no
  `thread/start`, cleared references after completion and rejection of API-key
  account state.
- Local create receipts older than 24 hours were inspected by Box ID without
  another create; an expired unknown create was blocked without dispatch.

## Scope limits

These are local code/protocol checks, not new live G1/G2 acceptance. P07 still
owns an atomic durable operation store, scoped thread ownership validation,
lease/generation enforcement, tool gateway and real image/service integration.
The 64-entry terminal buffer is process-local; durable restart reconciliation
belongs to the bridge. Apollo remains intentionally untested, as requested.
No canonical task statuses or hackathon log were edited by this task agent.
