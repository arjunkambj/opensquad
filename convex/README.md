# Convex backend

Organised by **domain**, not by technical layer: everything about leads is in
`leads/`, everything about sending is in `outreach/`. `plan/PLAN.md` §10 is the
contract this directory keeps.

## Layout

```
convex/
  schema.ts  http.ts  crons.ts  convex.config.ts  auth.config.ts  ← composition only
  lib/            cross-domain helpers only
    auth.ts
    validators/   shared.ts + one file per domain, re-exported from index.ts
  integrations/   the ONLY place that talks HTTP to a provider
    agentmail.ts  firecrawl.ts
  workspaces/     workspace records, memberships, workspace policy
  billing/        the usage ledger: reservations, commits, releases
  company/        the business profile we are selling FOR
  agents/         the one sales agent a workspace runs
  leads/          the person-level lead, its events and research evidence
  outreach/       drafts, approvals, suppressions and the send boundary
  inbox/          inbound ingest, conversations, quarantine
  bookings/       the meeting lifecycle
  activity/       the deduped workspace receipt feed
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
- Errors go through `domainError(code, message)` in `lib/validators/shared.ts`;
  provider error text never leaves `integrations/`.
- Anything the browser does not call is an `internalQuery` / `internalMutation`
  / `internalAction`.

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
