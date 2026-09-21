/**
 * Counting and finding leads — the free half and the paid half of one
 * boundary (PLAN §3 steps 4 and 6, PLAN §6 layer 1 "Find leads: 2 credits").
 *
 * `countLeads` is free: it validates a strategy's filters and asks how many
 * people match, which is what makes the recommender's relax/tighten pass
 * cost nothing. It never touches the credit wrapper — but it does respect the
 * kill switch, because a paused platform makes no provider calls at all.
 *
 * `findLeads` is the paid one. Its accounting is settled from the PAGE
 * NUMBER, not from the response: lead-finder `meta` carries only a
 * `requestId` (spikes §3 — there is no `creditsUsed` on search), and pages
 * 1–3 are free per the provider's own tier. This build refuses `page > 3`
 * outright, so a search's real provider credits are always zero and what it
 * consumes is one `enrich_searches` unit — exactly what is reserved.
 *
 * The refusal ladder follows T02's discipline: anything provably refused
 * before the request left RETURNS `refunded` with a typed reason, and an
 * unknown outcome THROWS so the hold parks as `uncertain`.
 */
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
import { withCredits } from "../../billing/withCredits";
import { composeOperationKey, vRefundReason } from "../../billing/paidCall";
import type { RefundReason } from "../../billing/paidCall";
import type { LeadFilterOption, OperationErrorCode } from "../../lib/validators";
import {
  domainError,
  vLeadFilters,
  vOperationErrorCode,
} from "../../lib/validators";
import { enrichRequest, operationErrorCodeOf, refundReasonOf } from "./client";
import type { EnrichUnknown } from "./client";
import { buildLeadQuery } from "./filters";
import {
  fieldPresenceOf,
  toSourcedLead,
  vLeadFieldPresence,
  vSourcedLead,
} from "./rows";
import type { LeadFieldPresence, SourcedLead } from "./rows";
import { v } from "convex/values";

/** Fixed by PLAN §6 "Closing the ways in" — never caller-controlled. */
const SEARCH_PAGE_SIZE = 25;

/** The last page the free tier covers. Page 4 would be 1 credit per row. */
const MAX_SEARCH_PAGE = 3;

const vCountResult = v.union(
  v.object({
    status: v.literal("counted"),
    count: v.number(),
    /** Whether the number is an estimate, read from what the response itself
     *  says (`countIsApproximate`) and never from how big it is — the flag
     *  was false at 89,731 on this account (spikes §3). */
    isApproximate: v.boolean(),
  }),
  v.object({ status: v.literal("failed"), code: vOperationErrorCode }),
);

/**
 * The provider's own answer to "is there another page?", or `null` when it
 * sent no pagination at all. The two are different facts: "there is nothing
 * more" ends a signal, "we do not know" must not.
 */
const vHasMore = v.union(v.boolean(), v.null());

/** What an EMPTY page's own pagination said. `null` members are the provider
 *  saying nothing, which is never evidence that the results ran out. */
const vEmptyPage = v.object({
  hasMore: vHasMore,
  totalResults: v.union(v.number(), v.null()),
});

const vFindResult = v.union(
  v.object({
    status: v.literal("found"),
    operationKey: v.string(),
    credits: v.number(),
    page: v.number(),
    totalResults: v.number(),
    hasMore: vHasMore,
    isApproximate: v.boolean(),
    presence: vLeadFieldPresence,
    /** Empty when the caller asked for a summary only. */
    rows: v.array(vSourcedLead),
  }),
  v.object({
    status: v.literal("refunded"),
    reason: vRefundReason,
    operationKey: v.optional(v.string()),
    /** Present only for `provider_charged_nothing`: the empty page's own
     *  pagination, so the caller can tell the end of a signal from a page
     *  that happened to hold nobody — and an unknown from either. */
    emptyPage: v.optional(vEmptyPage),
  }),
  /** This exact search was already paid for; its rows were stored then. */
  v.object({ status: v.literal("replayed"), operationKey: v.string() }),
  /** The request left us and its outcome is unknown: the hold stays. */
  v.object({
    status: v.literal("uncertain"),
    operationKey: v.string(),
    code: vOperationErrorCode,
  }),
  v.object({ status: v.literal("failed"), code: vOperationErrorCode }),
);

