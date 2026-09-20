---
name: enrich
description: Use the Enrich (enrich.so) B2B data API to find leads, find and verify work emails, look up a person from an email, find phone numbers, and list people at a company domain. Use this skill whenever the user mentions Enrich, enrich.so, lead finding, prospecting, building a lead list, ICP search, finding someone's email, verifying or validating emails, reverse email lookup, contact enrichment, phone lookup, or wants to write code or run calls against the Enrich API — even if they just say "find me leads", "get emails for these people", or "clean this email list" without naming Enrich.
---

# Enrich (enrich.so)

Enrich is a credit-based REST API for B2B contact data. One API key, one base URL, JSON in and out. This skill covers the everyday jobs: find leads, get their emails, verify emails, and enrich a contact you already have.

## Setup

- **Base URL:** `https://dev.enrich.so/api/v3` (this is production, despite the `dev` hostname)
- **Auth:** header `x-api-key: sk_...` (or `Authorization: Bearer sk_...`)
- **Key:** created at https://dash.enrich.so/dashboard/api-keys — shown once. New accounts get 100 free credits.
- Read the key from the `ENRICH_API_KEY` environment variable. Never hardcode it, print it, or commit it; if the user pastes a key in chat, suggest they put it in an env var / `.env` that is gitignored. Never call the API from browser code — the key would be exposed; call from a server (in this repo, a Convex action or the worker).

Every success looks like `{ "success": true, "data": {...}, "meta": { "requestId", "creditsUsed", "creditsRemaining" } }`. Errors are RFC 9457 problem JSON with `type`, `title`, `status`, `detail`.

## Pick the right tool

| The user has / wants | Endpoint | Cost |
|---|---|---|
| A target profile (titles, industry, size, location) → list of people | `POST /lead-finder/search` | first 3 pages / 75 results free, then 1 credit per result |
| Just "how many match?" | `POST /lead-finder/count` | free |
| Emails/phones for leads from a search | `POST /lead-finder/reveal` (async) | email 10, personalEmail 10, phone 525 per lead |
| Name + company domain → work email | `POST /email-finder` | 10 (0 if not found) |
| An email → is it deliverable? | `POST /email-validation` | 1 |
| An email → who is this person? | `POST /reverse-lookup/lookup` | 10 (0 if not found) |
| Email or LinkedIn URL → phone | `GET /reverse-lookup/phones` | 500 (0 if not found) |
| Company domains → staff with emails | `POST /domain-search/batch` | 1 per lead, +10 email, +525 phone |
| Credit balance | `GET /wallets/balance` | free |

Every lookup also has a batch version for big lists — see `references/api-reference.md`.

## Spend credits carefully

Credits are the user's money, and phone data costs ~50x more than email. So:

1. Before anything that could cost more than ~100 credits, say the estimated cost and check the balance (`GET /wallets/balance`). Ask before spending on a large run.
2. Use the free steps first: `count` before `search`, stay within the free 3 pages while tuning filters.
3. Only request `phone` when the user explicitly asks for phone numbers. On `/lead-finder/reveal`, omitting `fields` defaults to `["email","phone"]` = 535 credits per lead, so **always pass `fields` explicitly** (usually `["email"]`).
4. Reveals are cached free per team for 24 hours; after that the same contact is charged again. Save results so you don't re-buy them.
5. Report `creditsUsed` / `creditsRemaining` back to the user after a run.

## Workflow 1: find leads and get their emails

This is the main flow. Search returns preview rows (masked last name, no email) with an `id` like `enc_abc123`; you then pay to reveal only the rows worth having.

1. **Translate the ICP into filters.** Most list-type filters are case-sensitive fixed values (`jobLevel`, `jobFunction`, `linkedinIndustry`, `revenueBuckets`, tech filters). Read `references/lead-finder-filters.md` for names and allowed values; when unsure about a value, call `GET /lead-finder/filter-options` rather than guessing — a wrong-case value silently matches nothing.
2. **Count** (free) and tune until the number is sensible. Zero results usually means a filter is too exact: `jobTitle` is exact match, so prefer `jobLevel` + `jobFunction`, or `personHeadline` (contains match) for keywords.
3. **Search** page 1–3 (free, 25 per page by default). Show the user a preview table: name, title, company, location, LinkedIn.
4. **Reveal** the chosen leads, max 25 per request, `fields: ["email"]`. It returns a `jobId`; poll `GET /lead-finder/reveal-jobs/{jobId}` every 2 seconds until `status` is `completed` or `failed`. A lack of credits shows up as a `failed` job, not a 402.
5. Optionally `POST /lead-finder/unlock-names` (1 credit per lead, max 100) if full last names are needed without revealing contact info.
6. For thousands of rows, use the async CSV export instead of paging (see reference).

```bash
# 1. free count
curl -s -X POST https://dev.enrich.so/api/v3/lead-finder/count \
  -H "Content-Type: application/json" -H "x-api-key: $ENRICH_API_KEY" \
  -d '{"filters":{"jobLevel":["VP","Director"],"jobFunction":["Engineering"],"countryName":["United States"],"employeeCountMin":50,"employeeCountMax":500}}'

# 2. search (same filters, pages 1-3 free)
curl -s -X POST https://dev.enrich.so/api/v3/lead-finder/search \
  -H "Content-Type: application/json" -H "x-api-key: $ENRICH_API_KEY" \
  -d '{"filters":{...same...},"page":1,"pageSize":25}'

# 3. reveal emails only, then poll
curl -s -X POST https://dev.enrich.so/api/v3/lead-finder/reveal \
  -H "Content-Type: application/json" -H "x-api-key: $ENRICH_API_KEY" \
  -d '{"leads":[{"id":"enc_abc123def456"}],"fields":["email"]}'
curl -s https://dev.enrich.so/api/v3/lead-finder/reveal-jobs/rj_xxx -H "x-api-key: $ENRICH_API_KEY"
```

