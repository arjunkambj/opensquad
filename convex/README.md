# Convex backend

Organised by **domain**, not by technical layer: everything about leads is in
`leads/`, everything about sending is in `outreach/`. `plan/PLAN.md` §10 is the
contract this directory keeps.

## Layout

```
convex/
  schema.ts  http.ts  crons.ts  convex.config.ts  auth.config.ts  ← composition only
  lib/            cross-domain helpers only
    auth.ts       identity, the active-organization guard, the verified-email gate
    errors.ts     the one typed error-code union the client maps to copy
    limits.ts     every price, cap, budget and recovery window
    rateLimits.ts per-user token buckets on credit-spending entry points
    validators/   shared.ts + one file per domain, re-exported from index.ts
  integrations/   the ONLY place that talks HTTP to a provider
    agentmail.ts  firecrawl.ts
  orgs/           the org record, its policy, secrets, the trial grant
  billing/        credits, the usage ledger, platform budgets, `withCredits`
  company/        the business profile we are selling FOR
  agents/         the one sales agent an organization runs
  leads/          the person-level lead, its events and research evidence
  outreach/       drafts, approvals, suppressions and the send boundary
  inbox/          inbound ingest, conversations, quarantine
  bookings/       the meeting lifecycle
  activity/       the deduped organization receipt feed
```

`convex/_generated/` is produced by `npx convex codegen` (integrator only) and
is committed so task branches typecheck without a deployment.

## Conventions

- Inside a domain: `queries.ts` / `mutations.ts` / `actions.ts` hold the Convex
  functions — thin: validate args, authorise, call the model, return.
  `model.ts` holds the plain typed `ctx` functions with the actual logic. A
  file past ~300 lines splits by sub-topic (`leads/evidence.ts`,
  `outreach/sendReserve.ts`).
- Domain validators live in `lib/validators/<domain>.ts`; table field objects
  stay exported from `schema.ts`. `lib/validators/index.ts` is the one barrel
  in the codebase, so every module keeps importing from `./lib/validators`.
- Dependency direction is `domain → lib | integrations`. `integrations/` never
  imports a domain's public function file.
- Every function reference in the generated `api` / `internal` object follows
  the file path: `api.leads.queries.list`,
  `internal.outreach.sendReserve.reserveSendIntent`,
  `internal.billing.reservations.reserve`.
- Errors go through `domainError(code, message)` from `lib/errors.ts` (also
  re-exported by `lib/validators`); provider error text never leaves
  `integrations/`.
- Anything the browser does not call is an `internalQuery` / `internalMutation`
  / `internalAction`.

## Money

Nothing spends money outside `billing/`. One door, `withCredits`, reserves the
action's credit price and its worst-case provider units — in the
organization's buckets AND the platform budget — inside one transaction, runs the work, then
settles in one transaction. It ends in exactly one of `billed`, `refunded` or
`uncertain`, and is idempotent by `operationKey`, so a retry of a settled
operation replays its recorded outcome instead of buying the work again.

| file | what it owns |
|---|---|
| `paidCall.ts` | the vocabulary: actions, provider units, outcomes, operation keys |
| `withCredits.ts` | the wrapper the callers use |
| `reserve.ts` | its reserve half: check every layer, then take it all at once |
| `settlement.ts` | its settle half, and the reconciliation door provider tasks call |
| `model.ts` | the ledger's buckets, and how a debit is taken |
| `transitions.ts` | how a debit is settled: the reservation state machine |
| `reservations.ts` | the same ledger as internal mutations, for action callers |
| `platformBudgets.ts` | the kill switch, platform budgets, signup capacity |
| `trialBuckets.ts` | the grant a first organization is created with |
| `sweeps.ts` | the belts: park a lost call, commit a hold nothing reconciled |
| `credits.ts`, `queries.ts` | the balance, the Usage tab, the waitlist state |

An `uncertain` hold is only ever RELEASED with proof — that is
`settlement.reconcilePaidCall`, called by a provider task that looked the
operation up. The sweep may only commit it.

## The send boundary

`outreach/` splits the send lifecycle across one file per step, in the order
architecture §8 runs them:

| file | step |
|---|---|
| `sendGates.ts` | the shared gate checklist, re-run at every step |
| `sendModel.ts` | loaders, limits, reservation and attempt inserts |
| `sendReserve.ts` | §8 step 3 — durable intent + every static gate, atomically |
| `sendDispatch.ts` | §8 step 4 — the commit point |
| `sendActions.ts` | §8 steps 4–7 — one provider request, never retried |
| `sendOutcome.ts` | §8 steps 7/9 — the attempt settles |
| `sendReconcile.ts` | §8.7 — replaying an `uncertain` attempt |
| `sendSweeps.ts` | the belts that re-drive a lost recovery path |
| `sendControls.ts` | the public triggers |
| `sendPreflight.ts` | the honest "why is this blocked" preview |
| `sendAttempts.ts`, `sendReceipts.ts` | the attempt read surface and the provider-event ledger |

## Running it

Task agents never talk to a deployment. The integrator runs `npx convex
codegen` and `npx convex dev` against the dev deployment; anything against
production happens only after the owner says go.
