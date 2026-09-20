/**
 * The provider's filter catalogue: `GET /lead-finder/filter-options`, free,
 * and the only source of truth for which enum values exist (PLAN §3 step 2).
 *
 * Exported as a plain async function rather than a Convex action, so the
 * domain module that owns the cache (`agents/filterOptions.ts`) can call it
 * directly and the dependency arrow stays `domain → integrations`.
 *
 * Two shapes have to be read carefully, both recorded live in spikes §3:
 *   - seven filters (`city`, `companyName`, `domain`, `headquartersCity`,
 *     `jobTitle`, `languages`, `skills`) legitimately come back with an empty
 *     `values` array because they are free text. An empty list is NOT a
 *     failed fetch and must not be treated as one;
 *   - `martechCategoriesOrg` comes back empty too, which is a provider bug —
 *     the filter has 49 values. Until the real list is in hand it stays
 *     empty, and `filters.ts` refuses that filter rather than sending a value
 *     it could not check (an unchecked value returns zero rows in silence).
 */
import type { LeadFilterOption } from "../../lib/validators";
import { enrichRequest } from "./client";
import type { EnrichResult } from "./client";

/** Most filters we will ever be offered; a larger answer is truncated. */
const MAX_CATALOGUE_FILTERS = 200;

/** Values kept per filter — the largest real one is ~1,222 (spikes §3). */
const MAX_VALUES_PER_FILTER = 2_000;

const MAX_VALUE_LENGTH = 200;

const MAX_LABEL_LENGTH = 200;

/**
 * Values pasted in by hand for a filter the provider returns empty. Keyed by
 * filter name, applied only when the fetched entry has none.
 *
 * `martechCategoriesOrg` is the one known case and it is deliberately EMPTY:
 * nothing in this repository records the 49 real values, and inventing them
 * would produce searches that silently match nothing. Paste the real list
 * here once it has been read from the provider, and the filter starts
 * working with no other change.
 */
const CATALOGUE_SEEDS: Record<string, readonly string[]> = {
  martechCategoriesOrg: [],
};

type RawFilterOption = {
  label?: unknown;
  category?: unknown;
  values?: unknown;
  maxSelections?: unknown;
};

export type FilterCatalogue = {
  options: Record<string, LeadFilterOption>;
  /** How many of them carry allowed values — the free-text ones do not. */
  withValues: number;
};

/** Fetch and normalise the catalogue. Free, and never inside `withCredits`. */
export async function fetchFilterCatalogue(): Promise<
  EnrichResult<FilterCatalogue>
> {
  const result = await enrichRequest<Record<string, RawFilterOption>>({
    path: "/lead-finder/filter-options",
    method: "GET",
    idempotent: true,
  });
  if (result.kind !== "ok") {
    return result;
  }
  const raw = result.data;
  if (typeof raw !== "object" || raw === null) {
    return { kind: "unknown", reason: "invalid_response" };
  }
  const options: Record<string, LeadFilterOption> = {};
  let withValues = 0;
  for (const [key, entry] of Object.entries(raw).slice(
    0,
    MAX_CATALOGUE_FILTERS,
  )) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const option = normaliseOption(key, entry);
    options[key] = option;
    if (option.values.length > 0) {
      withValues += 1;
    }
  }
  if (Object.keys(options).length === 0) {
    return { kind: "unknown", reason: "invalid_response" };
  }
  return {
    kind: "ok",
    data: { options, withValues },
    ...(result.requestId !== undefined ? { requestId: result.requestId } : {}),
  };
}

function normaliseOption(key: string, entry: RawFilterOption): LeadFilterOption {
  const fetched = Array.isArray(entry.values)
    ? entry.values
        .filter(
          (value): value is string =>
            typeof value === "string" &&
            value.length > 0 &&
            value.length <= MAX_VALUE_LENGTH,
        )
        .slice(0, MAX_VALUES_PER_FILTER)
    : [];
  const seed = CATALOGUE_SEEDS[key];
  const values =
    fetched.length === 0 && seed !== undefined ? [...seed] : fetched;
  const maxSelections =
    typeof entry.maxSelections === "number" &&
    Number.isInteger(entry.maxSelections) &&
    entry.maxSelections > 0
      ? entry.maxSelections
      : 0;
  return {
    label:
      typeof entry.label === "string" && entry.label.length > 0
        ? entry.label.slice(0, MAX_LABEL_LENGTH)
        : key,
    category: categoryOf(entry.category),
    values,
    maxSelections,
  };
}

/** The catalogue groups filters for the UI. An unrecognised group is filed
 *  under `organization`, which is only a heading — it never affects whether a
 *  value is accepted. */
function categoryOf(value: unknown): LeadFilterOption["category"] {
  return value === "person" || value === "insights" ? value : "organization";
}
