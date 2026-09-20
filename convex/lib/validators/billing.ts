/**
 * Billing validators: the provider vocabulary behind a paid call, the usage
 * metrics and periods the ledger counts in, and the provider-operation
 * lifecycle that keeps a reservation honest.
 */
import { v } from "convex/values";
import type { Infer } from "convex/values";

/**
 * Paid or metered backends the app records `providerOperations` and
 * `platformBudgets` against. These names are SERVER-SIDE ONLY: no query that
 * feeds the client may return one (PLAN §4 "White-label rule").
 */
export const PROVIDER_KINDS = [
  "firecrawl",
  "agentmail",
  "enrich",
  "ai_gateway",
] as const;

export const vProviderKind = v.union(
  v.literal("firecrawl"),
  v.literal("agentmail"),
  v.literal("enrich"),
  v.literal("ai_gateway"),
);

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Small inline document or a private storage reference. */
export const vProviderDataRef = v.union(
  v.object({ kind: v.literal("inline"), value: v.any() }),
  v.object({
    kind: v.literal("storage"),
    storageId: v.id("_storage"),
    byteSize: v.number(),
    digest: v.string(),
  }),
);

export type ProviderDataRef = Infer<typeof vProviderDataRef>;

/**
 * The metered quantities (PLAN §6 "Ledger"). `credits` is the one number the
 * user sees; the rest are the hidden provider caps in the provider's own
 * units, which is why a call must pass both layers. Period keys are
 * `USAGE_PERIOD_LIFETIME` or the org-local day (`localDayKey`).
 */
export const USAGE_METRICS = [
  "credits",
  "enrich_credits",
  "enrich_searches",
  "ai_calls",
  "scrapes",
  "sends",
] as const;

export const vUsageMetric = v.union(
  v.literal("credits"),
  v.literal("enrich_credits"),
  v.literal("enrich_searches"),
  v.literal("ai_calls"),
  v.literal("scrapes"),
  v.literal("sends"),
);

export type UsageMetric = (typeof USAGE_METRICS)[number];

/** The non-daily period key: a bucket that never rolls over. */
export const USAGE_PERIOD_LIFETIME = "lifetime";

/** The one scope key an org-wide bucket uses. */
export const USAGE_SCOPE_ORG = "org";

/**
 * §4.4 provider tool-invocation lifecycle. `requested` is recorded BEFORE
 * the provider is contacted and `accepted` once the provider acknowledged a
 * durable job, so a crash between the two is always visible as an operation
 * that may have been billed. `uncertain` deliberately keeps its reservation
 * blocking capacity: an ambiguous failure consumes the allowance until
 * something reconciles it, which is the only honest accounting when we
 * cannot tell whether we were charged.
 */
export const PROVIDER_OPERATION_STATES = [
  "requested",
  "accepted",
  "completed",
  "uncertain",
  "failed",
] as const;

export const vProviderOperationState = v.union(
  v.literal("requested"),
  v.literal("accepted"),
  v.literal("completed"),
  v.literal("uncertain"),
  v.literal("failed"),
);

export type ProviderOperationState =
  (typeof PROVIDER_OPERATION_STATES)[number];

/**
 * How ONE provider operation's reservation was settled — recorded on the
 * operation row itself, because the row's `state` does not imply it.
 *
 * A post-fetch URL-policy refusal is the case that forces this: Firecrawl
 * fetched the page and billed us, and the redirect target is then refused,
 * so the operation is `failed` AND `commit`-settled. Counting a prospect's
 * spend by `state !== "failed"` let that billed retrieval escape the
 * per-prospect page cap. Counting by settlement cannot: `release` is the
 * only outcome that proves the provider was never reached.
 */
export const vProviderOperationSettlement = v.union(
  v.literal("commit"),
  v.literal("release"),
  v.literal("markUncertain"),
);

export type ProviderOperationSettlement = Infer<
  typeof vProviderOperationSettlement
>;

/**
 * Does this operation's receipt consume the prospect's page allowance?
 *
 * Everything except a released reservation does. A row with no recorded
 * settlement is still in flight (`requested`/`accepted`) and its
 * reservation is live, so it counts too — an unsettled operation must never
 * be free.
 */
export function consumesPageAllowance(row: {
  settlement?: ProviderOperationSettlement;
}): boolean {
  return row.settlement !== "release";
}

/**
 * Lead research reads the lead's company home page and nothing else
 * (PLAN §4 "Firecrawl change needed": website analysis takes up to four
 * pages, lead research stays at one). Three is the per-lead ceiling on
 * BILLED retrievals, so a retried research step cannot buy a fourth page.
 */
export const RESEARCH_PAGES_PER_PROSPECT = 3;

/**
 * One page the BACKEND itself retrieved, in the shape the app stores and
 * cites. `retrievedAt` is epoch ms — `scrapePage` reports an ISO 8601
 * string, and the conversion happens once, here at the boundary, rather
 * than being repeated (and eventually mis-repeated) at each read site.
 */
export const vRetrievedPage = v.object({
  url: v.string(),
  retrievedAt: v.number(),
  excerpt: v.string(),
  statusCode: v.optional(v.number()),
  truncated: v.boolean(),
  providerOperationId: v.id("providerOperations"),
});

export type RetrievedPage = Infer<typeof vRetrievedPage>;

export const vUsageReservationState = v.union(
  v.literal("reserved"),
  v.literal("committed"),
  v.literal("released"),
  v.literal("uncertain"),
);

export type UsageReservationState =
  | "reserved"
  | "committed"
  | "released"
  | "uncertain";
