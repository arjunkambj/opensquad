/**
 * OpenSquad ↔ Apollo boundary (P09 — company discovery and one-person
 * enrichment).
 *
 * WHY REST, NOT MCP TOOL NAMES. The live Apollo MCP `tools/list` was never
 * captured (owner skipped the E2E probe). This file is a Convex-side adapter
 * against Apollo's documented REST API — the same operations the MCP tools
 * wrap — not a guess at MCP tool names. Headless Convex actions cannot
 * complete browser OAuth; the documented server-side path is an API key in
 * `x-api-key`. Diagnostic MCP machinery in `worker/src/p04gate.ts` is
 * untouched.
 *
 * Closed allowlist — the only paths this file may call, relative to
 * `APOLLO_BASE_URL` (default `https://api.apollo.io/api/v1`):
 *
 *   POST /mixed_companies/search   company discovery (1 credit/page)
 *   POST /mixed_people/api_search  people search (0 credits; no emails)
 *   POST /people/match             ONE person enrichment (credits; emails)
 *
 * NEVER called or exposed: email send, sequences, enrollment, tasks, contact
 * writes, personal-email reveal, phone reveal, waterfall enrichment, bulk
 * enrichment, any unknown path. `/people/match` always sends
 * `reveal_personal_emails=false` and `reveal_phone_number=false`. Never
 * `webhook_url`.
 *
 * Visibility: every export is internal — unreachable from clients and public
 * HTTP. The sales workflow is the only caller.
 */

import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  type ActionCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  CAMPAIGN_LEAD_LIMIT_MAX,
  PROSPECT_COMPANY_NAME_MAX_LENGTH,
  PROSPECT_FIT_REASON_MAX_LENGTH,
  PROSPECT_IMPORT_CANDIDATES_MAX,
  PROVIDER_OPERATION_RUN_HISTORY_MAX,
  PROVIDER_RECORD_ID_MAX_LENGTH,
  SOURCE_MAX_RESULTS_MAX,
  boundedString,
  computeResultDigest,
  domainError,
  invalid,
  normalizeCanonicalDomain,
  normalizeHttpUrl,
  receiptNamesRun,
  sha256Hex,
  unwrapConvexErrorText,
  vProspectCandidate,
  vProspectContact,
  vProviderOperationState,
  vUsageMetric,
} from "../lib/validators";
import type {
  ProspectCandidate,
  ProspectContact,
  ProviderEmailStatus,
  ProviderOperationState,
} from "../lib/validators";

const APOLLO_DEFAULT_BASE_URL = "https://api.apollo.io/api/v1";
const APOLLO_REQUEST_TIMEOUT_MS = 30_000;
const APOLLO_TIMEOUT_MARKER = "opensquad.apollo.request_timeout";
const PROVIDER_ERROR_BODY_LIMIT = 1024;
const APOLLO_COMPANY_SEARCH_LIMIT = 5;
const PEOPLE_SEARCH_PER_PAGE = 5;
const OPERATION_KEY_MAX = 200;

/** The only REST paths this adapter may request. A fetch helper throws on
 *  anything else, including unknown suffixes of an allowed prefix. */
const APOLLO_ALLOWED_PATHS = new Set([
  "/mixed_companies/search",
  "/mixed_people/api_search",
  "/people/match",
]);

type ApolloAllowedPath = "/mixed_companies/search" | "/mixed_people/api_search" | "/people/match";

const DEFAULT_PERSON_TITLES = [
  "founder",
  "owner",
  "chief executive",
  "head of marketing",
  "marketing director",
  "growth",
  "partnerships",
] as const;

const PREFERRED_TITLE_RE =
  /\b(founder|co-founder|owner|ceo|chief executive|marketing|growth|partnerships)\b/i;

const vProviderOperationError = v.object({
  code: v.string(),
  message: v.string(),
});

const vSanitizedPerson = v.object({
  id: v.string(),
  name: v.string(),
  title: v.optional(v.string()),
  domain: v.optional(v.string()),
});

type SanitizedPerson = Infer<typeof vSanitizedPerson>;

const vSanitizedApolloResult = v.object({
  candidates: v.optional(v.array(vProspectCandidate)),
  contact: v.optional(vProspectContact),
  people: v.optional(v.array(vSanitizedPerson)),
});

type SanitizedApolloResult = Infer<typeof vSanitizedApolloResult>;

const vSearchCompaniesResult = v.union(
  v.object({
    action: v.literal("skipped"),
    reason: v.string(),
    candidates: v.array(vProspectCandidate),
  }),
  v.object({
    action: v.literal("unavailable"),
    reason: v.string(),
    candidates: v.array(vProspectCandidate),
  }),
  v.object({
    action: v.literal("done"),
    candidates: v.array(vProspectCandidate),
    replayed: v.boolean(),
    summary: v.string(),
  }),
);

type SearchCompaniesResult = Infer<typeof vSearchCompaniesResult>;

const vEnrichContactResult = v.union(
  v.object({
    action: v.literal("ready"),
    contact: vProspectContact,
    prospectId: v.id("prospects"),
    expectedVersion: v.number(),
  }),
  v.object({
    action: v.literal("no_address"),
    contact: v.optional(vProspectContact),
    reason: v.string(),
    prospectId: v.id("prospects"),
    expectedVersion: v.number(),
  }),
  v.object({
    action: v.literal("skipped"),
    reason: v.string(),
  }),
  v.object({
    action: v.literal("unavailable"),
    reason: v.string(),
  }),
);

type EnrichContactResult = Infer<typeof vEnrichContactResult>;

const vBeginApolloOperationResult = v.union(
  v.object({
    decision: v.literal("execute"),
    providerOperationId: v.id("providerOperations"),
  }),
  v.object({
    decision: v.literal("replay"),
    providerOperationId: v.id("providerOperations"),
    state: vProviderOperationState,
    result: v.optional(vSanitizedApolloResult),
    error: v.optional(vProviderOperationError),
  }),
);

type BeginApolloOperationResult = Infer<typeof vBeginApolloOperationResult>;

const vPrepareCompanySearchResult = v.union(
  v.object({ action: v.literal("skipped"), reason: v.string() }),
  v.object({ action: v.literal("unavailable"), reason: v.string() }),
  v.object({
    action: v.literal("ready"),
    workspaceId: v.id("workspaces"),
    campaignId: v.id("campaigns"),
    perPage: v.number(),
    locations: v.array(v.string()),
    categories: v.array(v.string()),
    employeeRanges: v.array(v.string()),
    filterDigest: v.string(),
  }),
);

