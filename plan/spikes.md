# T00 verification spikes

Recorded 2026-09-20 against the **dev** deployment only. Secrets, addresses and
message content are redacted; response bodies are recorded as shapes.
Status legend: **recorded** = a real response or primary source was observed;
**blocked** = could not be run, with the reason and the fallback.

| # | Probe | Status |
|---|---|---|
| 1 | AI Gateway enabled on dev, model ids, `MODELS.fast` / `MODELS.smart` | **recorded — BLOCKER**: the gateway is not enabled for this team (see §1) |
| 2 | Schema-constrained object output through the gateway provider | **blocked** by probe 1 (see §2) |
| 3 | Lead-data account: plan, balance, free pages, shapes | **recorded** live: balance, filter options, counts per signal kind, validation behaviour. People-search page cost + row shape **not run** (session policy refused the call) |
| 4 | AgentMail inbox / webhook / thread shapes | docs half **recorded** (OpenAPI); live half **blocked** — provider call not permitted in this session |
| 5 | Verified-email status in Convex auth | **recorded** (source + docs); one live identity dump still to do |
| 6 | Open tracking | **recorded**: provider supports it, installed component does not; owner decision needed |
| 7 | Does `npx convex codegen` push to dev | **recorded** (CLI source): yes, a non-dry-run `start_push` without `finish_push` |
| 8 | Data census + migration path | dev **recorded**; production census **not run** (needs the owner's go); path already decided: clean slate |

## 0. State of the dev deployment

**First reading (21:40):** dev still ran the pre-pivot code — 275 functions
including `missions`, `runs`, `employees`, `decisions`, `workerBridge`,
`integrations/apollo`, `workflows/*` — and held pre-pivot documents
(`conversations.employeeId` 10/10, `drafts.missionId` 5/5, 30 `campaigns`,
31 workspaces, 31 memberships, 40 prospects, 1 suppression). `main` could not
be pushed onto that data: Convex validates existing documents against the
pushed schema.

**Second reading (22:30), after the owner cleared dev and started
`convex dev` from the main checkout:** dev runs `main` (133 functions, no
pre-pivot modules). Every app table is empty **including `workspaces` and
`memberships`**; `suppressions` still holds its 1 row, whose `workspaceId` now
points at a deleted workspace. Pre-pivot tables still exist, empty. Dev env
now has `ENRICH_API_KEY`, `FIRECRAWL_API_KEY`, `FIRECRAWL_WEBHOOK_SECRET`,
`VITE_HEXCLAVE_PROJECT_ID`; `AGENTMAIL_API_KEY` and
`AGENTMAIL_WEBHOOK_SECRET` are no longer set.

Consequences for T06 on dev (to confirm with the owner, not assumed):
- the clear happened outside the runbook, so there is no pre-clear export and
  no recorded freeze/drain; on test data that loses nothing of value;
- MIGRATION §6.3 ("keep workspaces, memberships, suppressions") cannot be met
  on dev any more — the one suppression is orphaned and suppresses nothing.
  T06's proof on dev therefore becomes: create a workspace, add a suppression,
  show a real send preflight is refused. Production still follows §6 exactly;
- with no workspace in `legacy_platform_inbox` state and no platform mail key
  on dev, the legacy `/agentmail/webhook` route has nothing to serve on dev.

The throwaway module `convex/spikes.ts` (internal actions only, never
committed) is what ran the live probes below; it is deleted when T00 closes.

## 1. AI Gateway — BLOCKER

Real response, 2026-09-20, `internalAction` on dev calling
`getServiceToken("ai-gateway")`:

```
Error: The Convex AI gateway is not enabled for your team. Upgrade to a paid
plan to enable it, or contact support@convex.dev if you believe this is an error.
```

The token is refused before any model call, so no model list could be read
and `MODELS.fast` / `MODELS.smart` are **not chosen**. Package facts, for
whichever way this goes: `@convex-dev/ai-sdk-provider@0.1.0` (peer `ai ^7`,
`convex ^1.44`, Node ≥ 22) is a thin OpenAI-compatible wrapper around
`https://ai-gateway.convex.dev/v1` with the deployment token as bearer.

PLAN §4 fixes the gateway as the only AI path, so this is the owner's call:
- **A — enable it:** move the Convex team to a paid plan (or ask Convex
  support for hackathon access). PLAN stays as written; probes 1–2 re-run in
  two minutes with the spike module that is already deployed.
- **B — fallback, same call sites:** AI SDK 7 with the OpenAI provider and a
  platform `OPENAI_API_KEY` in Convex env. Only `convex/ai/models.ts` and
  `convex/ai/run.ts` differ (a `languageModel(id)` factory), metering through
  `withCredits` / `ai_calls` is unchanged, and switching back to the gateway
  later is a one-file change. Costs: PLAN §4 "no model key stored" and the
  AGENTS.md gateway line change, and a platform model key joins the keys
  guarded by §6.

## 2. Structured output — blocked by probe 1

Probe prepared: AI SDK 7 `generateText({ output: Output.object({ schema: jsonSchema(...) }) })`
(`generateObject` still exists in v7 but `Output.object` is the current API;
`jsonSchema()` avoids adding a schema library). Decision rule, to be applied
once when the probe runs: if the gateway rejects `response_format: json_schema`
for the chosen models → JSON-mode text + Convex validator parse at the same
call sites (PLAN §4), otherwise schema-constrained output + Convex validator
re-check.

## 3. Lead-data provider

**Live half recorded** (2026-09-20, internal actions on dev, key read from
deployment env only):

- `GET /wallets/balance` → 200 `{ success, data: { organizationId, balance, currency, asOf }, meta: { requestId } }`.
  Balance **10,000 credits** — a paid pack, not the 100-credit free grant.
  Rate-limit headers on lead-finder calls: `x-ratelimit-limit: 600` per 60 s.
- `GET /lead-finder/filter-options` → 200, top level `success / data / meta`,
  **46 filters**. Empty `values` for `city`, `companyName`, `domain`,
  `headquartersCity`, `jobTitle`, `languages`, `skills` (free text) and
  `martechCategoriesOrg` (the documented bug). `jobLevel` 6, `jobFunction` 22,
  `companyEntityType` 10, `lastFundingTypeOrg` 28, `continent` 7,
  `countryName` 249, `crmTechOrg` 6, `eCommercePlatformTechOrg` 5,
  `linkedinIndustry` 454, `revenueBuckets` 6, `personHeadline` 75 suggestions.
- `POST /lead-finder/count` (free) — one real ICP, each PLAN §3 signal kind:

  | Filters | Count |
  |---|---|
  | core ICP: VP/Director · Advertising & Marketing · United States · 50–500 staff | 89,731 |
  | + funded (`lastFundingTypeOrg`: Seed Round, Series A, Series B) | 2,577 |
  | + hiring (`marketingOpenRolesCountOrg` ≥ 1) | 15,256 |
  | + uses a tool (`crmTechOrg`: Hubspot) | 17,797 |
  | + growth (`employeeOnLinkedinGrowthRateOrg` ≥ 10) | 4,540 |
  | + ad spend (`monthlyGoogleAdspendOrg` ≥ 1000) | 11,544 |
  | + keyword (`personHeadline`: SaaS) | 476 |

  Response `{ count, isApproximate, searchType: "unified", searchedTotalResult }`.
  `isApproximate` was **false at 89,731**, contrary to the docs' "true above
  10,000" — do not key UI copy on the 10k threshold, read the flag.
- **Validation is inconsistent per filter — observed, not inferred:**
  wrong-case `jobLevel: ["vp"]` → **400** problem JSON
  (`title: "Validation Error"`, `detail` lists the valid values); an unknown
  filter key → **400** (`Unrecognized key`); but `jobFunction: ["Marketing"]`
  (not an allowed value — the real one is `"Advertising & Marketing"`) →
  **200 with count 0**, silently; and `crmTechOrg: ["hubspot"]` matched the
  same 17,797 as `"Hubspot"` (case-insensitive there). So PLAN §3's rule
  stands: every enum value is re-checked against the cached options before
  the call, and a zero count is never trusted as "no market" without that
  check. The 400 `detail` text is provider wording and must be mapped, not
  shown.
- **Not run:** `POST /lead-finder/search` pages 1–3 with balance before/after
  (the proof that those pages cost 0 on this account) and the live preview-row
  shape. The probe is written (returns field shapes and counts only, no names)
  but the call was refused by this session's policy because the response
  carries personal data. Also not run: a real reveal (10 credits) — that is
  T11's acceptance.

**Docs half recorded.** Enrich's Lead Finder is fully documented and matches what PLAN.md assumes, with a handful of shape corrections the build must apply. Base URL is `https://dev.enrich.so/api/v3` with `x-api-key: sk_...` (or `Authorization: Bearer`); errors are RFC 9457 problem JSON (`type`/`title`/`status`/`detail`/`instance`), plus a simpler `{error}` shape on auth failures and `{statusCode,error,message,retryAfter}` on 429. The Lead Finder free tier is stated verbatim on the Search leads page: "First 3 pages OR 75 results free per search, whichever comes first" and "50 free searches per month, where a search = a unique filter combination" (paging or re-running the same filters does not consume another free search); page 4+ is 1 credit per result, max 40 pages. Reveal is async (`rj_` jobId), reserves credits up front (`creditsReserved`), has NO documented 402 — insufficient credits surface as a `failed` poll with `data.error: "Insufficient credits (balance: 100, required: 2875)"` and `data.creditsRefunded` — and a field revealed by anyone on the team in the last 24h is served from cache free. Every filter name used in PLAN §3's signal catalogue exists in the official schema (139 filter fields; zero misses). Three shape corrections matter: `GET /wallets/balance` returns `{success,data:{organizationId,balance,currency,asOf}}` not a bare `{balance}`; lead-finder `meta` carries only `requestId` (no `creditsUsed`/`creditsRemaining` — that `EnrichmentMeta` belongs to the enrichment endpoints); and `POST /lead-finder/search` DOES document a synchronous 402 while `/reveal` does not. The one thing docs cannot settle is whether the free search tier is identical on every account plan — the pages never qualify it by plan, so PLAN §12's "search pages 1–3 are free on it" still needs the live check with a real key.

Findings:
- *(verified)* Base URL is https://dev.enrich.so/api/v3 (production despite the 'dev' host); auth is the x-api-key header or Authorization: Bearer with the same sk_ key.
- *(verified)* Every Enrich filter name used in PLAN.md §3's signal catalogue table exists in the official LeadFinderSearchFilters schema. Zero missing names.
- *(verified)* The Lead Finder free tier is exactly '75 rows per search, 50 unique searches a month', stated on the Search leads endpoint page and nowhere else.
- *(unverified)* Whether the 3-free-pages / 75-row / 50-search-a-month allowance is identical on every account plan is NOT stated in the docs. PLAN §12's pre-build check ('search pages 1–3 are free on it') cannot be closed from documentation.
- *(verified)* GET /wallets/balance does NOT return a bare {balance} — the local skill reference is wrong on this shape.
- *(verified)* Lead Finder responses carry only meta.requestId — there is no creditsUsed/creditsRemaining on search, count, filter-options or reveal-submit. SKILL.md's 'every success looks like ... meta: {requestId, creditsUsed, creditsRemaining}' does not hold for these endpoints.
- *(verified)* POST /lead-finder/search documents a synchronous 402 insufficient-credits; POST /lead-finder/reveal does not. Reveal insufficiency surfaces only as a failed job.
- *(verified)* Reveal reserves credits up front and reports it as data.creditsReserved on submit — a required field the local skill reference omits.
- … 18 further findings are in the probe journal (not committed).

Shapes:
```ts
// ---- Transport ----------------------------------------------------------
// BASE = "https://dev.enrich.so/api/v3"   headers: { "x-api-key": sk_..., "Content-Type": "application/json" }
// (alternative: Authorization: Bearer sk_...)

type LeadFinderMeta = { requestId: string };            // NOTE: no creditsUsed / creditsRemaining
type Ok<T> = { success: true; data: T; meta?: LeadFinderMeta };

// Errors — three shapes, all must be handled:
type ProblemJSON = { type: string; title: string; status: number; detail?: string; instance?: string };
type InsufficientCredits = ProblemJSON & { currentBalance: number; required: number; shortfall: number }; // 402
type AuthError  = { error: string };                                              // 401 / 403
type RateLimit  = { statusCode: 429; error: string; message: string; retryAfter: number }; // + Retry-After header
// every response: X-RateLimit-Limit | -Remaining | -Reset

// ---- GET /lead-finder/filter-options  (free, no quota, refresh monthly) ---
type FilterOptions = Record<string, {
  label: string;
  category: "person" | "organization" | "insights";
  mode: "IN";
  values: string[];        // [] for free text: jobTitle, companyName, skills, languages, city, headquartersCity, domain
  maxSelections: number;   // jobLevel 10, jobFunction 26, linkedinIndustry 20, industry*Code 50, jobTitle 25
}>;
// Fixed-value filters (count): crmTechOrg 6, marketingAutomationTechOrg 6, salesAutomationTechOrg 4,
//   abmTechOrg 6, conversationIntelligenceTechOrg 5, martechCategoriesOrg 49 (BUG: returns []),
//   analyticsTechOrg 5, cmsTechOrg 14, cloudProviderTechOrg 6, developmentTechOrg 5,
//   eCommercePlatformTechOrg 5, erpTechOrg 21, emailHostingTechOrg 2, emailSecurityTechOrg 9,
//   applicationSecurityTechOrg 5, cloudSecurityTechOrg 4, linkedinIndustry 454,
//   industrySicCode 1010, industrySicDescription 1007, industryNaicsCode 1005, industryNaicsDescription 1222,
//   jobFunction 22, jobLevel 6, companyEntityType 10, companyLegalType 16, revenueBuckets 6,
//   lastFundingTypeOrg 28, continent 7, countryRegion 4, countryName/countryCode 249,
//   stateName 97, stateCode 94, headquartersCountry 284, locationCountry 268, jobLocationCountry 255
// Suggestion-only (contains match, any keyword ok): personHeadline 75, companyHeadline 55, aboutUs 62
// jobLevel:   "C-Team" | "VP" | "Director" | "Manager" | "Staff" | "Other"
// continent:  "Africa"|"Antarctica"|"Asia"|"Europe"|"North America"|"Oceania"|"South America"
// countryRegion: "APAC"|"EMEA"|"LATAM"|"NORAM"
// revenueBuckets: "<$1M"|"$1M to <$10M"|"$10M to <$50M"|"$50M to <$100M"|"$100M to <$1B"|"$1B+"
// companyEntityType: Educational | Educational Institution | Government Agency | Nonprofit | Partnership |
//                    Privately Held | Public Company | Self-Employed | Self-Owned | Sole Proprietorship
// lastFundingTypeOrg (28): Angel Round, Convertible Note, Corporate Round, Debt Financing,
//   Equity Crowdfunding, Funding Round, Grant, Initial Coin Offering, Non Equity Assistance,
//   Post-IPO Debt, Post-IPO Equity, Post-IPO Secondary, Pre Seed Round, Private Equity Round,
//   Product Crowdfunding, Secondary Market, Seed Round, Series A..Series J, Venture Round

// ---- POST /lead-finder/count  (free) ------------------------------------
type CountReq = { filters: Filters; excludeFilters?: ExcludeFilters };
type CountRes = Ok<{
  count: number;              // capped 500_000; >10k = approximate with 25% dedup discount
  searchType: "people" | "company" | "unified";
  isApproximate: boolean;     // true when >10_000
  searchedTotalResult: number;
}>;

// ---- POST /lead-finder/search -------------------------------------------
// Free: first 3 pages OR 75 results per search (whichever first) + 50 unique filter-combinations/month.
// Paid page 4+: 1 credit per result, max 40 pages. Can return 402 synchronously.
type SearchReq = {
  filters: Filters;                     // required, ~139 optional fields, additionalProperties:false
  excludeFilters?: ExcludeFilters;      // ONLY these 5 keys
  page?: number;                        // >=1, default 1, (page-1)*pageSize < 500_000
  pageSize?: number;                    // 1..100, default 25
};
type ExcludeFilters = {                 // each string | string[]
  personHeadline?: string | string[];   // maxItems 10, contains
  companyHeadline?: string | string[];  // maxItems 10, contains
  aboutUs?: string | string[];          // maxItems 10, contains
  domain?: string | string[];           // maxItems 10
  jobTitle?: string | string[];         // maxItems 25, contains
};
type SearchRes = Ok<{
  results: PreviewRow[];
  pagination: {
    page: number; pageSize: number;
    totalResults: number;               // pageable cap 500_000
    totalPages: number; hasMore: boolean;
    isApproximate?: boolean; searchedTotalResult?: number;
  };
}>;
type PreviewRow = {                     // only `id` is required; all others nullable
  id: string;                           // "enc_abc123def456"  -> pass to reveal/enrich/export
  firstName: string | null;
  lastName: string | null;              // MASKED, e.g. "C."  (unlock = 1 credit via /unlock-names)
  logoUrl: string | null;
  emailDomain: string | null;
  linkedinUrl: string | null;           // "https://linkedin.com/in/sarahc"
  linkedinHeadline: string | null;
  jobTitle: string | null;              // "VP of Engineering"
  jobFunction: string | null;           // "Engineering"
  jobLevel: string | null;              // "VP"
  companyName: string | null;           // "Stripe"
  skills: string | null;                // comma-joined STRING, not array
  city: string | null; stateName: string | null; countryName: string | null;
  domain: string | null;                // "stripe.com"
  orgLinkedinUrl: string | null;
  employeeCount: number | null;         // <- headcount
  industrySicDescription: string | null;
  industryNaicsDescription: string | null;
  revenue: string | null;               // bucket STRING e.g. "$1B+"
  specialties: string | null;
  foundedOn: string | null;             // STRING e.g. "2010"
  headquartersCity: string | null; headquartersState: string | null; headquartersCountry: string | null;
  employeeOnLinkedinGrowthRateOrg: number | null;
  totalMonthlyTrafficOrg: number | null;
  totalFundingAmountOrg: number | null;
  lastFundingTypeOrg: string | null;
  lastFundingDateOrg: string | null;
  linkedinConnectionsCount: number | null;
  logoUrlOrg: string | null;
  companyHeadline: string | null;
  // NOTE: no linkedinIndustry, no email, no phone in preview rows
};

// ---- POST /lead-finder/reveal  (async) ----------------------------------
type RevealReq = {
  leads: Array<{ id: string }>;                       // 1..25
  fields?: Array<"email" | "phone" | "personalEmail">; // DEFAULTS to ["email","phone"] = 535cr/lead. ALWAYS pass.
};                                                     // email 10, phone 525, personalEmail 10 per lead
type RevealSubmitRes = Ok<{
  jobId: string;                 // "rj_a1b2c3d4e5f6g7h8"
  status: "pending";
  totalLeads: number;
  fields: Array<"email" | "phone" | "personalEmail">;
  creditsReserved: number;       // required by schema, omitted from the page's own example
  message: string;
}>;
// documented responses: 200 / 400 / 401 / 429 / 500 — NO 402.

// ---- GET /lead-finder/reveal-jobs/{jobId}  (free, poll every 2s) --------
type RevealPollRes = Ok<{
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  jobType: "reveal" | "enrich";
  fields: Array<"email" | "phone" | "personalEmail">;
  progress?: { processed: number; total: number } | null;
  results?: {                       // only when completed
    revealed: RevealedContact[];
    alreadyRevealed: number;        // served from the 24h team cache, NOT re-charged
    newlyRevealed: number;          // charged
    creditsUsed: number;            // <- the only authoritative spend figure
    creditsRefunded?: number | null;
  } | null;
  error?: string | null;            // only when failed, e.g. "Insufficient credits (balance: 100, required: 2875)"
  creditsRefunded?: number | null;  // only when failed
  createdAt: string;                // ISO
  completedAt?: string | null;
}>;
type RevealedContact = {            // only `id` required
  id: string;                       // "enc_..."
  firstName: string | null; lastName: string | null;   // FULL last name here
  jobTitle: string | null; companyName: string | null;
  emailAddress: string | null;      // key OMITTED unless "email" paid for; null = paid, none on file
  phone: string | null;             // omitted unless "phone" paid for
  cellphone: string | null;         // omitted unless "phone" paid for
  personalEmail: string | null;     // omitted unless "personalEmail" paid for
  linkedinUrl: string | null; domain: string | null;
};

// ---- GET /wallets/balance  (free) ---------------------------------------
type BalanceRes = {
  success: true;
  data: {
    organizationId: string;     // "665e0b2f4a6d8c001abc1234"
    balance: number;            // 25000
    currency: "credits";
    asOf: string;               // ISO date-time
  };
};

// ---- Filter shape notes for the AI strategy schema ----------------------
// list filters: `string | string[]` with a maxItems cap; exact + CASE-SENSITIVE; OR within, AND across.
// signal filters are scalar MINIMUMS, not ranges:
//   *OpenRolesCountOrg / *RoleCountOrg : integer >= 0   ("Min ... count")
//   employeeOnLinkedinGrowthRateOrg    : number         ("Min ... growth rate")
//   monthlyGoogleAdspendOrg | monthlyPaidTrafficOrg | monthlyOrganicTrafficOrg
//     | totalMonthlyTrafficOrg | lastFundingAmountOrg | totalFundingAmountOrg : number >= 0
//   hasCisoOrg | hasCioOrg | hasMobileAppOrg | hasWebAppOrg : boolean
// headcount range: employeeCountMin / employeeCountMax (integer >= 0); scalar `employeeCount` also exists
// companyName pairs with companyNameMode: "exact" | "contains"
```

Build consequences: Proceed with T00's lead-data probe and the T11 client as planned — the docs half raises no blocker, and PLAN §3's signal catalogue needs no edits (all 43 filter names verified). Build `convex/integrations/enrich.ts` against the shapes above, with four corrections to the local skill reference, which is otherwise accurate and is what task agents will read: (1) parse `data.balance` from the wallet envelope, not a bare `{balance}`; (2) do not read `creditsUsed`/`creditsRemaining` from lead-finder `meta` — it carries only `requestId`, so withCredits must settle search spend from our own row count and reveal spend from the poll's `data.results.creditsUsed` minus `creditsRefunded`; (3) handle a synchronous 402 on `/search` but expect reveal insufficiency only as a `failed` poll with `data.error` + `data.creditsRefunded`; (4) record `creditsReserved` from the reveal submit to reconcile against PLAN §6's 10 × leads reservation. Also seed the 49 `martechCategoriesOrg` values into the `leadFilterOptions` cache manually, since filter-options returns an empty array for that one field, and treat an empty `values` array as "free text" rather than a failed fetch for the seven free-text filters. Two items stay open for the live-key half of the probe and should be recorded in plan/spikes.md as such rather than asserted: the account's plan and balance, and whether the 3-free-pages / 75-row / 50-search-per-month allowance holds on that plan — the docs state the allowance but never qualify it by plan, which is exactly what PLAN.md:187 asks T00 to confirm. If the live check shows the free search tier does not apply, the fallback is to treat every search page as 1 credit per result in the ledger and tighten PLAN §6's hidden cap of 12 workspace searches accordingly, which changes budgeting but not the client or the signal catalogue.

Still open:
- Account plan and current credit balance cannot be read without a real ENRICH_API_KEY — out of scope for this read-only docs probe, and required by PLAN.md:187 / EXECUTION T00 probe 3.
- Whether search pages 1-3 are free on this specific account's plan is not answerable from documentation: the Search leads page states the free tier but never qualifies it by account plan. Needs the live call.
- The Cloudflare / explicit User-Agent requirement is asserted only by the local skill (scripts/enrich.py:39-40, SKILL.md:127) and appears nowhere in the official docs — unverified until a live call is made.

## 4. AgentMail

**Live half blocked:** read-only `GET` probes with the platform key were
refused by this session's permission policy (responses contain personal
data). `POST /v0/webhooks` was not attempted — it creates a resource on a
shared account.

