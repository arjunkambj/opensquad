# Enrich API reference

Base URL `https://dev.enrich.so/api/v3` · header `x-api-key: sk_...` · JSON bodies.
Source: https://doc.enrich.so (index: https://doc.enrich.so/llms.txt). Prices and limits change — confirm there for anything money-critical.

## Contents
1. Response envelope and errors
2. Email validation
3. Email finder
4. Reverse email lookup
5. Phone finder
6. Lead Finder (search, count, reveal, enrich, names, export, saved searches)
7. Domain search and employee finder
8. IP to company
9. Wallet
10. Batch jobs and webhooks
11. Plans, credits, rate limits

## 1. Envelope and errors

Success: `{ "success": true, "data": {...}, "meta": { "requestId", "creditsUsed", "creditsRemaining" } }`

Error (RFC 9457): `{ "type": "https://dev.enrich.so/errors/validation-error", "title", "status", "detail", "instance" }`. Some auth/rate errors return a simpler `{ "error": "..." }` or `{ "statusCode": 429, "message", "retryAfter" }`, so handle both shapes.

| Status | type | Notes |
|---|---|---|
| 400 | validation-error | bad body/params |
| 401 | unauthorized | key missing, not `sk_`, invalid, or disabled |
| 402 | insufficient-credits | extra fields `currentBalance`, `required`, `shortfall` |
| 403 | forbidden | account suspended, org missing, or endpoint needs approved access |
| 404 | not-found | |
| 429 | rate-limit-exceeded | honour `Retry-After` (seconds) |
| 500/502/503/504 | internal-error / upstream-failure / service-unavailable / timeout | retry with back-off |

## 2. Email validation — 1 credit

`POST /email-validation` body `{ "email" }`

Result fields: `email`, verdict (`result` in the schema, `status` in some guide examples: `valid` | `invalid` | `risky`), `message`, `isCatchAll`, `isFederated`, `hasSEG`, `segProvider`, `provider` (`GOOGLE` | `MICROSOFT` | `SMTP`), `confidence` (`definitive` | `high` | `medium` | `low` | `temporary` | `none`). Older examples also show `subStatus`, `freeEmail`, `disposable`, `catchAll`.

Batch: `POST /email-validation/batch` `{ "emails": [...up to 500,000], "webhookUrl"? }` → `GET /email-validation/batch/{batchId}` → `GET /email-validation/batch/{batchId}/results?page=&limit=`

## 3. Email finder — 10 credits, free when not found

`POST /email-finder` body `{ "firstName", "lastName", "domain" }` (all required)

Result: `found` (bool), `email`, `confidence` (`high`|`medium`|`low`), `isCatchAll`, `provider` (e.g. `GOOGLE`, `MICROSOFT`, `ZOHO`), `message`, plus the echoed inputs.

Batch: `POST /email-finder/batch` `{ "leads": [{firstName,lastName,domain}, ...up to 500,000], "webhookUrl"? }` → `GET /email-finder/batch/{batchId}` → `.../results`

## 4. Reverse email lookup — 10 credits, refunded when not found

`POST /reverse-lookup/lookup` body `{ "email" }` → `found`, `email`, `linkedinUrl`, `firstName`, `lastName`, `title`, `company` (plus richer profile fields such as work/education history when available). Cached 7 days.

Batch: `POST /reverse-lookup/bulk-lookup` `{ "emails": [...up to 100,000], "webhookUrl"? }` → `GET /reverse-lookup/bulk-lookup/{batchId}` → `.../results`

## 5. Phone finder — 500 credits, refunded when not found

`GET /reverse-lookup/phones?email=...` or `?linkedin=<profile url>` (one required) → `found`, `phones: [{ "number": "+14155551234", "type": "mobile" }]`

Batch: `POST /reverse-lookup/phones/bulk` `{ "emails"?: [], "linkedins"?: [], "webhookUrl"? }` (1–500,000 total) → `GET /reverse-lookup/phones/bulk/{jobId}` → `.../results`

## 6. Lead Finder

| Endpoint | Purpose | Cost |
|---|---|---|
| `POST /lead-finder/search` | `{ filters, excludeFilters?, page?, pageSize? }` → preview rows | pages 1–3 / 75 results free; then 1 credit per result; 50 free unique searches per month; max 40 pages |
| `POST /lead-finder/count` | `{ filters }` → total | free |
| `GET /lead-finder/filter-options` | allowed values per filter | free |
| `GET /lead-finder/suggest?q=strip&limit=10` | company name autocomplete | free |
| `POST /lead-finder/reveal` | `{ leads: [{id}] (1–25), fields? }` — `fields` defaults to `["email","phone"]` | email 10, phone 525, personalEmail 10 per lead |
| `POST /lead-finder/enrich` | same as reveal but `fields` is required | same |
| `GET /lead-finder/reveal-jobs/{jobId}` | poll every ~2 s | free |
| `GET /lead-finder/reveal-jobs?page=&limit=&status=` | recent jobs (30 days) | free |
| `POST /lead-finder/unlock-names` | `{ leads: [{id}] (1–100) }` → full last names | 1 per lead |
| `POST /lead-finder/export` | async CSV | see below |
| `GET/POST /lead-finder/saved`, `DELETE /lead-finder/saved/{id}` | saved searches | free |