type PrepareCompanySearchResult = Infer<typeof vPrepareCompanySearchResult>;

const vPrepareContactEnrichmentResult = v.union(
  v.object({ action: v.literal("skipped"), reason: v.string() }),
  v.object({ action: v.literal("unavailable"), reason: v.string() }),
  v.object({
    action: v.literal("proceed"),
    prospectId: v.id("prospects"),
    expectedVersion: v.number(),
    canonicalDomain: v.string(),
    companyName: v.string(),
    apolloProviderRecordId: v.optional(v.string()),
    campaignId: v.id("campaigns"),
    workspaceId: v.id("workspaces"),
    missionId: v.id("missions"),
    enrichmentLimit: v.number(),
  }),
);

type PrepareContactEnrichmentResult = Infer<
  typeof vPrepareContactEnrichmentResult
>;

/* ------------------------------------------------------------------ */
/* Small shared helpers                                                */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function idField(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function arrayField(
  record: Record<string, unknown> | null,
  key: string,
): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

function refusalMessage(error: unknown): string {
  const data =
    typeof error === "object" && error !== null
      ? (error as { data?: { message?: unknown } }).data
      : undefined;
  if (data !== undefined && typeof data.message === "string") {
    return data.message.slice(0, 500);
  }
  const raw = error instanceof Error ? error.message : String(error);
  return unwrapConvexErrorText(raw).slice(0, 500);
}

function truncateResponseBody(text: string): string {
  return text.length > PROVIDER_ERROR_BODY_LIMIT
    ? `${text.slice(0, PROVIDER_ERROR_BODY_LIMIT)}…[truncated]`
    : text;
}

function apolloApiKey(): string | undefined {
  const key = process.env.APOLLO_API_KEY;
  if (key === undefined) return undefined;
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function apolloBaseUrl(): string {
  const raw = (process.env.APOLLO_BASE_URL ?? APOLLO_DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("APOLLO_BASE_URL is not a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("APOLLO_BASE_URL must use http or https");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("APOLLO_BASE_URL must not contain credentials");
  }
  return raw;
}

async function boundOperationKey(key: string): Promise<string> {
  if (key.length <= OPERATION_KEY_MAX) return key;
  return `apollo:${await sha256Hex(key)}`;
}

function asHttpUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return normalizeHttpUrl(withScheme, "url");
  } catch {
    return undefined;
  }
}

function tryCanonicalDomain(raw: string): string | undefined {
  try {
    return normalizeCanonicalDomain(raw);
  } catch {
    return undefined;
  }
}

function emptySearch(
  action: "skipped" | "unavailable",
  reason: string,
): SearchCompaniesResult {
  return { action, reason, candidates: [] };
}

/* ------------------------------------------------------------------ */
/* Closed-allowlist fetch                                              */
/* ------------------------------------------------------------------ */

type ApolloQueryValue = string | number | boolean | ReadonlyArray<string>;

type ApolloFetchOk = {
  outcome: "ok";
  status: number;
  body: unknown;
};

type ApolloFetchFailure = {
  outcome: "failure";
  settlement: "release" | "markUncertain";
  state: ProviderOperationState;
  code: string;
  message: string;
  status?: number;
};

type ApolloFetchResult = ApolloFetchOk | ApolloFetchFailure;

/**
 * Exactly one POST to an allow-listed Apollo path. Query-string params are
 * Apollo's documented style; the JSON body carries the same fields. The
 * helper refuses an unknown path before any network I/O.
 */
async function apolloPost(
  path: ApolloAllowedPath,
  params: Record<string, ApolloQueryValue>,
): Promise<ApolloFetchResult> {
  if (!APOLLO_ALLOWED_PATHS.has(path)) {
    throw new Error(`apollo path is not allow-listed: ${path}`);
  }
  const apiKey = apolloApiKey();
  if (apiKey === undefined) {
    return {
      outcome: "failure",
      settlement: "release",
      state: "failed",
      code: "apollo_missing_api_key",
      message: "APOLLO_API_KEY is not set on this Convex deployment",
    };
  }

  const body: Record<string, unknown> = {};
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "webhook_url") {
      throw new Error("webhook_url is not allowed on Apollo requests");
    }
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      body[key] = [...value];
      for (const entry of value) {
        search.append(`${key}[]`, entry);
      }
      continue;
    }
    body[key] = value;
    search.set(key, String(value));
  }

  if (path === "/people/match") {
    body.reveal_personal_emails = false;
    body.reveal_phone_number = false;
    search.set("reveal_personal_emails", "false");
    search.set("reveal_phone_number", "false");
    search.delete("webhook_url");
    delete body.webhook_url;
  }

  let baseUrl: string;
  try {
    baseUrl = apolloBaseUrl();
  } catch (error) {
    return {
      outcome: "failure",
      settlement: "release",
      state: "failed",
      code: "apollo_misconfigured",
      message:
        error instanceof Error
          ? error.message.slice(0, 500)
          : "APOLLO_BASE_URL is not usable",
    };
  }
  const query = search.toString();
  const url = `${baseUrl}${path}${query.length > 0 ? `?${query}` : ""}`;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(APOLLO_TIMEOUT_MARKER)),
    APOLLO_REQUEST_TIMEOUT_MS,
  );
  let response: Response | undefined;
  let responseText = "";
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    responseText = await response.text();
  } catch (error) {
    const isTimeout = controller.signal.aborted;
    // No HTTP response means the request never reached Apollo as far as we
    // can prove; a response whose body then failed to read is uncertain.
    if (response === undefined) {
      return {
        outcome: "failure",
        settlement: "release",
        state: "failed",
        code: isTimeout ? "apollo_timeout" : "apollo_transport_error",
        message:
          error instanceof Error
            ? `${error.name}: ${error.message}`.slice(0, 500)
            : String(error).slice(0, 500),
      };
    }
    return {
      outcome: "failure",
      settlement: "markUncertain",
      state: "uncertain",
      code: isTimeout ? "apollo_timeout" : "apollo_transport_error",
      message:
        error instanceof Error
          ? `${error.name}: ${error.message}`.slice(0, 500)
          : String(error).slice(0, 500),
      status: response.status,
    };
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 200 && response.status < 300) {
    let parsed: unknown = null;
    if (responseText.length > 0) {
      try {
        parsed = JSON.parse(responseText);
      } catch {
        // 2xx was billed (company search is per page; match is per person)
        // even when the body is unusable. The caller commits an empty result.
        return { outcome: "ok", status: response.status, body: null };
      }
    }
    return { outcome: "ok", status: response.status, body: parsed };
  }

  return classifyApolloHttpFailure(response.status, responseText);
}