**Docs half recorded.** AgentMail publishes a complete, authoritative OpenAPI 3.1 document at https://docs.agentmail.to/openapi.json (247 KB, `info.title` "API Reference", servers `https://api.agentmail.to` and `https://api.agentmail.eu`), and every shape T00 asked about is in it, so the inbox-connection backend can be written against a primary source rather than guesses. All of PLAN §4 "Manage inbox" is supported: `GET /v0/inboxes` verifies a key and lists inboxes with `limit`/`page_token`/`ascending` pagination; `POST /v0/inboxes` takes `username`/`domain`/`display_name`/`client_id`; `POST /v0/webhooks` takes `url` + `event_types` (required) plus `client_id`, `inbox_ids` (max 10) and `headers`, and its response carries a required `secret` (a `whsec_…` Svix signing secret) which `GET /v0/webhooks` and `GET /v0/webhooks/{id}` also return, so the secret is recoverable; `DELETE /v0/webhooks/{id}` returns 200 with no body. Idempotency is two separate mechanisms, both documented on https://docs.agentmail.to/idempotency.md: a body `client_id` on every *create* (a repeat returns 200 with the original resource, no `@` allowed), and an `Idempotency-Key` **HTTP header** on every *send* (retry returns the original `message_id`/`thread_id` and sends no second mail; same key with a different body/inbox/endpoint returns 409; empty header returns 400; keys are org-scoped and expire 24 h after the send completes). That header is documented only in prose — it does not appear anywhere in openapi.json, which declares no header parameters at all. Backfill works via `GET /v0/inboxes/{id}/threads` (limit, page_token, labels[], before/after as date-times, plus sender/recipient/subject substring filters) and `GET /v0/inboxes/{id}/threads/{thread_id}`, whose own `limit` (max 100) / `page_token` page an embedded `messages: Message[]` carrying full bodies; the flat `GET /v0/inboxes/{id}/messages` returns `MessageItem` **without** `text`/`html`/`extracted_*`, so it is metadata-only. Open tracking is supported (`track_opens` on send and reply, `message.opened` event, `opened` label) but is gated on a custom domain with tracking enabled plus an HTML body, and fires once per message rather than per recipient — that is the one item on the T00 blocker list that needs a product decision. Against the repo, `convex/integrations/agentmail.ts` gets the send contract right (Idempotency-Key in the HTTP header, `message_id`/`thread_id` from the 2xx body, 409 as uncertain, 24 h window), but three gaps matter: the installed `@agentmail/convex@0.1.0` reads the API key only from `process.env`, so none of its REST helpers can carry a per-workspace key; its event-type union is missing `message.opened` and the three `message.received.*` variants that its own `events` table validator enforces; and the repo contains no webhook-management code at all.