Filters: see `lead-finder-filters.md`.

Reveal/enrich are async. Submit returns `{ jobId: "rj_...", status: "pending", totalLeads, fields }`. Poll result when `completed`:

```json
{ "jobId": "rj_...", "status": "completed", "jobType": "reveal", "fields": ["email"],
  "progress": { "processed": 5, "total": 5 },
  "results": {
    "revealed": [{ "id": "enc_...", "firstName": "Jane", "lastName": "Doe", "jobTitle": "VP Engineering",
                   "companyName": "Acme Corp", "emailAddress": "jane@acme.com", "phone": null, "cellphone": null }],
    "alreadyRevealed": 2, "newlyRevealed": 3, "creditsUsed": 30, "creditsRefunded": 0 } }
```

When `failed`, `data.error` explains (e.g. `Insufficient credits (balance: 100, required: 2875)`) — credits are charged inside the worker, so there is no synchronous 402. Fields with no data are refunded. A field your team revealed in the last 24 h is served from cache free; after that it is charged again.

CSV export: `POST /lead-finder/export` with `{ filters, maxResults? (default 1000, max 100,000), includeEmail?, includePhone?, includePersonalEmail?, includeNames?, includeContactInfo?, leadIds?, page?, pageSize?, name? }`. Preview-only export is free; `includeEmail` 10, `includePhone` 525, `includePersonalEmail` 10, `includeNames` 1 per lead; `includeContactInfo` = email + phone (535). Poll `GET /lead-finder/export-jobs/{jobId}`, then `GET /lead-finder/export-jobs/{jobId}/download` (returns `text/csv`).

## 7. Domain search and employee finder

`POST /domain-search/batch` — people at up to 10,000 domains. Bulk only (send one domain in the array for a single lookup).

| Field | Default | Notes |
|---|---|---|
| `domains` | — | URLs are normalised; bad ones come back in `invalidDomains` |
| `limitPerDomain` | 10 (max 100) | best-ranked first |
| `includeEmail` | `true` | +10 per lead that resolves |
| `includePhone` | `false` | +525 per lead that resolves |
| `strict` | `false` | only people whose own email is at the domain |
| `revalidate` | `true` | re-check stored addresses |
| `name`, `webhookUrl` | | |

Base cost 1 credit per lead. Reserved at worst case (`domains × limitPerDomain × rate`), settled on first results fetch, remainder refunded. Poll `GET /domain-search/batch/{batchId}`; results `GET /domain-search/batch/{batchId}/results?page=&limit=` are readable while still running; `total` counts leads, and the company block is sent once per domain.

`POST /people-search/employee-finder` — `{ company_linkedin_url (required), job_level?, job_function?, country?, continent?, sales_region?, max_results? (10, max 100), page? }`. 1 credit per result. Note the snake_case fields here.

`POST /people-search/waterfall-icp-search` — cascading ICP search at one company (tries the tightest persona first, then widens). See https://doc.enrich.so/cascading-icp-people-search-28537859e0.md.

## 8. IP to company — 100 credits

`POST /ip-to-company` `{ "ip": "8.8.8.8" }`; batch `POST /ip-to-company/batch` `{ "ips": [{ "ip" }] }`. Cached 7 days.

Company Followers endpoints (`/company-follower`, `/count-estimate`) require approved access — a 403 there means the account isn't approved, not a bug.

## 9. Wallet — free

`GET /wallets/balance` → `{ "balance": 10000 }` · `GET /wallets/transactions?page=&limit=&type=`

## 10. Batch jobs and webhooks

All batch endpoints work the same way:
1. **Submit** → `{ batchId, status: "queued", itemCount }`, `meta.creditsReserved`. The full worst-case cost is reserved immediately, so a big batch can fail with 402 even if most items would be free.
2. **Poll** the status URL every 5–10 s (free): `status`, `totalItems`, `processedItems`, `progress` (0–100).
3. **Results** `?page=1&limit=100` (max 1000). On the first fetch after a terminal status (`completed`/`failed`) credits settle: you pay only for successful items and the rest is refunded. Settlement is idempotent.

Pass `webhookUrl` to avoid polling. Enrich sends a per-result callback for each item and one batch-completion callback. Make the receiver idempotent and respond 2xx quickly; verify authenticity as described on the Webhooks pages of the docs before trusting a payload. A single batch submit counts as one request against rate limits, so batches are also the way to stay under them.

## 11. Plans, credits, rate limits

| Pack | Credits / month | Price |
|---|---|---|
| Free | 100 one-time | $0 |
| Growth | 100,000 | $49 |
| Scale | 500,000 | $149 |
| Pro | 2,500,000 | $499 |

Rough sense of scale on Growth: ~10,000 found emails, or ~190 phone numbers.

| Plan | Burst req/s | Sustained req/min |
|---|---|---|
| Free | 5 | 60 |
| Growth | 25 | 300 |
| Scale | 50 | 1,000 |
| Pro | 100 | 5,000 |
| Enterprise | 200 | 10,000 |

Bulk submits are tighter (Free: 1 req/s, 2 req/min; Growth 3 / 10; Scale 5 / 20; Pro 10 / 50). Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