function classifyApolloHttpFailure(
  status: number,
  bodyText: string,
): ApolloFetchFailure {
  const message = truncateResponseBody(bodyText);
  // 401 is unauthenticated: Apollo refused the key before performing a
  // search. That is the one billed-endpoint failure we can prove was not a
  // search. Anything else that left Convex and got an HTTP status may have
  // been metered, so it stays uncertain.
  if (status === 401) {
    return {
      outcome: "failure",
      settlement: "release",
      state: "failed",
      code: "apollo_unauthorized",
      message: message.slice(0, 500),
      status,
    };
  }
  return {
    outcome: "failure",
    settlement: "markUncertain",
    state: "uncertain",
    code: status >= 500 ? "apollo_http_5xx" : "apollo_http_error",
    message: message.slice(0, 500),
    status,
  };
}

/* ------------------------------------------------------------------ */
/* Mapping — never phones, never personal emails, never a guessed addr */
/* ------------------------------------------------------------------ */

function organizationRecords(body: unknown): Record<string, unknown>[] {
  const record = asRecord(body);
  const raw = [
    ...arrayField(record, "organizations"),
    ...arrayField(record, "accounts"),
  ];
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const org = asRecord(entry);
    if (org === null) continue;
    const id = idField(org, "id") ?? stringField(org, "primary_domain") ?? "";
    const key = id.length > 0 ? id : canonicalJsonFallback(org);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(org);
  }
  return out;
}

function canonicalJsonFallback(org: Record<string, unknown>): string {
  const name = stringField(org, "name") ?? "";
  const domain = stringField(org, "primary_domain") ?? "";
  return `${name}:${domain}`;
}

function mapOrganizationsToCandidates(
  body: unknown,
  fitReason: string,
  retrievedAt: number,
): ProspectCandidate[] {
  const candidates: ProspectCandidate[] = [];
  for (const org of organizationRecords(body)) {
    if (candidates.length >= PROSPECT_IMPORT_CANDIDATES_MAX) break;
    const mapped = mapOrganization(org, fitReason, retrievedAt);
    if (mapped !== null) candidates.push(mapped);
  }
  return candidates;
}

function mapOrganization(
  org: Record<string, unknown>,
  fitReason: string,
  retrievedAt: number,
): ProspectCandidate | null {
  const primaryDomain = stringField(org, "primary_domain");
  const websiteUrlRaw = stringField(org, "website_url");
  const websiteUrl =
    (primaryDomain !== undefined ? asHttpUrl(primaryDomain) : undefined) ??
    (websiteUrlRaw !== undefined ? asHttpUrl(websiteUrlRaw) : undefined);
  if (websiteUrl === undefined) return null;
  const companyName = stringField(org, "name");
  if (companyName === undefined) return null;
  if (companyName.length > PROSPECT_COMPANY_NAME_MAX_LENGTH) return null;
  const linkedin = stringField(org, "linkedin_url");
  const profileUrl =
    (linkedin !== undefined ? asHttpUrl(linkedin) : undefined) ??
    (websiteUrlRaw !== undefined ? asHttpUrl(websiteUrlRaw) : undefined) ??
    websiteUrl;
  const providerRecordId = idField(org, "id");
  try {
    boundedString(companyName, "companyName", {
      min: 1,
      max: PROSPECT_COMPANY_NAME_MAX_LENGTH,
    });
  } catch {
    return null;
  }
  return {
    companyName,
    websiteUrl,
    sourceRefs: [
      {
        source: "apollo",
        profileUrl,
        ...(providerRecordId !== undefined &&
        providerRecordId.length <= PROVIDER_RECORD_ID_MAX_LENGTH
          ? { providerRecordId }
          : {}),
        retrievedAt,
      },
    ],
    fitReason: fitReason.slice(0, PROSPECT_FIT_REASON_MAX_LENGTH),
  };
}

function fitReasonFromFilters(args: {
  locations: string[];
  categories: string[];
  employeeRanges: string[];
}): string {
  const parts: string[] = [];
  if (args.locations.length > 0) {
    parts.push(`location ${args.locations.join(", ")}`);
  }
  if (args.categories.length > 0) {
    parts.push(`category ${args.categories.join(", ")}`);
  }
  if (args.employeeRanges.length > 0) {
    parts.push(`headcount ${args.employeeRanges.join(", ")}`);
  }
  if (parts.length === 0) {
    return "Apollo company search returned this organization against the confirmed campaign filters.";
  }
  return `Apollo company search matched ${parts.join("; ")}.`;
}

function peopleRecords(body: unknown): Record<string, unknown>[] {
  const record = asRecord(body);
  const raw = [
    ...arrayField(record, "people"),
    ...arrayField(record, "contacts"),
  ];
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const person = asRecord(entry);
    if (person === null) continue;
    const id = idField(person, "id") ?? personName(person) ?? "";
    if (id.length > 0 && seen.has(id)) continue;
    if (id.length > 0) seen.add(id);
    out.push(person);
  }
  return out;
}

function personOrganization(
  person: Record<string, unknown>,
): Record<string, unknown> | null {
  return (
    asRecord(person.organization) ??
    asRecord(person.account) ??
    asRecord(arrayField(person, "organizations")[0])
  );
}

function personDomain(person: Record<string, unknown>): string | undefined {
  const org = personOrganization(person);
  const raw =
    stringField(org, "primary_domain") ??
    stringField(org, "website_url") ??
    stringField(person, "organization_domain") ??
    stringField(person, "organization_website_url");
  return raw === undefined ? undefined : tryCanonicalDomain(raw);
}

function personName(person: Record<string, unknown>): string | undefined {
  const combined = stringField(person, "name");
  if (combined !== undefined) return combined;
  const first = stringField(person, "first_name");
  const last = stringField(person, "last_name");
  const joined = [first, last].filter((part) => part !== undefined).join(" ");
  return joined.length > 0 ? joined : undefined;
}

function personTitle(person: Record<string, unknown>): string | undefined {
  return stringField(person, "title") ?? stringField(person, "headline");
}