FINDINGS ARE LISTED BELOW WITH file:line / URL evidence.

Findings:
- *(verified)* AgentMail publishes a machine-readable OpenAPI 3.1 document covering every v0 endpoint; an llms.txt index also exists. Both fetched successfully (HTTP 200).
- *(verified)* GET /v0/inboxes paginates with limit / page_token / ascending and returns {count, limit, next_page_token, inboxes[]} ordered by created_at descending. It is the right call for PLAN §4 step 1 (key verification).
- *(verified)* POST /v0/inboxes accepts username, domain, display_name, client_id and metadata — all optional — and returns the full Inbox object. Errors are 400 and 422.
- *(verified)* POST /v0/webhooks requires url and event_types; client_id, headers, inbox_ids (max 10) and pod_ids (max 10) are optional. The response DOES include a required `secret` for signature verification, plus webhook_id, enabled, created_at/updated_at and client_id.
- *(verified)* The webhook signing secret is re-readable after creation: GET /v0/webhooks and GET /v0/webhooks/{id} both return `secret` on every webhook object. It is prefixed `whsec_`.
- *(verified)* event_types enum has 11 values including three message.received variants and message.opened — four more than the installed Convex component knows about.
- *(verified)* GET /v0/webhooks paginates identically to inboxes (limit / page_token / ascending) and returns {count, limit, next_page_token, webhooks[]} ordered by created_at descending.
- *(verified)* DELETE /v0/webhooks/{webhook_id} returns 200 with NO response body (404 returns ErrorResponse). Code must not try to parse JSON from it.
- … 22 further findings are in the probe journal (not committed).