Revealed rows come back under `data.results.revealed[]` with `emailAddress`, `phone`, `cellphone`.

## Workflow 2: find one person's email

Needs first name, last name and the **company domain** (`stripe.com`, not "Stripe" and not a URL). If the user only has a company name, find the domain first.

```bash
curl -s -X POST https://dev.enrich.so/api/v3/email-finder \
  -H "Content-Type: application/json" -H "x-api-key: $ENRICH_API_KEY" \
  -d '{"firstName":"Jane","lastName":"Doe","domain":"example.com"}'
```

Check `data.found`. When true you get `email`, `confidence` (`high`/`medium`/`low`), `isCatchAll`, `provider`. Not found = no charge. Treat `low` confidence or `isCatchAll: true` as unconfirmed and say so.

## Workflow 3: verify emails

```bash
curl -s -X POST https://dev.enrich.so/api/v3/email-validation \
  -H "Content-Type: application/json" -H "x-api-key: $ENRICH_API_KEY" \
  -d '{"email":"jane@example.com"}'
```

Verdict is `valid`, `invalid`, or `risky` (can't confirm — typically a catch-all domain). The docs show the verdict under `result` in the schema and `status` in the guide examples, so read whichever is present. Advice to give users: send to `valid`, drop `invalid`, send to `risky` only in small volumes. For a list, use `POST /email-validation/batch` (up to 500,000) rather than looping.

## Workflow 4: enrich a contact you already have

- Email → profile: `POST /reverse-lookup/lookup` with `{"email": "..."}` → name, title, company, LinkedIn. `data.found: false` is free.
- Email or LinkedIn → phone: `GET /reverse-lookup/phones?email=...` or `?linkedin=...` — 500 credits, confirm first.
- Domain → people there: `POST /domain-search/batch` with `{"domains":["stripe.com"],"limitPerDomain":10,"includeEmail":true,"includePhone":false}`. Bulk-only (send a batch of one for a single domain). Credits are reserved at the worst case and the unused part refunded when you fetch results.

## Helper script

`scripts/enrich.py` (Python 3, no dependencies) wraps the common calls and handles polling, 429 back-off and cost reporting. Prefer it for quick one-off tasks instead of hand-writing curl:

```bash
python3 .claude/skills/enrich/scripts/enrich.py balance
python3 .claude/skills/enrich/scripts/enrich.py verify jane@example.com
python3 .claude/skills/enrich/scripts/enrich.py find-email Jane Doe example.com
python3 .claude/skills/enrich/scripts/enrich.py lookup jane@example.com
python3 .claude/skills/enrich/scripts/enrich.py count  --filters '{"jobLevel":["VP"],"countryName":["India"]}'
python3 .claude/skills/enrich/scripts/enrich.py search --filters filters.json --page 1 --csv leads.csv
python3 .claude/skills/enrich/scripts/enrich.py reveal enc_abc123 enc_def456 --fields email
```

`reveal` prints the cost and asks for confirmation unless `--yes` is passed; only pass `--yes` after the user has agreed to the spend.

## Handling errors

| Status | Meaning | What to do |
|---|---|---|
| 400 | bad body / filter | read `detail`; usually a wrong field name or type |
| 401 | key missing, wrong, or disabled | check `ENRICH_API_KEY` starts with `sk_` |
| 402 | not enough credits | response includes `currentBalance`, `required`, `shortfall` — tell the user |
| 403 | account suspended, or endpoint needs approval (Company Followers) | not fixable in code. If the body mentions "browser's signature", it is Cloudflare rejecting a default HTTP-library user agent (Python urllib does this) — set an explicit `User-Agent` header |
| 429 | rate limited | wait `Retry-After` seconds, then retry. Free plan: 5 req/s, 60 req/min |
| 5xx | upstream/timeout | retry with exponential back-off |

## Writing integration code

Keep it a thin server-side wrapper: one function that adds the header, parses the envelope, throws on `success !== true` with the problem `detail`, and retries on 429/5xx. For lists, submit a batch job with a `webhookUrl` or poll every 5–10 s, then page results (`?page=&limit=`, max 1000). Bulk jobs reserve credits up front and settle on the first results fetch; settlement is idempotent.

## Responsible use

This is personal contact data. Use it for legitimate B2B outreach, remind users that cold email rules (CAN-SPAM, GDPR, etc.) and unsubscribe handling still apply, and don't help compile data on private individuals for non-business purposes.

## References

- `references/lead-finder-filters.md` — all search filters, match behaviour and allowed values. Read before building any Lead Finder query.
- `references/api-reference.md` — every endpoint with request/response shapes, batch + webhook flow, CSV export, plans, rate limits. Read when writing integration code or using batch endpoints.
- Official docs: https://doc.enrich.so (machine-readable index at https://doc.enrich.so/llms.txt; append `.md` to any page URL). Check there if something here looks out of date — pricing and limits change.