type CountResponse = {
  count?: unknown;
  isApproximate?: unknown;
  searchedTotalResult?: unknown;
};

type SearchResponse = {
  results?: unknown;
  pagination?: {
    page?: unknown;
    totalResults?: unknown;
    hasMore?: unknown;
    isApproximate?: unknown;
    searchedTotalResult?: unknown;
  };
};

/**
 * Whether the number the provider just handed back is an estimate.
 *
 * ONLY what the response itself says, in the provider's own two signals:
 *   - `isApproximate`, the documented flag;
 *   - `searchedTotalResult`, the raw total, which EQUALS the returned count
 *     whenever nothing was discounted or truncated. A divergence is the
 *     provider itself saying the number was adjusted (spikes §3 records the
 *     dedup discount and the 500,000 pagination cap as the two reasons it
 *     diverges), so the cap case is still caught — by the provider's own
 *     figures rather than by a size we chose.
 *
 * Nothing is inferred from how big the count is. The docs claim results above
 * 10,000 are estimated, but the flag came back FALSE at 89,731 on this
 * account (spikes §3: "do not key UI copy on the 10k threshold, read the
 * flag"), and a count standing at the pagination cap is a cap, not a guess
 * about size. `searchType` is not a signal either — `unified` is the ordinary
 * answer and was seen beside an exact count.
 */
function countIsApproximate(signals: {
  flag: unknown;
  count: number;
  searchedTotalResult: unknown;
}): boolean {
  if (signals.flag === true) {
    return true;
  }
  const raw = signals.searchedTotalResult;
  return (
    typeof raw === "number" &&
    Number.isFinite(raw) &&
    Math.trunc(raw) !== signals.count
  );
}

/**
 * How many people match — free, and the honest way to test a strategy before
 * spending anything on it.
 */
export const countLeads = internalAction({
  args: {
    filters: vLeadFilters,
    excludeFilters: v.optional(vLeadFilters),
  },
  returns: vCountResult,
  handler: async (
    ctx,
    args,
  ): Promise<
    | { status: "counted"; count: number; isApproximate: boolean }
    | { status: "failed"; code: OperationErrorCode }
  > => {
    const options = await cachedOptions(ctx);
    if (options === null) {
      return { status: "failed", code: "provider_unavailable" };
    }
    const query = buildLeadQuery({
      filters: args.filters,
      ...(args.excludeFilters !== undefined
        ? { excludeFilters: args.excludeFilters }
        : {}),
      options,
    });
    const result = await enrichRequest<CountResponse>({
      path: "/lead-finder/count",
      method: "POST",
      body: query,
      idempotent: true,
    });
    if (result.kind !== "ok") {
      return { status: "failed", code: operationErrorCodeOf(result.reason) };
    }
    const count = result.data.count;
    if (typeof count !== "number" || !Number.isFinite(count)) {
      return { status: "failed", code: "invalid_response" };
    }
    const whole = Math.max(0, Math.trunc(count));
    return {
      status: "counted",
      count: whole,
      isApproximate: countIsApproximate({
        flag: result.data.isApproximate,
        count: whole,
        searchedTotalResult: result.data.searchedTotalResult,
      }),
    };
  },
});

/**
 * One page of real people for one strategy — the paid step behind "Confirm &
 * find leads" (PLAN §3 step 6).
 *
 * `summaryOnly` returns the same accounting and field-presence counts with no
 * rows at all. The response carries personal data, so that is what a live
 * check runs: the result can be read, pasted and kept without printing
 * anybody's details.
 */