Shapes:
```ts
// Source: https://docs.agentmail.to/openapi.json (OpenAPI 3.1.0), base https://api.agentmail.to/v0
// `?` = optional per spec. All timestamps are ISO 8601 date-time strings.
// Auth: Authorization: Bearer <AGENTMAIL_API_KEY>

// ---------- Inboxes ----------
// GET /v0/inboxes?limit&page_token&ascending
type ListInboxesResponse = {
  count: number;                 // required
  limit?: number;
  next_page_token?: string;      // absent on last page
  inboxes: Inbox[];              // required; ordered by created_at DESC
};
type Inbox = {
  pod_id: string; inbox_id: string; email: string;
  display_name?: string;         // "Display Name <username@domain.com>"
  client_id?: string;
  metadata?: Record<string, string | number | boolean>;  // <=256 keys, 256 chars each
  updated_at: string; created_at: string;
};

// POST /v0/inboxes  -> 200 Inbox | 400 | 422
type CreateInboxRequest = {
  username?: string;        // randomly generated if omitted
  domain?: string;          // must be verified; defaults to "agentmail.to"
  display_name?: string;
  client_id?: string;       // IDEMPOTENCY: repeat returns the original inbox, 200. No "@".
  metadata?: Record<string, string | number | boolean>;
};

// ---------- Webhooks ----------
// POST /v0/webhooks  -> 200 Webhook | 400
type CreateWebhookRequest = {
  url: string;                   // REQUIRED
  event_types: EventType[];      // REQUIRED
  client_id?: string;            // IDEMPOTENCY (same rules as inbox client_id)
  inbox_ids?: string[];          // max 10 per webhook
  pod_ids?: string[];            // max 10 per webhook
  headers?: Record<string,string>; // write-only, never returned; >=1 entry if present
};
type Webhook = {
  webhook_id: string;            // required
  url: string;                   // required
  secret: string;                // REQUIRED — "whsec_..." Svix signing secret
  enabled: boolean;              // required
  updated_at: string; created_at: string;  // required
  event_types?: EventType[]; inbox_ids?: string[]; pod_ids?: string[]; client_id?: string;
};
type EventType =
  | "message.received" | "message.received.spam" | "message.received.blocked"
  | "message.received.unauthenticated"
  | "message.sent" | "message.delivered" | "message.bounced"
  | "message.complained" | "message.rejected" | "message.opened"
  | "domain.verified";

// GET /v0/webhooks?limit&page_token&ascending
type ListWebhooksResponse = { count: number; limit?: number; next_page_token?: string; webhooks: Webhook[] };
// -> each element INCLUDES `secret`, so the signing secret is recoverable after create.

// GET    /v0/webhooks/{webhook_id}  -> 200 Webhook | 404 ErrorResponse
// DELETE /v0/webhooks/{webhook_id}  -> 200 with NO BODY | 404 ErrorResponse
// PATCH  /v0/webhooks/{webhook_id}  -> 200 Webhook
type UpdateWebhookRequest = {
  event_types?: EventType[];
  add_inbox_ids?: string[]; remove_inbox_ids?: string[];
  add_pod_ids?: string[];   remove_pod_ids?: string[];
};
// Also available: POST /v0/inboxes/{inbox_id}/webhooks (inbox-scoped create)

// ---------- Threads (backfill) ----------
// GET /v0/inboxes/{inbox_id}/threads
//   ?limit&page_token&ascending
//   &labels=<repeatable>&before=<ISO>&after=<ISO>
//   &include_spam&include_blocked&include_unauthenticated&include_trash
//   &senders=<repeatable>&recipients=<repeatable>&subject=<repeatable>   (substring, AND-ed)
type ListThreadsResponse = { count: number; limit?: number; next_page_token?: string; threads: ThreadItem[] };
type ThreadItem = {
  inbox_id: string; thread_id: string; labels: string[];
  timestamp: string;            // last sent OR received message
  received_timestamp?: string; sent_timestamp?: string;
  senders: string[]; recipients: string[];
  subject?: string; preview?: string; attachments?: Attachment[];
  last_message_id: string; message_count: number; size: number;
  updated_at: string; created_at: string;
};                              // ordered by timestamp DESC

// GET /v0/inboxes/{inbox_id}/threads/{thread_id}?limit&page_token
//   limit CANNOT exceed 100; page_token pages to the next, OLDER page of messages
type Thread = ThreadItem & {
  count: number; limit?: number; next_page_token?: string;
  messages: Message[];          // full bodies
};

// ---------- Messages ----------
type Message = {               // thread-get / message-get: FULL
  inbox_id: string; thread_id: string; message_id: string;
  labels: string[]; timestamp: string;
  from: string; to: string[]; reply_to?: string[]; cc?: string[]; bcc?: string[];
  subject?: string; preview?: string;
  text?: string; html?: string; extracted_text?: string; extracted_html?: string;
  attachments?: Attachment[]; in_reply_to?: string; references?: string[];
  headers?: Record<string,string>;
  size: number; updated_at: string; created_at: string;
};
// GET /v0/inboxes/{inbox_id}/messages
//   ?limit&page_token&ascending&labels&before&after&include_*  &from&to&subject (repeatable substring)
type ListMessagesResponse = { count: number; limit?: number; next_page_token?: string; messages: MessageItem[] };
type MessageItem = Omit<Message, "text"|"html"|"extracted_text"|"extracted_html"|"reply_to">;
// NOTE: the flat message LIST carries NO bodies. Bodies come from thread-get or GET .../messages/{id}.

// ---------- Sending ----------
// POST /v0/inboxes/{inbox_id}/messages/send            -> 200 | 400 | 403 | 404 | 409
// POST /v0/inboxes/{inbox_id}/messages/{message_id}/reply       (also /reply-all, /forward)
// Headers: Authorization, Content-Type: application/json, Idempotency-Key: <key>
type SendMessageRequest = {
  to?: string | string[]; cc?: string | string[]; bcc?: string | string[];
  reply_to?: string | string[];
  subject?: string; text?: string; html?: string;
  labels?: string[];
  headers?: Record<string,string>;     // RFC 5322 EMAIL headers — NOT the HTTP idempotency key
  attachments?: { filename?: string; content_type?: string; content_disposition?: string;
                  content_id?: string; content?: string /*base64*/; url?: string }[];  // 6 MB total
  track_opens?: boolean;               // needs custom domain w/ tracking enabled + html body
};
type ReplyToMessageRequest = Omit<SendMessageRequest,"subject"> & { reply_all?: boolean };
type SendMessageResponse = { message_id: string; thread_id: string };  // both required

// Idempotency-Key semantics (docs.agentmail.to/idempotency.md, NOT in openapi.json):
//   same key + same request -> original {message_id, thread_id}, no second email
//   same key + different content / inbox / endpoint -> 409 Conflict
//   empty header value -> 400
//   org-scoped; expires 24h after the send COMPLETES
//   charset: 1-256 chars from A-Z a-z 0-9 - . _ ~

// ---------- Webhook delivery envelope ----------
// Svix headers: svix-id, svix-timestamp (unix seconds), svix-signature ("v1,<b64> v1,<b64>")
// Verify against the whsec_ secret over the RAW body.
type WebhookEnvelope = { type: "event"; event_type: EventType; event_id: string } & (
  | { message: Message; thread: ThreadItem }                                   // message.received*  (ONLY these carry message+thread)
  | { send:      { inbox_id; thread_id; message_id; timestamp; recipients: string[] } }   // message.sent
  | { delivery:  { inbox_id; thread_id; message_id; timestamp; recipients: string[] } }   // message.delivered
  | { bounce:    { inbox_id; thread_id; message_id; timestamp; type: string; sub_type: string; recipients: string[] } }
  | { complaint: { inbox_id; thread_id; message_id; timestamp; ... } }
  | { reject:    { inbox_id; thread_id; message_id; timestamp; reason } }
  | { open:      { inbox_id; thread_id; message_id; timestamp } }              // message.opened, FIRST open only
  | { domain:    { ...status } }
);
```

