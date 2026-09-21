# Codebase cleanup review — 2026-09-21

Reviewed the pending cleanup against its live frontend consumers, scheduled
functions, provider callbacks, and schema. Three parallel reviewers covered
frontend, AI/leads/billing, and inbox/outreach/bookings. The demo reset feature
was reviewed separately after its purpose was confirmed.

## Cleanup reviewed and completed

| Category | Locations | Result |
| --- | --- | --- |
| Legacy database shapes | `convex/schema.ts`, `convex/lib/validators/leads.ts`, `convex/leads/{model,rows,mutations}.ts` | Removed legacy campaigns, migration-only lead fields and origins, and their fallback branches. Lead origin now describes the provider search that actually creates leads. |
| Legacy inbox integration | `convex/http.ts`, `convex/convex.config.ts`, `convex/lib/validators/orgs.ts`, inbox/send gates, `.env.example` | Removed the platform-inbox state, global webhook credential, old webhook endpoint, and legacy UI copy. Per-organization signed webhooks remain. |
| Obsolete probe | `scripts/p11-sign-inbound.mjs` (deleted) | Removed the forgotten script that still posted to the retired global webhook endpoint. |
| Unused backend APIs | `convex/agents/mutations.ts`, `convex/ai/health.ts`, `convex/bookings/outcomes.ts` (deleted); leads, conversations, approvals, drafts, suppressions, send controls | Verified removed endpoints have no remaining application callers. Preserved the active proposal/confirmation, draft approval, sending, and lead-detail paths. |
| Unsupported booking scaffolding | `convex/lib/validators/bookings.ts`, `convex/bookings/{model,confirmations,queries}.ts` | Removed unwritten terminal states and the future provider-confirmation stub. Kept required timestamps, timezone, duration limits, and upcoming-meeting validation. Removed abandoned event-detail fields and stale UI instructions. |
| Abandoned approval branches | `convex/outreach/approvals.ts`, `convex/outreach/approvalsModel.ts`, `convex/lib/validators/outreach.ts` | Reduced the resolver to its actual approval operation; removed unused reject/redraft inputs and a comment argument that was validated and discarded. |
| Trial repair/backfill path | `convex/billing/trialBuckets.ts` | Removed half-grant repair logic and its unused counter return. The sole caller creates the org and its trial buckets in one transaction; identity-based trial claims remain enforced. |
| Repeated failure and page shaping | `convex/billing/paidCall.ts`, AI/onboarding callers, `convex/lib/pagination.ts`, list queries | Consolidated repeated refund-to-error switches and pagination envelopes. Kept domain-specific failure codes and cursor behavior. |
| Pass-through wrappers and dead type surface | `convex/ai/models.ts`, `convex/ai/run.ts`, validators and frontend models | Removed the raw-model health-probe override, redundant gateway wrapper, unused validators/types, and exports used only inside their defining modules. |
| Ignored provisioning input | `convex/orgs/{model,mutations}.ts` | Removed unused `requestId`; provisioning already deduplicates transactionally on the active organization key. |
| UI scaffolding and dependencies | `src/components/ui/`, `package.json`, `pnpm-lock.yaml`, `src/assets/`, `public/icons.svg` | Removed unconsumed primitives/variants, date-picker dependencies, and template assets. Preserved components and variants with live consumers. |
| Old routes and utilities | `src/routes/{decisions,employees,leads,overview,prospects,squads,tour}.tsx` (deleted), `src/routeTree.gen.ts`, `src/lib/{date-ranges,org-time,presentation}.ts` | Removed obsolete redirects and unused date/presentation helpers; corrected references to deleted routes. |
| Repeated frontend error parsing | `src/lib/convex-error.ts`, onboarding/contact/inbox models | Reused the domain error-code reader rather than repeated untyped extraction branches. |

## Bugs corrected during review

- **Dashboard timezone:** `src/components/dashboard/dashboard-range.ts` formatted
  UTC bounds in the browser timezone even though queries use the organization's
  timezone. The caption now uses the organization timezone supplied by
  `DashboardPage.tsx`. For example, New York September 1–10 no longer appears as
  September 1–11 in a Kolkata browser.
- **Demo reset boundary:** `convex/orgs/reset.ts` originally allowed every host
  except one production hostname, and only checked membership on the server.
  The reset is restricted to the configured demo deployment and its verified
  organization creator. Availability and UI copy follow that server rule.
- **Reset interruption and cleanup:** reset now detaches the inbox, invalidates
  agent work, drains provider operations before dependent rows, and deletes
  organization-attributed quarantine records. Storage deletion errors are no
  longer silently swallowed.

## Deliberately retained

- `convex/inbox/backfill.ts` imports the previous 30 days of mailbox history when
  an inbox is connected. It is an active product feature, not a database
  migration. Its provenance checks prevent automation from answering history.
- Provider boundary adapters that accommodate the installed packages' actual
  type signatures, plus idempotency, receipt deduplication, credit settlement,
  bounded recovery, and authorization checks.
- Platform budgets and shared caches are not tenant data. Demo reset clears
  application-owned organization state; it does not delete the user's identity,
  provider mailbox, or component-owned provider caches. Requests already sent to
  external providers cannot be recalled.
- `hackathon.md` is historical project evidence and was not rewritten as current
  implementation documentation.

## Verification

No application test files or test script were present. No tests were added.

- Passed: `pnpm run lint`.
- Passed: `pnpm exec tsc --noEmit -p convex/tsconfig.json`.
- Passed: `pnpm run build` (frontend TypeScript and production bundle). Vite
  still reports its large-chunk advisory; this cleanup does not optimize bundles.
- Passed: `pnpm dlx knip --no-progress --include files,dependencies,unlisted,exports,types --no-config-hints`.
  Convex registered functions also received manual caller/reference review;
  static unused-export analysis alone cannot prove they are unneeded.
- Passed: `git diff --check`.
- **Development deployment blocked:** `pnpm exec convex dev --once --typecheck enable`
  reached schema validation and found an existing `businessProfiles` demo row
  with the removed `updatedBy` field. The database is not empty. Deployment was
  not completed, and further incompatible rows may exist beyond this first
  reported failure. This intentionally migration-free schema needs a clean
  development database before it can be deployed. No remote data was deleted
  and no compatibility backfill was added.

Provider calls and the destructive reset were not executed as part of this audit.
