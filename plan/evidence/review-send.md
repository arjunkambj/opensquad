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