export const findLeads = internalAction({
  args: {
    orgId: v.id("orgs"),
    /** Caller's own idempotency key, e.g. `<strategyId>:<page>`. */
    operationKey: v.string(),
    filters: vLeadFilters,
    excludeFilters: v.optional(vLeadFilters),
    page: v.optional(v.number()),
    summaryOnly: v.optional(v.boolean()),
  },
  returns: vFindResult,
  handler: async (ctx, args): Promise<FindLeadsResult> => {
    const page = args.page ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > MAX_SEARCH_PAGE) {
      // Beyond the free tier every row costs a credit, so this build simply
      // has no code path there (PLAN §6 "Closing the ways in").
      throw domainError(
        "INVALID",
        `page must be between 1 and ${MAX_SEARCH_PAGE}`,
      );
    }
    const options = await cachedOptions(ctx);
    if (options === null) {
      return { status: "failed", code: "provider_unavailable" };
    }
    // Built BEFORE the reserve: an unusable filter set costs nothing at all —
    // no credits, no hold, no operation row, no request.
    const query = buildLeadQuery({
      filters: args.filters,
      ...(args.excludeFilters !== undefined
        ? { excludeFilters: args.excludeFilters }
        : {}),
      options,
    });

    let unknownReason: EnrichUnknown | null = null;
    /** The pagination of a page that came back empty — a refund carries no
     *  result of its own, and the caller needs to know whether there are more
     *  pages behind it. Held in a box because the search fills it in from
     *  inside the credit wrapper. */
    const empty: { page: EmptyPagePagination | null } = { page: null };
    let outcome;
    try {
      outcome = await withCredits(
        ctx,
        {
          orgId: args.orgId,
          action: "find_leads",
          operationKey: args.operationKey,
          worstCaseProviderUnits: { enrich_searches: 1 },
        },
        async () => {
          const result = await enrichRequest<SearchResponse>({
            path: "/lead-finder/search",
            method: "POST",
            body: { ...query, page, pageSize: SEARCH_PAGE_SIZE },
            // A repeat of the same filters does not consume another free
            // search on the provider's side, so re-asking is safe.
            idempotent: true,
          });
          if (result.kind === "refused") {
            return {
              outcome: "refunded" as const,
              reason: refundReasonOf(result.reason),
            };
          }
          if (result.kind === "unknown") {
            unknownReason = result.reason;
            throw new Error("lead search outcome unknown");
          }
          const rows = sourcedLeadsOf(result.data.results);
          const pagination = result.data.pagination ?? {};
          const totalResults = wholeNumber(pagination.totalResults, rows.length);
          if (rows.length === 0) {
            if (page === 1) {
              // The FIRST page of a filter combination is what spends one of
              // the account's free monthly searches; later pages of the same
              // combination spend none. The refund below releases the
              // reserved search unit along with the credits — a refunded
              // settlement cannot keep a provider unit — so this line is the
              // only record that the shared pool moved — the monthly ceiling
              // `enrich_searches` enforces is documented in `lib/limits.ts`.
              console.warn(
                "lead search: an empty first page spent one of the month's free searches",
              );
            }
            // The provider answered and charged nothing (PLAN §6). Its own
            // pagination travels with the refund: an empty page with more
            // behind it is a gap, not the end of the results — and a page
            // that came back with NO pagination says neither.
            empty.page = {
              hasMore: knownBoolean(pagination.hasMore),
              totalResults: knownWholeNumber(pagination.totalResults),
            };
            return {
              outcome: "refunded" as const,
              reason: "provider_charged_nothing" as const,
            };
          }
          return {
            outcome: "billed" as const,
            result: {
              rows,
              page,
              totalResults,
              hasMore: knownBoolean(pagination.hasMore),
              isApproximate: countIsApproximate({
                flag: pagination.isApproximate,
                count: totalResults,
                searchedTotalResult: pagination.searchedTotalResult,
              }),
            },
            // Pages 1–3 are free on this account, so the provider's credit
            // usage is zero and only our own search unit is consumed.
            actualUnits: { enrich_searches: 1, enrich_credits: 0 },
            ...(result.requestId !== undefined
              ? { resultRef: result.requestId, providerReference: result.requestId }
              : {}),
          };
        },
      );
    } catch (error) {
      if (unknownReason !== null) {
        // The hold is already parked `uncertain` by the wrapper. The key
        // handed back is the ledger's own — the caller's key namespaced by
        // the action — so a reconciler can find the operation by it.
        return {
          status: "uncertain",
          operationKey: composeOperationKey("find_leads", args.operationKey),
          code: operationErrorCodeOf(unknownReason),
        };
      }
      throw error;
    }

    if (outcome.kind === "refunded") {
      return {
        status: "refunded",
        reason: outcome.reason,
        ...(outcome.operationId !== null
          ? { operationKey: outcome.operationKey }
          : {}),
        ...(empty.page !== null ? { emptyPage: empty.page } : {}),
      };
    }
    if (outcome.kind === "uncertain") {
      return {
        status: "uncertain",
        operationKey: outcome.hold.operationKey,
        code: "unknown",
      };
    }
    if (outcome.replayed) {
      return { status: "replayed", operationKey: outcome.operationKey };
    }
    const found = outcome.result;
    return {
      status: "found",
      operationKey: outcome.operationKey,
      credits: outcome.credits,
      page: found.page,
      totalResults: found.totalResults,
      hasMore: found.hasMore,
      isApproximate: found.isApproximate,
      presence: fieldPresenceOf(found.rows),
      rows: args.summaryOnly === true ? [] : found.rows,
    };
  },
});