function titleScore(title: string | undefined): number {
  if (title === undefined) return 0;
  return PREFERRED_TITLE_RE.test(title) ? 2 : 1;
}

function sanitizePerson(person: Record<string, unknown>): SanitizedPerson | null {
  const id = idField(person, "id");
  const name = personName(person);
  if (id === undefined || name === undefined) return null;
  if (id.length > PROVIDER_RECORD_ID_MAX_LENGTH) return null;
  const title = personTitle(person);
  const domain = personDomain(person);
  return {
    id,
    name: name.slice(0, 200),
    ...(title !== undefined ? { title: title.slice(0, 200) } : {}),
    ...(domain !== undefined ? { domain } : {}),
  };
}

function pickMatchingPerson(
  people: SanitizedPerson[],
  canonicalDomain: string,
): SanitizedPerson | undefined {
  // The people search already filtered by this domain. A missing domain on
  // the person record is not a different company — drop only an explicit
  // mismatch so a result that omitted organization.primary_domain is not
  // discarded.
  const matched = people.filter(
    (person) =>
      person.domain === undefined || person.domain === canonicalDomain,
  );
  if (matched.length === 0) return undefined;
  let best = matched[0];
  let bestScore = titleScore(best.title);
  for (const person of matched.slice(1)) {
    const score = titleScore(person.title);
    if (score > bestScore) {
      best = person;
      bestScore = score;
    }
  }
  return best;
}

function matchPersonRecord(body: unknown): Record<string, unknown> | null {
  const record = asRecord(body);
  if (record === null) return null;
  const nested = asRecord(record.person);
  if (nested !== null) return nested;
  const people = peopleRecords(body);
  if (people.length > 0) return people[0];
  if (idField(record, "id") !== undefined || stringField(record, "email") !== undefined) {
    return record;
  }
  return null;
}

function mapEmailStatus(
  status: string | undefined,
  hasEmail: boolean,
): ProviderEmailStatus {
  const normalized = status?.trim().toLowerCase();
  if (!hasEmail) {
    if (
      normalized === "unavailable" ||
      normalized === "unavailable_email" ||
      normalized === "verified" ||
      normalized === "extrapolated" ||
      normalized === "guessed" ||
      normalized === undefined
    ) {
      return "unavailable";
    }
    return "unknown";
  }
  if (normalized === "verified") return "verified";
  if (normalized === "extrapolated" || normalized === "guessed") return "guessed";
  // An address plus "unavailable" is a contradiction `assertProspectContact`
  // would refuse; keep the address and call the status unknown.
  return "unknown";
}

function mapPersonToContact(
  person: Record<string, unknown>,
  fallback: SanitizedPerson,
  canonicalDomain: string,
  retrievedAt: number,
): ProspectContact {
  const id = idField(person, "id") ?? fallback.id;
  const name = personName(person) ?? fallback.name;
  const role = personTitle(person) ?? fallback.title;
  // Work email only. `personal_emails` is ignored even if present.
  const emailRaw = stringField(person, "email");
  const email = emailRaw !== undefined && emailRaw.includes("@") ? emailRaw : undefined;
  const statusRaw = stringField(person, "email_status");
  const providerEmailStatus = mapEmailStatus(statusRaw, email !== undefined);
  const hasAddress = email !== undefined;
  const selectionReason = hasAddress
    ? `Apollo matched ${role ?? "a business person"} at ${canonicalDomain}`
    : `Apollo returned no business address for ${name} at ${canonicalDomain}`;
  return {
    source: "apollo",
    providerRef: id.slice(0, PROVIDER_RECORD_ID_MAX_LENGTH),
    fullName: name.slice(0, 200),
    ...(role !== undefined ? { role: role.slice(0, 200) } : {}),
    ...(email !== undefined ? { email } : {}),
    providerEmailStatus,
    retrievedAt,
    selectionReason: selectionReason.slice(0, 500),
  };
}

function storedResultFromRow(
  value: unknown,
): SanitizedApolloResult | undefined {
  const record = asRecord(value);
  if (record === null) return undefined;
  const result: SanitizedApolloResult = {};
  const candidatesRaw = record.candidates;
  if (Array.isArray(candidatesRaw)) {
    const candidates: ProspectCandidate[] = [];
    for (const entry of candidatesRaw) {
      const candidate = asRecord(entry);
      if (candidate === null) continue;
      const companyName = stringField(candidate, "companyName");
      const websiteUrl = stringField(candidate, "websiteUrl");
      if (companyName === undefined || websiteUrl === undefined) continue;
      const sourceRefsRaw = arrayField(candidate, "sourceRefs");
      const sourceRefs: ProspectCandidate["sourceRefs"] = [];
      for (const refEntry of sourceRefsRaw) {
        const ref = asRecord(refEntry);
        if (ref === null) continue;
        if (ref.source !== "apollo" && ref.source !== "yc" && ref.source !== "trustmrr") {
          continue;
        }
        const profileUrl = stringField(ref, "profileUrl");
        const retrievedAt = ref.retrievedAt;
        if (profileUrl === undefined || typeof retrievedAt !== "number") continue;
        sourceRefs.push({
          source: ref.source,
          profileUrl,
          retrievedAt,
          ...(typeof ref.providerRecordId === "string"
            ? { providerRecordId: ref.providerRecordId }
            : {}),
        });
      }
      if (sourceRefs.length === 0) continue;
      candidates.push({
        companyName,
        websiteUrl,
        sourceRefs,
        ...(typeof candidate.fitReason === "string"
          ? { fitReason: candidate.fitReason }
          : {}),
      });
    }
    if (candidates.length > 0) result.candidates = candidates;
  }
  const contactRaw = asRecord(record.contact);
  if (contactRaw !== null) {
    const contact = parseStoredContact(contactRaw);
    if (contact !== undefined) result.contact = contact;
  }
  const peopleRaw = record.people;
  if (Array.isArray(peopleRaw)) {
    const people: SanitizedPerson[] = [];
    for (const entry of peopleRaw) {
      const person = asRecord(entry);
      if (person === null) continue;
      const id = idField(person, "id");
      const name = stringField(person, "name");
      if (id === undefined || name === undefined) continue;
      people.push({
        id,
        name,
        ...(typeof person.title === "string" ? { title: person.title } : {}),
        ...(typeof person.domain === "string" ? { domain: person.domain } : {}),
      });
    }
    result.people = people;
  }
  if (
    result.candidates === undefined &&
    result.contact === undefined &&
    result.people === undefined
  ) {
    return undefined;
  }
  return result;
}