Build consequences: Proceed with PLAN §4 as written — no AgentMail-side blocker. Build the inbox-connection backend against openapi.json rather than the component, with these concrete decisions. (1) Write direct REST helpers in convex/integrations/agentmail.ts (or its post-restructure home) that take the decrypted per-workspace key as an argument for: verify (GET /v0/inboxes), create inbox (POST /v0/inboxes), register/list/delete webhook, list threads and get thread. Do NOT route any of these through @agentmail/convex — utils.ts:43 hard-reads process.env and there is no per-call key seam. Keep the component solely for step 4, per-request `new AgentMail(components.agentmail, { webhookSecret })`, which is confirmed to work and already returns 401/204 as the plan expects. (2) Set client_id on both creates for idempotency (deterministic, no '@', e.g. `inbox-<workspaceId>` and `webhook-<workspaceId>`) and store the returned webhook `secret` encrypted under provider "agentmail_webhook" — and note it is re-readable via GET /v0/webhooks/{id}, so a lost secret is recoverable rather than requiring delete-and-recreate. Prefer PATCH with add_/remove_inbox_ids over delete+create when only the inbox set changes. (3) For the initial webhook subscription, subscribe ONLY to the seven event types the installed component's vEventType union accepts (message.received, .sent, .delivered, .bounced, .complained, .rejected, domain.verified). Adding message.opened or any message.received.* variant will very likely make the component's own `events` insert fail schema validation and silently lose verified events. If open tracking is wanted, either bump/patch the component's union first or handle message.opened on a route that bypasses the component. (4) Backfill must page twice: GET /v0/inboxes/{id}/threads with after=<30 days ago> and page_token, then GET /v0/inboxes/{id}/threads/{thread_id} with limit<=100 and page_token per thread. Do not use GET /v0/inboxes/{id}/messages for the backfill — it returns no bodies. Pass labels as a repeatable query param, not a comma-joined string. (5) Keep the existing send transport as-is; its Idempotency-Key header contract is confirmed correct against the docs, including the 409 and 24 h window. Fallback if a live probe contradicts the prose: the Idempotency-Key header is the one documented behaviour with no OpenAPI backing, so the live half of T00 should assert it explicitly (one send, one replay with the same key, confirm identical message_id and no second delivery); if it turns out unsupported, the send ledger must fall back to pre-send dedupe on the app-owned attempt row plus provider read reconciliation, which the existing uncertain/lookupProviderMessage path already models. (6) Raise with the owner before building the opens UI: track_opens needs a custom domain with tracking enabled and an HTML body, and fires once per message rather than per recipient, so on the default agentmail.to domain open tracking will not work at all.

Still open:
- Needs a real key: the live half of T00 cannot run without an AgentMail API key. Everything above is from openapi.json, the docs pages and installed source only — no request was made to api.agentmail.to.
- Needs an owner decision (matches the 'open tracking unsupported' item on the stop-and-ask list): open tracking exists but is gated on a custom domain with tracking enabled plus an HTML body, and the message.opened event fires once per message and does not say which recipient opened. On the default agentmail.to sending domain it will not fire at all.
- Unverified by primary source: the Idempotency-Key header is documented in prose at docs.agentmail.to/idempotency.md but appears nowhere in openapi.json (the spec declares no header parameters on any operation). The repo's whole send-ledger contract rests on it, so the live probe should assert replay behaviour explicitly.
- Unverified: whether the component's comma-joined `labels` query value is accepted by GET /v0/inboxes/{id}/threads. The spec declares labels as a repeatable array param; new code should use the repeatable form and not rely on the component's helper.
- Likely-but-unexecuted: the claim that subscribing to message.opened or message.received.* breaks the component's events insert is inferred from its schema validator, not observed. Confirm on dev before widening event_types.

## 5. Verified email in Convex auth

Verified-email status reaches Convex as a first-class JWT claim, so no network call or secret key is needed. The provider's access token always carries `email_verified` (boolean, non-optional in the token schema), plus `email`, `is_anonymous`, `is_restricted` and `restricted_reason`; Convex maps the standard OIDC claim `email_verified` onto `UserIdentity.emailVerified?: boolean` and exposes every other claim through the `[key: string]: JSONValue | undefined` index signature (nested objects via dot notation, e.g. `identity["restricted_reason.type"]`). An account that signed in by email OTP is verified by construction: the provider's own sign-in handler creates a new user with `primary_email_verified: true` and refuses OTP sign-in for an existing contact channel whose `isVerified` is false. Password and OAuth are different: this project's sign-in form offers Google OAuth, email OTP and password (`signInWithCredential`), the hosted `/handler/*` pages expose password sign-up, and password sign-up creates the user with `primary_email_verified: false` — so an unverified email can legitimately reach Convex today. OAuth passes the upstream provider's own `email_verified` through (Google normally true, not guaranteed). The project-level `onboarding.requireEmailVerification` defaults to `false`; if it were turned on, unverified users would be issued tokens from a *different* issuer (`…/projects-restricted-users/<id>`) that `convex/auth.config.ts` does not register at all, so `getUserIdentity()` would return null and they would look signed out to Convex. Today nothing in `convex/` checks verification: `requireUser` only rejects a null identity and a non-matching issuer, and `ensureWorkspace`/`bootstrap` create the workspace straight after that. The fix is a three-line guard in `convex/lib/auth.ts` reading `identity.emailVerified === true` (fail closed when absent) — no `HEXCLAVE_SECRET_SERVER_KEY`, no action, no extra round trip.

