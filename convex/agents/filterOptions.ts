/**
 * The lead-search filter catalogue, cached (PLAN §3 step 2).
 *
 * The values a search filter accepts are case-sensitive and a typo silently
 * returns zero rows, so nothing in this product ever invents one: the
 * catalogue is fetched, cached in the `leadFilterOptions` singleton and
 * refreshed weekly, the strategy recommender picks only from it, and every
 * value is re-checked against it before a search leaves the deployment.
 *
 * `leadFilterOptions` is a singleton by convention rather than by schema:
 * the reader takes the newest row and a refresh replaces it in place, so
 * there is never more than one live row to disagree with.
 */
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { fetchFilterCatalogue } from "../integrations/enrich/catalog";
import {
  buildLeadQuery,
  supportedExcludeFilterKeys,
  supportedFilterKeys,
} from "../integrations/enrich/filters";
import { operationErrorCodeOf } from "../integrations/enrich/client";
import {
  unwrapConvexErrorText,
  vLeadFilterOption,
  vLeadFilters,
  vOperationErrorCode,
} from "../lib/validators";
import type { LeadFilterOption, OperationErrorCode } from "../lib/validators";
import { v } from "convex/values";

/** A catalogue smaller than this is not a catalogue — the live one has 46. */
const MIN_PLAUSIBLE_FILTER_COUNT = 10;

/**
 * `fetchedAt` travels instead of a computed "stale" flag: a Convex query must
 * not read the wall clock — the same arguments would answer differently and
 * the subscription would never re-run when the answer changed — and every
 * caller that cares about age is an action, which has a clock of its own.
 */
const vCachedFilterOptions = v.object({
  options: v.record(v.string(), vLeadFilterOption),
  fetchedAt: v.number(),
});

/**
 * The cached catalogue, or `null` when it has never been fetched.
 *
 * Read by the strategy recommender (T23) to bound what the model may pick,
 * and by the search boundary to re-check every value before the call.
 */
export const cachedFilterOptions = internalQuery({
  args: {},
  returns: v.union(v.null(), vCachedFilterOptions),
  handler: async (ctx): Promise<CachedFilterOptions | null> =>
    await readCachedOptions(ctx),
});

type CachedFilterOptions = {
  options: Record<string, LeadFilterOption>;
  fetchedAt: number;
};

/** The newest cached catalogue. One reader, so "the singleton" means the
 *  same row to every caller. */
async function readCachedOptions(
  ctx: QueryCtx,
): Promise<CachedFilterOptions | null> {
  const row = await ctx.db
    .query("leadFilterOptions")
    .withIndex("by_fetchedAt")
    .order("desc")
    .first();
  if (row === null) {
    return null;
  }
  return { options: row.options, fetchedAt: row.fetchedAt };
}

/** Replace the singleton with a freshly fetched catalogue. */
export const replaceFilterOptions = internalMutation({
  args: {
    options: v.record(v.string(), vLeadFilterOption),
  },
  returns: v.object({ filters: v.number(), fetchedAt: v.number() }),
  handler: async (ctx, args): Promise<{ filters: number; fetchedAt: number }> => {
    const fetchedAt = Date.now();
    const existing = await ctx.db
      .query("leadFilterOptions")
      .withIndex("by_fetchedAt")
      .order("desc")
      .first();
    if (existing === null) {
      await ctx.db.insert("leadFilterOptions", {
        options: args.options,
        fetchedAt,
      });
    } else {
      await ctx.db.patch("leadFilterOptions", existing._id, {
        options: args.options,
        fetchedAt,
      });
      // Anything older is a duplicate from before this rule existed.
      const stale = await ctx.db
        .query("leadFilterOptions")
        .withIndex("by_fetchedAt")
        .order("desc")
        .take(10);
      for (const row of stale) {
        if (row._id !== existing._id) {
          await ctx.db.delete("leadFilterOptions", row._id);
        }
      }
    }
    return { filters: Object.keys(args.options).length, fetchedAt };
  },
});

/**
 * Fetch the catalogue and cache it — the weekly cron's job, and the way to
 * refresh on demand before a recommendation run.
 *
 * A failed fetch leaves the previous cache in place: an old catalogue still
 * validates the values it knows, and replacing it with nothing would stop
 * every search.
 */
export const refreshFilterOptions = internalAction({
  args: {},
  returns: v.union(
    v.object({
      status: v.literal("refreshed"),
      filters: v.number(),
      withValues: v.number(),
      fetchedAt: v.number(),
    }),
    v.object({ status: v.literal("failed"), code: vOperationErrorCode }),
  ),
  handler: async (
    ctx,
  ): Promise<
    | {
        status: "refreshed";
        filters: number;
        withValues: number;
        fetchedAt: number;
      }
    | { status: "failed"; code: OperationErrorCode }
  > => {
    const fetched = await fetchFilterCatalogue();
    if (fetched.kind !== "ok") {
      console.error("filter catalogue refresh failed", {
        reason: fetched.reason,
      });
      return { status: "failed", code: operationErrorCodeOf(fetched.reason) };
    }
    const filters = Object.keys(fetched.data.options).length;
    if (filters < MIN_PLAUSIBLE_FILTER_COUNT) {
      // A short answer would quietly narrow what every strategy may use.
      console.error("filter catalogue refresh returned too few filters", {
        filters,
      });
      return { status: "failed", code: "invalid_response" };
    }
    const stored = await ctx.runMutation(
      internal.agents.filterOptions.replaceFilterOptions,
      { options: fetched.data.options },
    );
    return {
      status: "refreshed",
      filters: stored.filters,
      withValues: fetched.data.withValues,
      fetchedAt: stored.fetchedAt,
    };
  },
});

/**
 * Would this filter set be accepted? No network call, no credits — the same
 * check the search boundary runs, offered on its own so the strategy
 * recommender (T23) can reject a model's suggestion before it is stored.
 */
export const validateFilters = internalQuery({
  args: {
    filters: vLeadFilters,
    excludeFilters: v.optional(vLeadFilters),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), filters: v.number() }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    { ok: true; filters: number } | { ok: false; reason: string }
  > => {
    const cached = await readCachedOptions(ctx);
    if (cached === null) {
      return { ok: false, reason: "the filter catalogue has not been cached" };
    }
    try {
      const built = buildLeadQuery({
        filters: args.filters,
        ...(args.excludeFilters !== undefined
          ? { excludeFilters: args.excludeFilters }
          : {}),
        options: cached.options,
      });
      return { ok: true, filters: Object.keys(built.filters).length };
    } catch (error) {
      return { ok: false, reason: refusalText(error) };
    }
  },
});

/**
 * The filter names a strategy may use at all, and the five an exclusion list
 * may use — the vocabulary T23 hands the model, so it cannot propose a filter
 * this product has no code path for.
 */
export const supportedFilters = internalQuery({
  args: {},
  returns: v.object({
    filters: v.array(v.string()),
    excludeFilters: v.array(v.string()),
  }),
  handler: async (): Promise<{
    filters: string[];
    excludeFilters: string[];
  }> => ({
    filters: supportedFilterKeys(),
    excludeFilters: supportedExcludeFilterKeys(),
  }),
});

/** The stated reason a filter set was refused, without the error envelope. */
function refusalText(error: unknown): string {
  const data =
    typeof error === "object" && error !== null
      ? (error as { data?: { message?: unknown } }).data
      : undefined;
  if (data !== undefined && typeof data.message === "string") {
    return data.message.slice(0, 300);
  }
  const raw = error instanceof Error ? error.message : String(error);
  return unwrapConvexErrorText(raw).slice(0, 300);
}