/** An empty page's own pagination. `null` is the provider saying nothing. */
export type EmptyPagePagination = {
  hasMore: boolean | null;
  totalResults: number | null;
};

type FindLeadsResult =
  | {
      status: "found";
      operationKey: string;
      credits: number;
      page: number;
      totalResults: number;
      hasMore: boolean | null;
      isApproximate: boolean;
      presence: LeadFieldPresence;
      rows: SourcedLead[];
    }
  | {
      status: "refunded";
      reason: RefundReason;
      operationKey?: string;
      emptyPage?: EmptyPagePagination;
    }
  | { status: "replayed"; operationKey: string }
  | { status: "uncertain"; operationKey: string; code: OperationErrorCode }
  | { status: "failed"; code: OperationErrorCode };

/**
 * The cached filter catalogue every value is checked against.
 *
 * This is the one domain function reference this boundary holds, and it is
 * deliberate: the cache is an org-independent singleton owned by
 * `agents/filterOptions.ts`, and reading it here is what keeps the check
 * unskippable — a caller cannot pass filters that were never validated.
 */
async function cachedOptions(
  ctx: ActionCtx,
): Promise<Record<string, LeadFilterOption> | null> {
  const cached = await ctx.runQuery(
    internal.agents.filterOptions.cachedFilterOptions,
    {},
  );
  if (cached === null) {
    console.error("lead search: the filter catalogue has never been cached");
    return null;
  }
  return cached.options;
}

function sourcedLeadsOf(results: unknown): SourcedLead[] {
  if (!Array.isArray(results)) {
    return [];
  }
  const rows: SourcedLead[] = [];
  for (const raw of results.slice(0, SEARCH_PAGE_SIZE)) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const lead = toSourcedLead(raw as Record<string, unknown>);
    if (lead !== null) {
      rows.push(lead);
    }
  }
  return rows;
}

function wholeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : fallback;
}

/** The boolean the provider actually sent, or `null` when it sent none. A
 *  missing flag is not `false`: that is the difference between "there is no
 *  more" and "we do not know". */
function knownBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** The count the provider actually sent, or `null` when it sent none. */
function knownWholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

export { MAX_SEARCH_PAGE, SEARCH_PAGE_SIZE };