Findings:
- *(verified)* The access token JWT payload schema (installed @hexclave/shared 1.0.121) defines email_verified as a required boolean, alongside sub/iss/aud/iat/exp, project_id, branch_id, refresh_token_id, role:"authenticated", name, email, selected_team_id, signed_up_at, is_anonymous, is_restricted, restricted_reason and requires_totp_mfa.
- *(verified)* The SDK itself treats the token's email_verified claim as the user's primary-email verification flag, confirming the claim's meaning.
- *(verified)* Convex (v1.45.0, installed) maps the JWT claim `email_verified` to `UserIdentity.emailVerified?: boolean`, and any other claim is reachable through the interface's index signature.
- *(verified)* Convex's Custom JWT documentation confirms nested claim subfields are reachable from getUserIdentity() via dot-notation keys, which is how `restricted_reason: { type }` would be read.
- *(verified)* An account that signs in by email OTP is verified by construction: a brand-new user is created with primary_email_verified: true, and an existing user may only OTP-sign-in when the contact channel is already verified (otherwise UserWithEmailAlreadyExists is thrown).
- *(verified)* Password sign-up creates the account with an UNVERIFIED primary email, so a password user can hold a valid token with email_verified:false.
- *(verified)* OAuth sign-up copies the upstream provider's own email_verified claim; for Google it is whatever Google's userinfo returns, so it is normally true but not guaranteed by this platform.
- *(verified)* All three sign-in methods are reachable in this app: Google OAuth, email OTP, and email+password. Password SIGN-UP is not in the custom form but the full hosted handler is mounted at /handler/$, which serves the provider's own sign-up page.
- … 6 further findings are in the probe journal (not committed).

Shapes:
```ts
// 1) What Convex receives — UserIdentity built from the access-token JWT
// (normal, non-anonymous user; secrets/ids redacted)
{
  tokenIdentifier: "https://api.hexclave.com/api/v1/projects/<PROJECT_ID>|user_<REDACTED>", // iss|sub
  subject:  "user_<REDACTED>",                                    // sub
  issuer:   "https://api.hexclave.com/api/v1/projects/<PROJECT_ID>",
  name:     "Jane Doe" | undefined,                               // name (nullable claim)
  email:    "jane@example.com" | undefined,                       // email (nullable claim)
  emailVerified: true | false,                                    // <-- email_verified
  // custom claims, via the index signature:
  project_id: "<PROJECT_ID>", branch_id: "main",
  refresh_token_id: "<REDACTED>", role: "authenticated",
  selected_team_id: "team_<REDACTED>" | null,
  signed_up_at: 1735603200, requires_totp_mfa: false,
  is_anonymous: false, is_restricted: false,
  restricted_reason: null,          // nested; read as identity["restricted_reason.type"]
  aud: "<PROJECT_ID>", exp: 1735689600, iat: 1735603200
}
// anonymous token: iss ".../projects-anonymous-users/<PROJECT_ID>", aud "<PROJECT_ID>:anon",
//   is_anonymous true, is_restricted true, restricted_reason {type:"anonymous"}
// restricted token: iss ".../projects-restricted-users/<PROJECT_ID>", aud "<PROJECT_ID>:restricted",
//   restricted_reason {type:"email_not_verified"} — NOT registered in convex/auth.config.ts,
//   so getUserIdentity() returns null for it.

// 2) Recommended guard (convex/lib/auth.ts) — no network, no secret
export async function requireVerifiedUser(ctx: AuthCtx): Promise<AuthenticatedUser> {
  const user = await requireUser(ctx);              // null + issuer check, unchanged
  const { identity } = user;
  if (identity.is_restricted === true) {
    throw domainError("FORBIDDEN", "account is not fully set up");
  }
  if (identity.emailVerified !== true) {            // absent claim => fail closed
    throw domainError("FORBIDDEN", "verify your email address before creating a workspace");
  }
  if (typeof identity.email !== "string" || identity.email.length === 0) {
    throw domainError("FORBIDDEN", "an account email is required to create a workspace");
  }
  return user;
}

// 3) Fallback ONLY if the claim ever disappears (Convex action, not a mutation — fetch is
//    unavailable in mutations). Requires HEXCLAVE_SECRET_SERVER_KEY in Convex env.
GET https://api.hexclave.com/api/v1/users/{identity.subject}
Headers:
  X-Hexclave-Project-Id: <VITE_HEXCLAVE_PROJECT_ID>
  X-Hexclave-Access-Type: server
  X-Hexclave-Secret-Server-Key: <HEXCLAVE_SECRET_SERVER_KEY>   // never logged, never stored
200 -> {
  id: "user_…", primary_email: "jane@example.com" | null,
  primary_email_verified: boolean, primary_email_auth_enabled: boolean,
  is_anonymous: boolean, is_restricted: boolean,
  restricted_reason: { type: "email_not_verified" | "anonymous" | "restricted_by_administrator" } | null,
  has_password: boolean, otp_auth_enabled: boolean, selected_team_id: string | null, …
}
// The action would then hand the boolean to an internalMutation that does the insert.
```

