# Provider adapter cleanup review

Date: 2026-09-14. Scope: unpushed `convex/integrations/*` and
`convex/http.ts`, reviewed against P04/P05 and their integration contracts.

Apollo remains deliberately untested and P04 remains partial. This review did
not authenticate providers, deploy a backend, provision resources, send mail,
or write test files. Local checks do not replace the later production gates.

## Corrected findings

- **AgentMail response-body uncertainty:** the request deadline previously
  ended when headers arrived, before reading the response body. A stalled
  body could outlive the deadline, and a disconnected body could throw after
  the provider had already accepted the message. The same timeout and catch
  now cover headers and body, returning `uncertain` with `timeout` or
  `transport_error` and the known HTTP status. Dispatch still makes exactly
  one request. Opaque inbox IDs are URL-encoded as one path segment.
- **Firecrawl URL policy gaps:** trailing-dot local hostnames and IPv6
  multicast/compatible addresses passed the literal-host guard. They are now
  rejected. The wrapper also validates the installed component's reported
  `metadata.url` and `metadata.sourceURL` before returning scraped evidence;
  previously the comment claimed this check but the handler omitted it.

## Local acceptance evidence

- `pnpm install --frozen-lockfile` passed without lockfile changes.
- `pnpm exec tsc --noEmit -p convex/tsconfig.json` passed.
- `pnpm lint` passed with the existing `use-mobile.ts` state-in-effect warning.
- `pnpm build` passed with the existing large-chunk advisory.
- `git diff --check` passed.
- In-memory manual Node checks executed the adapter helpers from the current
  source with a stubbed fetch and placeholder configuration. A successful
  acknowledgement returned `accepted`; a disconnected body returned
  `uncertain/transport_error`; an aborting stalled body returned
  `uncertain/timeout`. Each scenario made exactly one stub request and
  preserved the encoded inbox path. The deadline was shortened only in the
  local invocation so the stalled-body branch could be observed promptly.
- URL admission rejected seven local/private/credential-bearing cases,
  including trailing DNS root dots, multicast IPv6, IPv4-compatible IPv6 and
  mapped loopback. Three public hostname/global IPv6 examples were accepted.
- Inspected installed `@agentmail/convex@0.1.0` webhook handling and
  `@firecrawl/firecrawl-convex@0.1.1` metadata definitions. The existing
  component route/signature adapters remain unchanged.

## Remaining boundaries

Firecrawl performs the fetch remotely. Metadata admission happens after the
provider request and cannot block an intermediate redirect or DNS rebinding
inside provider infrastructure. Approved-domain/page budgets and production
tenant ownership remain P07/P09 work. Approved mail preflight, durable attempt
state and inbox/workspace mapping remain P10/P11 work. No integration status
was advanced by this cleanup.