function parseStoredContact(
  record: Record<string, unknown>,
): ProspectContact | undefined {
  const source = record.source;
  if (source !== "apollo" && source !== "yc" && source !== "trustmrr") {
    return undefined;
  }
  const providerRef = stringField(record, "providerRef");
  const fullName = stringField(record, "fullName");
  const retrievedAt = record.retrievedAt;
  const selectionReason = stringField(record, "selectionReason");
  const status = record.providerEmailStatus;
  if (
    providerRef === undefined ||
    fullName === undefined ||
    typeof retrievedAt !== "number" ||
    selectionReason === undefined
  ) {
    return undefined;
  }
  if (
    status !== "verified" &&
    status !== "guessed" &&
    status !== "unavailable" &&
    status !== "unknown"
  ) {
    return undefined;
  }
  const email = stringField(record, "email");
  if (email === undefined && status === "verified") return undefined;
  return {
    source,
    providerRef,
    fullName,
    retrievedAt,
    selectionReason,
    providerEmailStatus: status,
    ...(typeof record.role === "string" ? { role: record.role } : {}),
    ...(email !== undefined ? { email } : {}),
  };
}

function sanitizeStoredResult(result: SanitizedApolloResult): SanitizedApolloResult {
  // Explicit reconstruction so a future field cannot leak phones or personal
  // emails into providerOperations.resultRef.
  return {
    ...(result.candidates !== undefined
      ? {
          candidates: result.candidates.map((candidate) => ({
            companyName: candidate.companyName,
            websiteUrl: candidate.websiteUrl,
            sourceRefs: candidate.sourceRefs.map((ref) => ({
              source: ref.source,
              profileUrl: ref.profileUrl,
              retrievedAt: ref.retrievedAt,
              ...(ref.providerRecordId !== undefined
                ? { providerRecordId: ref.providerRecordId }
                : {}),
            })),
            ...(candidate.fitReason !== undefined
              ? { fitReason: candidate.fitReason }
              : {}),
          })),
        }
      : {}),
    ...(result.contact !== undefined
      ? {
          contact: {
            source: result.contact.source,
            providerRef: result.contact.providerRef,
            fullName: result.contact.fullName,
            providerEmailStatus: result.contact.providerEmailStatus,
            retrievedAt: result.contact.retrievedAt,
            selectionReason: result.contact.selectionReason,
            ...(result.contact.role !== undefined
              ? { role: result.contact.role }
              : {}),
            ...(result.contact.email !== undefined
              ? { email: result.contact.email }
              : {}),
          },
        }
      : {}),
    ...(result.people !== undefined
      ? {
          people: result.people.map((person) => ({
            id: person.id,
            name: person.name,
            ...(person.title !== undefined ? { title: person.title } : {}),
            ...(person.domain !== undefined ? { domain: person.domain } : {}),
          })),
        }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Reservations                                                        */
/* ------------------------------------------------------------------ */

export const beginApolloOperation = internalMutation({
  args: {
    missionId: v.id("missions"),
    operationKey: v.string(),
    requestDigest: v.string(),
    metric: v.optional(vUsageMetric),
    scopeKey: v.optional(v.string()),
    periodKey: v.optional(v.string()),
    limit: v.optional(v.number()),
    quantity: v.optional(v.number()),
    prospectId: v.optional(v.id("prospects")),
    runId: v.optional(v.id("runs")),
  },
  returns: vBeginApolloOperationResult,
  handler: async (ctx, args): Promise<BeginApolloOperationResult> => {
    const mission = await ctx.db.get("missions", args.missionId);
    if (mission === null) {
      throw domainError("NOT_FOUND", "mission not found");
    }
    if (
      mission.state === "completed" ||
      mission.state === "cancelled" ||
      mission.state === "failed"
    ) {
      throw domainError(
        "CONFLICT",
        `mission is ${mission.state}; cannot start an Apollo operation`,
      );
    }
    const operationKey = boundedString(args.operationKey, "operationKey", {
      min: 1,
      max: OPERATION_KEY_MAX,
    });
    const existing = await ctx.db
      .query("providerOperations")
      .withIndex("by_workspaceId_and_provider_and_operationKey", (q) =>
        q
          .eq("workspaceId", mission.workspaceId)
          .eq("provider", "apollo")
          .eq("operationKey", operationKey),
      )
      .unique();
    if (existing !== null) {
      if (existing.requestDigest !== args.requestDigest) {
        throw domainError(
          "CONFLICT",
          "operationKey was already used with different arguments",
        );
      }
      if (args.runId !== undefined && !receiptNamesRun(existing, args.runId)) {
        const history = [
          ...(existing.replayedForRunIds ?? []),
          args.runId,
        ].slice(-PROVIDER_OPERATION_RUN_HISTORY_MAX);
        await ctx.db.patch("providerOperations", existing._id, {
          replayedForRunIds: history,
          updatedAt: Date.now(),
        });
      }
      const recorded =
        existing.state === "completed" && existing.resultRef?.kind === "inline"
          ? storedResultFromRow(existing.resultRef.value)
          : undefined;
      return {
        decision: "replay",
        providerOperationId: existing._id,
        state: existing.state,
        ...(recorded !== undefined ? { result: recorded } : {}),
        ...(existing.error !== undefined ? { error: existing.error } : {}),
      };
    }

    const reservationIds: Id<"usageReservations">[] = [];
    if (args.metric !== undefined) {
      if (
        args.scopeKey === undefined ||
        args.periodKey === undefined ||
        args.limit === undefined
      ) {
        throw invalid(
          "scopeKey, periodKey and limit are required when reserving Apollo usage",
        );
      }
      const reservation = await ctx.runMutation(internal.usage.reserve, {
        workspaceId: mission.workspaceId,
        scopeKey: args.scopeKey,
        metric: args.metric,
        periodKey: args.periodKey,
        limit: args.limit,
        operationKey,
        ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
      });
      reservationIds.push(reservation.reservationId);
    }

    const now = Date.now();
    const providerOperationId = await ctx.db.insert("providerOperations", {
      workspaceId: mission.workspaceId,
      provider: "apollo" as const,
      operationKey,
      missionId: mission._id,
      requestDigest: args.requestDigest,
      reservationIds,
      state: "requested" as const,
      createdAt: now,
      updatedAt: now,
      ...(args.prospectId !== undefined ? { prospectId: args.prospectId } : {}),
      ...(args.runId !== undefined ? { runId: args.runId } : {}),
    });
    return { decision: "execute", providerOperationId };
  },
});

export const settleApolloOperation = internalMutation({
  args: {
    providerOperationId: v.id("providerOperations"),
    settlement: v.union(
      v.literal("commit"),
      v.literal("release"),
      v.literal("markUncertain"),
    ),
    state: vProviderOperationState,
    result: v.optional(vSanitizedApolloResult),
    error: v.optional(vProviderOperationError),
  },
  returns: v.object({ state: vProviderOperationState, settled: v.boolean() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ state: ProviderOperationState; settled: boolean }> => {
    const row = await ctx.db.get("providerOperations", args.providerOperationId);
    if (row === null) {
      throw domainError("NOT_FOUND", "provider operation not found");
    }
    if (row.provider !== "apollo") {
      throw domainError("CONFLICT", "provider operation is not an Apollo row");
    }
    if (row.state === args.state) {
      return { state: row.state, settled: false };
    }
    if (row.state === "completed" || row.state === "failed") {
      throw domainError(
        "CONFLICT",
        `provider operation is ${row.state}; it can no longer be settled`,
      );
    }
    if (row.reservationIds.length > 0) {
      if (args.settlement === "commit") {
        await ctx.runMutation(internal.usage.commit, {
          workspaceId: row.workspaceId,
          operationKey: row.operationKey,
        });
      } else if (args.settlement === "release") {
        await ctx.runMutation(internal.usage.release, {
          workspaceId: row.workspaceId,
          operationKey: row.operationKey,
        });
      } else {
        await ctx.runMutation(internal.usage.markUncertain, {
          workspaceId: row.workspaceId,
          operationKey: row.operationKey,
        });
      }
    }
    const sanitized =
      args.result === undefined ? undefined : sanitizeStoredResult(args.result);
    const resultDigest =
      sanitized === undefined ? undefined : await computeResultDigest(sanitized);
    await ctx.db.patch("providerOperations", row._id, {
      state: args.state,
      settlement: args.settlement,
      updatedAt: Date.now(),
      ...(sanitized !== undefined
        ? {
            resultRef: { kind: "inline" as const, value: sanitized },
            resultDigest,
          }
        : {}),
      ...(args.error !== undefined ? { error: args.error } : {}),
    });
    return { state: args.state, settled: true };
  },
});

export const prepareCompanySearch = internalMutation({
  args: { missionId: v.id("missions") },
  returns: vPrepareCompanySearchResult,
  handler: async (ctx, args): Promise<PrepareCompanySearchResult> => {
    const mission = await ctx.db.get("missions", args.missionId);
    if (mission === null) {
      return { action: "unavailable", reason: "mission not found" };
    }
    if (
      mission.state === "completed" ||
      mission.state === "cancelled" ||
      mission.state === "failed"
    ) {
      return {
        action: "skipped",
        reason: `mission is ${mission.state}; Apollo discovery will not run`,
      };
    }
    const campaign = await ctx.db.get("campaigns", mission.campaignId);
    if (campaign === null) {
      return { action: "unavailable", reason: "campaign not found for mission" };
    }
    if (campaign.sourcePlan.confirmedBy === undefined) {
      return {
        action: "skipped",
        reason: "campaign source plan is not confirmed",
      };
    }
    const apolloSource = campaign.sourcePlan.sources.find(
      (source) => source.source === "apollo",
    );
    if (apolloSource === undefined || apolloSource.source !== "apollo") {
      return {
        action: "skipped",
        reason: "apollo is not in the confirmed source plan",
      };
    }
    if (campaign.status !== "active") {
      return {
        action: "unavailable",
        reason: `campaign is ${campaign.status}; Apollo discovery will not run`,
      };
    }
    const locations = (apolloSource.filters.locations ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const categories = (apolloSource.filters.categories ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const employeeRanges =
      apolloSource.filters.employeeCount === undefined
        ? []
        : [
            `${apolloSource.filters.employeeCount.min},${apolloSource.filters.employeeCount.max}`,
          ];
    const perPage = Math.max(
      1,
      Math.min(
        Math.max(campaign.leadLimit * 2, campaign.leadLimit),
        apolloSource.maxResults ?? SOURCE_MAX_RESULTS_MAX,
        SOURCE_MAX_RESULTS_MAX,
        10,
        CAMPAIGN_LEAD_LIMIT_MAX * 2,
      ),
    );
    const filterDigest = await sha256Hex(
      JSON.stringify({
        locations,
        categories,
        employeeRanges,
        perPage,
      }),
    );
    return {
      action: "ready",
      workspaceId: mission.workspaceId,
      campaignId: campaign._id,
      perPage,
      locations,
      categories,
      employeeRanges,
      filterDigest,
    };
  },
});

export const prepareContactEnrichment = internalMutation({
  args: {
    branchId: v.id("missionProspects"),
    runId: v.id("runs"),
  },
  returns: vPrepareContactEnrichmentResult,
  handler: async (ctx, args): Promise<PrepareContactEnrichmentResult> => {
    const branch = await ctx.db.get("missionProspects", args.branchId);
    if (branch === null) {
      return { action: "skipped", reason: "prospect branch not found" };
    }
    const mission = await ctx.db.get("missions", branch.missionId);
    if (mission === null) {
      return { action: "skipped", reason: "mission not found" };
    }
    if (
      mission.state === "completed" ||
      mission.state === "cancelled" ||
      mission.state === "failed"
    ) {
      return { action: "skipped", reason: `mission is ${mission.state}` };
    }
    const prospectId = ctx.db.normalizeId("prospects", branch.prospectId);
    if (prospectId === null) {
      return { action: "skipped", reason: "branch key is not a persisted prospect" };
    }
    const prospect = await ctx.db.get("prospects", prospectId);
    if (
      prospect === null ||
      prospect.workspaceId !== mission.workspaceId ||
      prospect.campaignId !== mission.campaignId
    ) {
      return { action: "skipped", reason: "prospect not found for this mission" };
    }
    if (prospect.contact?.email !== undefined) {
      return { action: "skipped", reason: "prospect already has a contact address" };
    }
    if (prospect.qualification !== "qualified") {
      return {
        action: "skipped",
        reason: `prospect qualification is ${prospect.qualification}; enrichment requires a qualified lead`,
      };
    }
    const cited = await ctx.db
      .query("evidence")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", prospect._id),
      )
      .take(1);
    if (cited.length === 0) {
      return {
        action: "skipped",
        reason: "no qualification evidence has been accepted for this prospect",
      };
    }
    const campaign = await ctx.db.get("campaigns", mission.campaignId);
    if (campaign === null) {
      return { action: "unavailable", reason: "campaign not found for mission" };
    }
    if (campaign.enrichmentLimit === 0) {
      return {
        action: "unavailable",
        reason: "campaign enrichmentLimit is 0; paid enrichment will not run",
      };
    }
    const apolloRef = prospect.sourceRefs.find((ref) => ref.source === "apollo");
    return {
      action: "proceed",
      prospectId: prospect._id,
      expectedVersion: prospect.version,
      canonicalDomain: prospect.canonicalDomain,
      companyName: prospect.companyName,
      ...(apolloRef?.providerRecordId !== undefined
        ? { apolloProviderRecordId: apolloRef.providerRecordId }
        : {}),
      campaignId: campaign._id,
      workspaceId: mission.workspaceId,
      missionId: mission._id,
      enrichmentLimit: campaign.enrichmentLimit,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Workflow-facing actions                                             */
/* ------------------------------------------------------------------ */

export const searchCompanies = internalAction({
  args: { missionId: v.id("missions") },
  returns: vSearchCompaniesResult,
  handler: async (ctx, args): Promise<SearchCompaniesResult> => {
    if (apolloApiKey() === undefined) {
      return emptySearch(
        "unavailable",
        "APOLLO_API_KEY is not set on this Convex deployment",
      );
    }
    let prepared: PrepareCompanySearchResult;
    try {
      prepared = await ctx.runMutation(
        internal.integrations.apollo.prepareCompanySearch,
        { missionId: args.missionId },
      );
    } catch (error) {
      return emptySearch("unavailable", refusalMessage(error));
    }
    if (prepared.action !== "ready") {
      return emptySearch(prepared.action, prepared.reason);
    }

    const operationKey = await boundOperationKey(
      `apollo:search:${prepared.campaignId}:${prepared.filterDigest}`,
    );
    const requestDigest = await computeResultDigest({
      provider: "apollo",
      tool: "mixed_companies/search",
      arguments: {
        locations: prepared.locations,
        categories: prepared.categories,
        employeeRanges: prepared.employeeRanges,
        page: 1,
        perPage: prepared.perPage,
      },
    });

    let begin: BeginApolloOperationResult;
    try {
      begin = await ctx.runMutation(
        internal.integrations.apollo.beginApolloOperation,
        {
          missionId: args.missionId,
          operationKey,
          requestDigest,
          metric: "research_searches" as const,
          scopeKey: `campaign:${prepared.campaignId}`,
          periodKey: "lifetime",
          limit: APOLLO_COMPANY_SEARCH_LIMIT,
          quantity: 1,
        },
      );
    } catch (error) {
      return emptySearch("unavailable", refusalMessage(error));
    }

    if (begin.decision === "replay") {
      if (begin.state === "completed") {
        const candidates = (begin.result?.candidates ?? []).slice(
          0,
          PROSPECT_IMPORT_CANDIDATES_MAX,
        );
        return {
          action: "done",
          candidates,
          replayed: true,
          summary: `Replayed ${candidates.length} Apollo company search candidate(s)`,
        };
      }
      return emptySearch(
        "unavailable",
        begin.error?.message ??
          `Apollo company search is ${begin.state} for this campaign; it will not be retried`,
      );
    }

    const params: Record<string, ApolloQueryValue> = {
      page: 1,
      per_page: prepared.perPage,
    };
    if (prepared.locations.length > 0) {
      params.organization_locations = prepared.locations;
    }
    if (prepared.categories.length > 0) {
      params.q_organization_keyword_tags = prepared.categories;
    }
    if (prepared.employeeRanges.length > 0) {
      params.organization_num_employees_ranges = prepared.employeeRanges;
    }

    const fetched = await apolloPost("/mixed_companies/search", params);
    if (fetched.outcome === "failure") {
      await settleCaught(ctx, begin.providerOperationId, fetched);
      return emptySearch("unavailable", fetched.message);
    }

    const retrievedAt = Date.now();
    const fitReason = fitReasonFromFilters(prepared);
    const candidates = mapOrganizationsToCandidates(
      fetched.body,
      fitReason,
      retrievedAt,
    ).slice(0, Math.min(prepared.perPage, PROSPECT_IMPORT_CANDIDATES_MAX));
    try {
      await ctx.runMutation(internal.integrations.apollo.settleApolloOperation, {
        providerOperationId: begin.providerOperationId,
        settlement: "commit",
        state: "completed",
        result: { candidates },
      });
    } catch (error) {
      return emptySearch("unavailable", refusalMessage(error));
    }
    return {
      action: "done",
      candidates,
      replayed: false,
      summary: `Apollo company search returned ${candidates.length} candidate(s)`,
    };
  },
});

export const enrichContact = internalAction({
  args: {
    branchId: v.id("missionProspects"),
    runId: v.id("runs"),
  },
  returns: vEnrichContactResult,
  handler: async (ctx, args): Promise<EnrichContactResult> => {
    if (apolloApiKey() === undefined) {
      return {
        action: "unavailable",
        reason: "APOLLO_API_KEY is not set on this Convex deployment",
      };
    }
    let prepared: PrepareContactEnrichmentResult;
    try {
      prepared = await ctx.runMutation(
        internal.integrations.apollo.prepareContactEnrichment,
        { branchId: args.branchId, runId: args.runId },
      );
    } catch (error) {
      return { action: "unavailable", reason: refusalMessage(error) };
    }
    if (prepared.action !== "proceed") {
      return { action: prepared.action, reason: prepared.reason };
    }

    const people = await searchPeopleForProspect(ctx, {
      missionId: prepared.missionId,
      prospectId: prepared.prospectId,
      runId: args.runId,
      canonicalDomain: prepared.canonicalDomain,
    });
    if (people.action === "unavailable") {
      return { action: "unavailable", reason: people.reason };
    }
    const chosen = pickMatchingPerson(people.people, prepared.canonicalDomain);
    if (chosen === undefined) {
      return {
        action: "no_address",
        reason: "No matching business person at this domain",
        prospectId: prepared.prospectId,
        expectedVersion: prepared.expectedVersion,
      };
    }

    const operationKey = await boundOperationKey(
      `apollo:enrich:${prepared.prospectId}:${chosen.id}`,
    );
    const requestDigest = await computeResultDigest({
      provider: "apollo",
      tool: "people/match",
      arguments: {
        id: chosen.id,
        reveal_personal_emails: false,
        reveal_phone_number: false,
      },
    });

    let begin: BeginApolloOperationResult;
    try {
      begin = await ctx.runMutation(
        internal.integrations.apollo.beginApolloOperation,
        {
          missionId: prepared.missionId,
          operationKey,
          requestDigest,
          metric: "apollo_enrichments" as const,
          scopeKey: `campaign:${prepared.campaignId}`,
          periodKey: "lifetime",
          limit: prepared.enrichmentLimit,
          quantity: 1,
          prospectId: prepared.prospectId,
          runId: args.runId,
        },
      );
    } catch (error) {
      return { action: "unavailable", reason: refusalMessage(error) };
    }

    if (begin.decision === "replay") {
      if (begin.state === "completed" && begin.result?.contact !== undefined) {
        return contactOutcome(
          begin.result.contact,
          prepared.prospectId,
          prepared.expectedVersion,
        );
      }
      return {
        action: "unavailable",
        reason:
          begin.error?.message ??
          `Apollo enrichment is ${begin.state} for this prospect; it will not be retried`,
      };
    }

    const fetched = await apolloPost("/people/match", {
      id: chosen.id,
      reveal_personal_emails: false,
      reveal_phone_number: false,
    });
    if (fetched.outcome === "failure") {
      await settleCaught(ctx, begin.providerOperationId, fetched);
      return { action: "unavailable", reason: fetched.message };
    }

    const person = matchPersonRecord(fetched.body);
    const retrievedAt = Date.now();
    if (person === null) {
      try {
        await ctx.runMutation(internal.integrations.apollo.settleApolloOperation, {
          providerOperationId: begin.providerOperationId,
          settlement: "commit",
          state: "completed",
        });
      } catch (error) {
        return { action: "unavailable", reason: refusalMessage(error) };
      }
      return {
        action: "no_address",
        reason: `Apollo returned no business person for ${chosen.name} at ${prepared.canonicalDomain}`,
        prospectId: prepared.prospectId,
        expectedVersion: prepared.expectedVersion,
      };
    }
    const contact = mapPersonToContact(
      person,
      chosen,
      prepared.canonicalDomain,
      retrievedAt,
    );
    try {
      await ctx.runMutation(internal.integrations.apollo.settleApolloOperation, {
        providerOperationId: begin.providerOperationId,
        settlement: "commit",
        state: "completed",
        result: { contact },
      });
    } catch (error) {
      return { action: "unavailable", reason: refusalMessage(error) };
    }
    return contactOutcome(
      contact,
      prepared.prospectId,
      prepared.expectedVersion,
    );
  },
});

function contactOutcome(
  contact: ProspectContact,
  prospectId: Id<"prospects">,
  expectedVersion: number,
): EnrichContactResult {
  if (contact.email !== undefined) {
    return { action: "ready", contact, prospectId, expectedVersion };
  }
  return {
    action: "no_address",
    contact,
    reason: contact.selectionReason,
    prospectId,
    expectedVersion,
  };
}

async function searchPeopleForProspect(
  ctx: Pick<ActionCtx, "runMutation">,
  args: {
    missionId: Id<"missions">;
    prospectId: Id<"prospects">;
    runId: Id<"runs">;
    canonicalDomain: string;
  },
): Promise<
  | { action: "done"; people: SanitizedPerson[] }
  | { action: "unavailable"; reason: string }
> {
  const titles = [...DEFAULT_PERSON_TITLES];
  const operationKey = await boundOperationKey(
    `apollo:people:${args.prospectId}:${args.canonicalDomain}`,
  );
  const requestDigest = await computeResultDigest({
    provider: "apollo",
    tool: "mixed_people/api_search",
    arguments: {
      domain: args.canonicalDomain,
      person_titles: titles,
      page: 1,
      per_page: PEOPLE_SEARCH_PER_PAGE,
    },
  });
  let begin: BeginApolloOperationResult;
  try {
    begin = await ctx.runMutation(
      internal.integrations.apollo.beginApolloOperation,
      {
        missionId: args.missionId,
        operationKey,
        requestDigest,
        prospectId: args.prospectId,
        runId: args.runId,
      },
    );
  } catch (error) {
    return { action: "unavailable", reason: refusalMessage(error) };
  }
  if (begin.decision === "replay") {
    if (begin.state === "completed") {
      return { action: "done", people: begin.result?.people ?? [] };
    }
    return {
      action: "unavailable",
      reason:
        begin.error?.message ??
        `Apollo people search is ${begin.state} for this prospect; it will not be retried`,
    };
  }

  const fetched = await apolloPost("/mixed_people/api_search", {
    page: 1,
    per_page: PEOPLE_SEARCH_PER_PAGE,
    q_organization_domains_list: [args.canonicalDomain],
    person_titles: titles,
  });
  if (fetched.outcome === "failure") {
    await settleCaught(ctx, begin.providerOperationId, fetched);
    return { action: "unavailable", reason: fetched.message };
  }
  const people: SanitizedPerson[] = [];
  for (const person of peopleRecords(fetched.body)) {
    const sanitized = sanitizePerson(person);
    if (sanitized !== null) people.push(sanitized);
  }
  try {
    await ctx.runMutation(internal.integrations.apollo.settleApolloOperation, {
      providerOperationId: begin.providerOperationId,
      settlement: "release",
      state: "completed",
      result: { people },
    });
  } catch (error) {
    return { action: "unavailable", reason: refusalMessage(error) };
  }
  return { action: "done", people };
}

async function settleCaught(
  ctx: Pick<ActionCtx, "runMutation">,
  providerOperationId: Id<"providerOperations">,
  failure: ApolloFetchFailure,
): Promise<void> {
  try {
    await ctx.runMutation(internal.integrations.apollo.settleApolloOperation, {
      providerOperationId,
      settlement: failure.settlement,
      state: failure.state,
      error: { code: failure.code, message: failure.message },
    });
  } catch {
    // Settlement is best-effort here: a throw would hide the provider
    // failure the caller is about to return. The stale-operation sweep
    // moves a still-`requested` row to uncertain.
  }
}