Build consequences: Build the gate purely from the token — do not add a server-side lookup, an action, or HEXCLAVE_SECRET_SERVER_KEY for this. Add `requireVerifiedUser` to `convex/lib/auth.ts` (shape in `shapes` above) and call it in place of `requireUser` at `convex/workspaces.ts:86` inside `ensureWorkspaceImpl`, so both `ensureWorkspace` and `bootstrap` are covered by one change; leave `requireUser` as-is for every other entry point so an unverified user can still read their own (non-existent) workspace and see the "verify your email" state instead of being hard-signed-out. Check `identity.emailVerified === true` with strict equality so a missing claim fails closed (the claim is `defined()` in the provider's token schema, so absence means a provider/config change, not a normal user) — that is the fallback, rather than a paid or keyed round trip. Also reject `identity.is_restricted === true` as cheap defence in depth. Pair it on the client with a non-authoritative banner driven by `useUser().primaryEmailVerified` plus `contactChannel.sendVerificationEmail({ callbackUrl })` in the onboarding wizard (`src/components/onboarding/OnboardingWizard.tsx:90-98` is where `ensureWorkspace` is called), so a password/OAuth user who hits FORBIDDEN gets a resend button instead of a dead end. Note for whoever writes the task: the gate only ever fires for password sign-ups and the rare OAuth account whose provider reports an unverified email — an OTP user is verified by construction — so the cheapest alternative, if the owner prefers, is to turn password sign-in off in the provider dashboard and keep OTP + Google only; that is a product decision, not a code one. Keep all repo wording provider-neutral (no upstream vendor names) per EXECUTION §0.

Still open:
- Not a blocker for T00: this probe is fully answered from source and official docs, and needs no key and no deployment access.
- Needs the owner's answer (dashboard-only, could not be read from the repo): is `onboarding.requireEmailVerification` on for the live project? It defaults to false. If it were turned on, unverified users would be issued restricted-issuer tokens that `convex/auth.config.ts` does not register, so they would appear signed out to Convex rather than blocked with a clear message — the app would then need a verify/onboarding page before any workspace flow.
- Needs the owner's decision: keep email+password sign-in enabled (the only realistic source of an unverified email), or restrict the project to OTP + Google, which would make PLAN §6's verified-email requirement true by construction.
- Unverified by design (read-only probe): no token was decoded and no request was made to the auth provider, so the claim list is from the installed token schema plus official docs, not from an observed live JWT. Confirm with one real dev-deployment identity dump when T01 lands.

## 6. Open tracking

SUPPORTED, with configuration — but NOT usable through the installed component as it stands. AgentMail does document an open event: `message.opened`, listed in the `event_types` enum of `POST /v0/webhooks` alongside 10 other types, with payload `{type:"event", event_type:"message.opened", event_id, open:{inbox_id, thread_id, message_id, timestamp}}`. To get it the sender must (a) subscribe the webhook to `message.opened`, (b) send with `track_opens: true` on `POST /v0/inboxes/{inbox_id}/messages/send`, (c) send an HTML body, and (d) send from a custom domain registered with `tracking_enabled: true` whose `link.<domain>` CNAME is published and verified — "must be published and verified before `track_opens` can be used on a send". It fires once per message on first open (no counts), one pixel per message not per recipient, and does not identify which recipient. The installed component `@agentmail/convex@0.1.0` does NOT pass it through: its `vEventType` union has only 7 literals and does not include `message.opened`, and its `events` table types `eventType: vEventType`, so `handleEvent`'s `ctx.db.insert("events", ...)` fails Convex schema validation, the mutation throws, `handleWebhook` throws, the HTTP action 500s and svix retries forever — the app-side `onEvent` callback is enqueued after that insert and never fires. Even if the row were stored, neither the component's `extractIndexFields` nor this repo's `extractEventIndexFields` reads the `open` sub-object, so inbox/message ids would be undefined and the repo's `onEvent` would drop the event at its guard. So PLAN §9.6 should keep the metric as conditional (the "dropped entirely" branch does not apply), but shipping it requires a component fork/patch plus a real verified tracking domain.

Findings:
- *(verified)* AgentMail documents exactly 11 webhook event types, including `message.opened`.
- *(verified)* `message.opened` requires `track_opens` on the send, a custom domain with tracking enabled, and an HTML body; it fires once per message on first open.
- *(verified)* `track_opens` is an optional boolean on the send endpoint this repo already calls.
- *(verified)* A custom domain must be registered with `tracking_enabled: true` and its `link.<domain>` CNAME verified before `track_opens` works at all.
- *(verified)* The installed component's event-type union omits `message.opened` (and the three `message.received.*` variants).
- *(likely)* Because the component's `events` table is typed with that union and Convex validates every insert by default, a `message.opened` webhook makes `handleEvent` throw — the webhook 500s and the app-side callback never runs.
- *(verified)* Neither the component nor this repo extracts ids from the `open` sub-object, so even a stored open event would carry no inbox/message reference.
- *(verified)* Consequently the repo's `onEvent` would silently drop a `message.opened` event (in the counterfactual where the component stored it).
- … 4 further findings are in the probe journal (not committed).

Shapes:
```ts
// Webhook subscription — POST https://api.agentmail.to/v0/webhooks
{
  url: string,                       // https://<deployment>.convex.site/agentmail/webhook
  event_types: Array<               // full list, not incremental
    | "message.received" | "message.received.spam" | "message.received.blocked"
    | "message.received.unauthenticated" | "message.sent" | "message.delivered"
    | "message.bounced" | "message.complained" | "message.rejected"
    | "message.opened" | "domain.verified"
  >,
  client_id?: string,
  headers?: Record<string, string>,  // write-only, never returned on read
  inbox_ids?: string[],              // max 10
  pod_ids?: string[],                // max 10
}
// 200 -> { webhook_id, url, secret /* REDACTED: svix whsec_… */, enabled, event_types, created_at, updated_at, ... }

// Send with tracking — POST /v0/inboxes/{inbox_id}/messages/send
{ to, subject?, text?, html /* required for opens */, cc?, bcc?, reply_to?,
  labels?, headers?, attachments?, track_opens?: boolean }
// 200 -> { message_id: string, thread_id: string }

// Open event delivered to the webhook (svix-signed)
{
  type: "event",
  event_type: "message.opened",
  event_id: "evt_901stu",
  open: {
    inbox_id:   "inbox_456def",
    thread_id:  "thd_789ghi",
    message_id: "<abc123@agentmail.to>",
    timestamp:  "2023-10-27T10:15:00Z"
  }
}
// NOTE: the id-bearing key is `open` — not `message`/`send`/`delivery`/`bounce`/`complaint`/`reject`,
// the only six keys both extractors currently look at.

// Domain prerequisite — POST /v0/domains
{ domain: "example.com", tracking_enabled: true, subdomains_enabled?, feedback_enabled?, allow_conflicting_provider? }
// 200 -> { domain_id, domain, status: "NOT_STARTED"|"PENDING"|"INVALID"|"FAILED"|"VERIFYING"|"VERIFIED",
//          tracking_enabled: true,
//          records: [{ type: "TXT"|"CNAME"|"MX", name, value, status: "MISSING"|"INVALID"|"VALID", priority?, reason? }, ...] }
//          -> includes a required CNAME at `link.<domain>` that must be VALID before track_opens works.

// Installed component's ceiling (node_modules/@agentmail/convex@0.1.0)
vEventType = "message.received" | "message.sent" | "message.delivered"
           | "message.bounced" | "message.complained" | "message.rejected"
           | "domain.verified"                       // 7 of the provider's 11
events table: { eventId, eventType: vEventType, inboxId?, threadId?, messageId?, receivedAt, raw }
```

Decision for PLAN §9.6: Keep PLAN §9.6's conditional metric — do NOT take the "dropped entirely" branch; the provider supports opens. But treat opens as a post-prerequisite feature and ship Contacted · Replied · Interested by default, with `workspaces.opensObserved` flipping on the first verified open exactly as §9.6 already specifies. Before any open can be recorded, four things must land: (1) the installed component must be fixed or bypassed — as shipped it hard-fails on `message.opened`; (2) `track_opens` must be added to `vSendRequestBody` in /Volumes/main/Code/opensquad/convex/integrations/agentmail.ts:92-109 and set on HTML sends; (3) `extractEventIndexFields` at agentmail.ts:600-619 must read `record.open` alongside the six existing keys; (4) the owner must own a custom domain, register it with `tracking_enabled: true`, and publish + verify the `link.<domain>` CNAME. For (1), the cheapest safe route is to subscribe the webhook ONLY to the 7 event types the component's union accepts (message.received, message.sent, message.delivered, message.bounced, message.complained, message.rejected, domain.verified) in T00's `POST /v0/webhooks` call — that also protects against the three `message.received.*` variants, which fail the same way. Opens then need either a vendored/patched component with `message.opened` added to `vEventType` and `open` added to `extractIndexFields`, or an app-owned second HTTP route that svix-verifies and routes open events straight to `onEvent` without touching the component's `events` table (the repo's own receipt tables already use `eventType: v.string()` and `event: v.any()`, so the app half needs no schema change). Fallback if none of that is affordable in the hackathon window: subscribe to the 7 safe types, ship without the Opened column, and note in plan/spikes.md that opens are provider-supported but gated on a tracking domain plus a component patch. Raise items (4) and the component patch to the user as T00 decisions — (4) needs a real domain and DNS access, which is exactly the "blocker / real key" case the run instructions say to stop on.

Still open:
- Installed @agentmail/convex@0.1.0 cannot accept `message.opened`: its `events.eventType` is typed with a 7-literal union (src/component/shared.ts:51-59, schema.ts:61-71) and Convex validates inserts by default, so `handleEvent` throws, /Volumes/main/Code/opensquad/convex/http.ts:24-36 returns 500, and svix retries the event forever. The same failure applies to `message.received.spam`, `message.received.blocked` and `message.received.unauthenticated` — this is a live hazard for T00's webhook registration even if opens are never used.
- Open tracking requires a custom domain registered with `tracking_enabled: true` whose `link.<domain>` CNAME is published and verified. That needs a real domain and DNS access from the owner. Nothing in the repo provisions domains or inboxes, so whether such a domain exists for this account is unverified — needs the user.
- Neither extractor reads the `open` sub-object (node_modules/@agentmail/convex/src/component/eventLogic.ts:39-46 and /Volumes/main/Code/opensquad/convex/integrations/agentmail.ts:600-619), so open events carry no inbox/message ref and are dropped at agentmail.ts:737-744.
- The repo's send body validator (/Volumes/main/Code/opensquad/convex/integrations/agentmail.ts:92-109) has no `track_opens` field, and the component's `vSendPayload` does not either — opens cannot be requested today.
- Data-quality caveat to carry into the UI copy: AgentMail's own docs call opens "a directional signal, not proof of reading" — image proxies and security scanners can register an open within seconds of delivery, image-blocking clients suppress them, there are no repeat-open counts, and a multi-recipient message fires once without naming who opened it.
- Not verified (out of probe scope): that AgentMail actually delivers `message.opened` in practice. Settling it needs a live test — register a webhook including `message.opened`, register a domain with `tracking_enabled: true` and verify its `link.<domain>` CNAME, send an HTML message with `track_opens: true` to a mailbox that loads remote images, and confirm a signed `message.opened` reaches the endpoint. That test writes to a deployment and uses a real key, so it is a user-go item.

## 7. `npx convex codegen`

Yes — on this project `npx convex codegen` talks to the dev deployment, and it is NOT a dry run by default. `runCodegen` (node_modules/convex/dist/cli.bundle.cjs:119773) unconditionally calls `startComponentsPushAndCodegen` for every non-`--system-udfs` invocation, which does a `pullConfig` round-trip (`getUnchangedModuleHashesFromServer`, :119934/:119842) and then POSTs the full bundled app + component definitions to `/api/deploy2/start_push` (:115693, :115699) with `dryRun: options.dryRun` — and codegen's `dryRun` comes only from the `--dry-run` flag, whose documented meaning is "Print out the generated configuration to stdout instead of writing to convex directory" (:124960). So a plain `npx convex codegen` sends `dryRun: false`. The round-trip is structural, not optional: the typed component API in `convex/_generated/api.d.ts` is built from `startPushResponse.analysis` (`doFinalComponentCodegen`, :119018, :119081), i.e. from the server evaluating `convex.config.js` in the Convex JS runtime — exactly what the docs mean by "Generating code can require communicating with a convex deployment in order to evaluate configuration files in the Convex JavaScript runtime." What codegen does NOT do is finish the push: `waitForSchema` and `finishPush` are called only from `runComponentsPush` (:120159, :120188), never from `runCodegen`, so the deployment never cuts over to the new code — matching the docs' "This doesn't modify the code running on the deployment." It is therefore "half a push": server-side side effects (module upload, index worker, schema-validation worker per Convex's own write-up) happen, but nothing goes live and the CLI never waits for or reads the validation result. Practically: codegen cannot fail because existing documents don't match the local schema, there is no offline flag for a component project, and a task agent in a git worktree cannot run it at all without `.env.local` (which is gitignored via `*.local` and untracked).

Findings:
- *(verified)* codegen always contacts the deployment (no components-only special case): runCodegen routes to startComponentsPushAndCodegen unless the hidden --system-udfs flag is passed.
- *(verified)* The network call is a real (non-dry-run) POST to /api/deploy2/start_push carrying the bundled app definition, all component definitions, the schema and every changed module.
- *(verified)* For codegen, `dryRun` is only the --dry-run CLI flag, which means "print generated files instead of writing them" — it is false on a plain `npx convex codegen`, so the start_push is sent as a non-dry-run push.
- *(verified)* codegen never finishes the push: wait_for_schema and finish_push are reached only from the runComponentsPush path used by `convex dev` / `convex deploy`.
- *(verified)* codegen cannot fail because the deployment holds documents that do not match the local schema — the only "Schema validation failed" crash lives in waitForSchema, which codegen never calls.
- *(verified)* The CLI also skips the pre-push index-deletion verification for codegen, with an in-source comment calling codegen read-only.
- *(likely)* Server side, start_push is not inert: it stores the uploaded modules and kicks off an index worker and a schema-validation worker against existing data. Only finishPush swaps the running code.
- *(verified)* Official docs confirm both halves: codegen may need the deployment, but does not change what the deployment runs.
- … 9 further findings are in the probe journal (not committed).

```
// What `npx convex codegen` sends, per cli.bundle.cjs:120010 and :114584
POST {deploymentUrl}/api/deploy2/start_push
Headers: Authorization: <adminKey>, Content-Type: application/json, Content-Encoding: br, traceparent
Body (brotli-compressed JSON):
{
  adminKey: string,
  dryRun: boolean,            // false on a plain `npx convex codegen`
  functions: string,          // "convex/"
  appDefinition: {
    ...appDefinitionSpecWithoutImpls,   // bundled convex/convex.config.ts
    schema: <bundled convex/schema.ts>,
    changedModules: Array<{ path, source, sourceMap?, environment: "isolate"|"node" }>,
    unchangedModuleHashes: Array<{ path, environment, sha256 }>,
    udfServerVersion: string
  },
  componentDefinitions: Array<{ definitionPath, ...spec, ...impl, udfServerVersion }>, // agentmail, firecrawl, static-hosting
  nodeDependencies: Array<{ name, version }>,
  nodeVersion?: string,
  forCodegen: boolean         // true only with --component-dir
}

// Response consumed to generate the typed component API (cli.bundle.cjs:114598)
StartPushResponse {
  environmentVariables: Record<string, string>,
  externalDepsId: string | null,
  componentDefinitionPackages: Record<ComponentDefinitionPath, SourcePackage>,
  appAuth: AuthInfo[],
  analysis: Record<ComponentDefinitionPath, EvaluatedComponentDefinition>, // -> _generated/api.d.ts
  app: CheckedComponent,
  schemaChange: { allocatedComponentIds: any, schemaIds: any, indexDiffs?: Record<path, IndexDiff> }
}

// NOT sent by codegen (only by `convex dev` / `convex deploy`):
//   POST /api/deploy2/wait_for_schema   <- the only place document/schema mismatch fails the CLI
//   POST /api/deploy2/finish_push       <- the only place the deployment starts running new code
//   POST /api/deploy2/evaluate_push     <- skipped: largeIndexDeletionCheck = "no verification"
```

Consequence for "Who may touch a deployment" (EXECUTION §0): Treat `npx convex codegen` as a deployment-touching command, not an offline one, and keep it in the integrator's hands only. Concretely: (a) Do NOT put `npx convex codegen` in a task agent's worktree loop. Each run uploads the whole bundle to the dev deployment and starts an index + schema-validation worker there; N agents running it concurrently, or one agent running it while `npx convex dev` is up, will hit RaceDetected / "Schema was overwritten by another push" (cli.bundle.cjs:65949) and can leave the dev deployment's pending schema churning. (b) Run codegen exactly once per wave, in the main checkout on `main`, after the merge — which is already what the user's post-wave checklist says ("merge, codegen, the four verify commands"). That is safe under the "dev Convex deployment only" rule: it hits the dev deployment named in CONVEX_DEPLOYMENT, and per the official docs and the absence of any finish_push call it never changes the code the deployment runs. No extra go-ahead from the user is needed for codegen against dev; it would need one only if CONVEX_DEPLOYMENT were ever pointed at prod. (c) Task agents in worktrees should typecheck against the committed `convex/_generated` (which is tracked in git) using `tsc --noEmit` / `pnpm build`, and let the integrator regenerate. If a task genuinely adds a component or changes the component graph and the agent must regenerate, give that worktree access to the deployment explicitly — symlink or copy `.env.local` into the worktree (it is gitignored via `*.local` and will otherwise be missing), or run `npx convex codegen --env-file /Volumes/main/Code/opensquad/.env.local`; the Convex account token is shared through `~/.convex/config.json` so no new key is required. (d) Expect codegen to fail for reasons unrelated to data: a TypeScript error in `convex/` (default `--typecheck try`), or a missing deployment env var — note `convex/convex.config.ts:8-13` declares `FIRECRAWL_API_KEY` as a required component env, so the dev deployment must have it set before codegen will succeed. It will not fail because existing dev documents don't match a new schema. (e) Fallback if codegen is blocked (no network, no deployment access): there is none for this project — `--system-udfs` is the only offline path and it regenerates a component-unaware API that would corrupt `convex/_generated`. In that case stop and use the committed generated files rather than regenerating.

Still open:
- Cannot verify from local source what the Convex backend persists during start_push — the backend is Rust and not vendored here. The claim that start_push stores modules and starts a schema-validation worker rests on Convex's own article (https://stack.convex.dev/what-actually-happens-when-you-push-to-convex), not on primary code. Marked 'likely'. What IS verified locally is that the CLI sends a non-dry-run start_push and never calls finish_push.
- Unverified: whether a start_push issued by codegen that fails server-side schema validation leaves any user-visible bad state on the dev deployment (e.g. a pending schema stuck in 'failed'). codegen never polls wait_for_schema, so the CLI exits 0 regardless; the deployment-side consequence could not be checked without running against the deployment, which this probe is forbidden to do.
- Unverified: exact behaviour of start_push when dryRun:true is sent (i.e. what `npx convex codegen --dry-run` does server-side). The flag is forwarded to the server but its server-side meaning is not observable from the CLI bundle.

## 8. Data census

Dev (read-only `npx convex data`, 2026-09-20): workspaces 31 · memberships 31 ·
suppressions 1 · prospects 40 (8 with a contact) · campaigns 30 ·
conversations 10 · drafts 5 · usageReservations 101 · businessProfiles 1.
All of it is seed/test data from the pre-pivot build. `_scheduled_functions`:
33 rows, all in state `success` (none pending) — 21 `workerOperations:sweepExpiredLeases`,
9 `inbox:applyInboundMessage`, 2 `quarantine:replayForInbox`, 1 `sending:sendApprovedDraft`.
Workspaces: `automationState` present on 31/31, `inboxRef` on 6/31.

Production: **not read.** The owner's standing instruction is that anything
against production needs an explicit go, and the path is already decided
(MIGRATION.md "Decision": clean slate, keep `workspaces`, `memberships`,
`suppressions`). The production census is taken at cutover time (T50) or
earlier on request.
