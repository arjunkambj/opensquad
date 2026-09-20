#!/usr/bin/env python3
"""Small CLI for the Enrich (enrich.so) API. Standard library only.

Reads the API key from ENRICH_API_KEY. Run with --help for commands.
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = os.environ.get("ENRICH_BASE_URL", "https://dev.enrich.so/api/v3")
FIELD_COST = {"email": 10, "personalEmail": 10, "phone": 525}
CSV_COLUMNS = [
    "id", "firstName", "lastName", "jobTitle", "jobLevel", "jobFunction",
    "companyName", "domain", "employeeCount", "city", "stateName",
    "countryName", "linkedinUrl",
]


def api(method, path, body=None, query=None, retries=4):
    key = os.environ.get("ENRICH_API_KEY")
    if not key:
        sys.exit("ENRICH_API_KEY is not set. Create a key at "
                 "https://dash.enrich.so/dashboard/api-keys and export it.")
    url = BASE_URL + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, method=method, headers={
            "x-api-key": key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            # Cloudflare in front of the API rejects the default Python-urllib agent.
            "User-Agent": "enrich-skill-cli/1.0",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.loads(res.read().decode() or "{}")
        except urllib.error.HTTPError as err:
            raw = err.read().decode(errors="replace")
            retryable = err.code == 429 or err.code >= 500
            if retryable and attempt < retries:
                wait = int(err.headers.get("Retry-After") or 0) or 2 ** attempt
                print(f"HTTP {err.code}, retrying in {wait}s...", file=sys.stderr)
                time.sleep(min(wait, 60))
                continue
            try:
                problem = json.loads(raw)
            except ValueError:
                problem = {"detail": raw}
            detail = (problem.get("detail") or problem.get("error")
                      or problem.get("message") or raw)
            sys.exit(f"Enrich API error {err.code}: {detail}")
        except urllib.error.URLError as err:
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
            sys.exit(f"Network error: {err.reason}")


def show(payload):
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    meta = payload.get("meta") or {}
    if "creditsUsed" in meta or "creditsRemaining" in meta:
        print(f"credits used: {meta.get('creditsUsed', '?')}, "
              f"remaining: {meta.get('creditsRemaining', '?')}", file=sys.stderr)


def load_filters(value):
    """Accept inline JSON or a path to a JSON file. Either a bare filters
    object or a full request body ({"filters": ...}) is fine."""
    text = open(value).read() if os.path.exists(value) else value
    try:
        parsed = json.loads(text)
    except ValueError as err:
        sys.exit(f"--filters is not valid JSON or a readable file: {err}")
    return parsed if "filters" in parsed else {"filters": parsed}


def cmd_balance(_):
    show(api("GET", "/wallets/balance"))


def cmd_verify(args):
    show(api("POST", "/email-validation", {"email": args.email}))


def cmd_find_email(args):
    show(api("POST", "/email-finder", {
        "firstName": args.first_name,
        "lastName": args.last_name,
        "domain": args.domain,
    }))


def cmd_lookup(args):
    show(api("POST", "/reverse-lookup/lookup", {"email": args.email}))


def cmd_count(args):
    show(api("POST", "/lead-finder/count", load_filters(args.filters)))


def cmd_search(args):
    if args.page > 3:
        print("Note: page 4+ costs 1 credit per result.", file=sys.stderr)
    body = load_filters(args.filters)
    body.update({"page": args.page, "pageSize": args.page_size})
    payload = api("POST", "/lead-finder/search", body)
    rows = (payload.get("data") or {}).get("results") or []
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
        pagination = (payload.get("data") or {}).get("pagination") or {}
        print(f"wrote {len(rows)} rows to {args.csv} "
              f"(total matches: {pagination.get('totalResults', '?')})")
    else:
        show(payload)


def cmd_reveal(args):
    fields = [f.strip() for f in args.fields.split(",") if f.strip()]
    unknown = [f for f in fields if f not in FIELD_COST]
    if unknown:
        sys.exit(f"Unknown field(s) {unknown}. Choose from {list(FIELD_COST)}.")
    if len(args.ids) > 25:
        sys.exit("Reveal accepts at most 25 leads per request.")
    cost = sum(FIELD_COST[f] for f in fields) * len(args.ids)
    print(f"Revealing {fields} for {len(args.ids)} lead(s): up to {cost} credits "
          "(cached or empty fields are not charged).", file=sys.stderr)
    if not args.yes and input("Proceed? [y/N] ").strip().lower() != "y":
        sys.exit("Cancelled.")
    submitted = api("POST", "/lead-finder/reveal", {
        "leads": [{"id": lead_id} for lead_id in args.ids],
        "fields": fields,
    })
    job_id = submitted["data"]["jobId"]
    deadline = time.time() + args.timeout
    while time.time() < deadline:
        job = api("GET", f"/lead-finder/reveal-jobs/{job_id}")
        status = job["data"].get("status")
        if status in ("completed", "failed"):
            show(job)
            if status == "failed":
                sys.exit(1)
            return
        time.sleep(2)
    sys.exit(f"Timed out. Check later: GET /lead-finder/reveal-jobs/{job_id}")


def main():
    parser = argparse.ArgumentParser(description="Enrich (enrich.so) API helper")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("balance", help="show credit balance (free)").set_defaults(fn=cmd_balance)

    p = sub.add_parser("verify", help="validate one email (1 credit)")
    p.add_argument("email")
    p.set_defaults(fn=cmd_verify)

    p = sub.add_parser("find-email", help="find a work email (10 credits if found)")
    p.add_argument("first_name")
    p.add_argument("last_name")
    p.add_argument("domain", help="company domain, e.g. stripe.com")
    p.set_defaults(fn=cmd_find_email)

    p = sub.add_parser("lookup", help="profile from an email (10 credits if found)")
    p.add_argument("email")
    p.set_defaults(fn=cmd_lookup)

    p = sub.add_parser("count", help="count leads matching filters (free)")
    p.add_argument("--filters", required=True, help="JSON string or path to JSON file")
    p.set_defaults(fn=cmd_count)

    p = sub.add_parser("search", help="search leads (pages 1-3 free)")
    p.add_argument("--filters", required=True, help="JSON string or path to JSON file")
    p.add_argument("--page", type=int, default=1)
    p.add_argument("--page-size", type=int, default=25)
    p.add_argument("--csv", help="write preview rows to this CSV file")
    p.set_defaults(fn=cmd_search)

    p = sub.add_parser("reveal", help="reveal contact info for lead ids and wait for the result")
    p.add_argument("ids", nargs="+", help="lead ids from search (enc_...)")
    p.add_argument("--fields", default="email",
                   help="comma list of email,phone,personalEmail (default: email)")
    p.add_argument("--yes", action="store_true", help="skip the cost confirmation")
    p.add_argument("--timeout", type=int, default=120)
    p.set_defaults(fn=cmd_reveal)

    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
