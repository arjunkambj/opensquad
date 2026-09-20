/**
 * Search-param parsing shared by every dashboard route.
 *
 * The conventions are settled here, once, before the board and the list
 * screens are built — retrofitting URL state onto a screen that kept its
 * filters in React state means rewriting the screen.
 *
 * 1. A record gets a path segment; a view MODE of one screen gets a search
 *    param. A record has an id, is linkable, and is the unit of two-session
 *    work (V09, V13). A mode has no identity.
 * 2. Every param is optional in the URL and TOTAL in the parsed type. An
 *    absent, misspelled or stale value falls back to its documented default
 *    instead of throwing, so a hand-edited link or an old bookmark still opens
 *    the page. A filtered view is a link someone pastes to a colleague; it must
 *    never 500 because an enum member was renamed.
 * 3. Writing the URL omits defaults, so the clean state of a screen is its
 *    bare path and the address bar only ever shows what the user changed.
 * 4. A cursor belongs to the filter set that produced it. Any filter change
 *    must drop the cursor — see `withFilters` — or page two of one query
 *    renders as page two of a different one.
 */

/** A value constrained to a union, with a default for anything unrecognised. */
export function oneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/** The same, but absent means absent — for a filter with no default. */
export function optionalOneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
): T | undefined {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

/**
 * A bounded free-text param (a search box, a display label from a link).
 */
export function optionalText(value: unknown, max = 200): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length === 0 || trimmed.length > max ? undefined : trimmed
}

export function optionalCursor(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 2048
    ? value
    : undefined
}

/** A boolean that is false unless the URL says otherwise. */
export function flag(value: unknown): boolean {
  return value === true || value === "true"
}

/** The largest instant a JavaScript `Date` can represent. */
const MAX_EPOCH_MS = 8_640_000_000_000_000

/**
 * An absolute instant in epoch milliseconds — the `from`/`to` of a custom
 * date range.
 *
 * Absolute on purpose: `?range=today` means today for whoever opens the link,
 * which is right for a relative window and wrong for a range someone pasted to
 * a colleague to talk about. A custom range has to mean the same instants for
 * both of them, so it travels as two numbers rather than as a label.
 *
 * Anything that is not a finite, non-negative integer instant normalises to
 * absent, and the range falls back to its default rather than throwing.
 */
export function optionalEpochMs(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) {
    return undefined
  }
  return parsed < 0 || parsed > MAX_EPOCH_MS ? undefined : parsed
}

/** A page size restricted to the sizes the backend actually serves. */
export const PAGE_SIZES = [25, 50] as const
export type PageSize = (typeof PAGE_SIZES)[number]

/**
 * Absent means the default — `25`. Returning `undefined` (not `25`) keeps the
 * default out of the URL: the backend's own default is the same 25, and a
 * parsed `limit` that always contains a value would write `?limit=25` onto
 * every link this screen builds (rule 3 — the clean state is the bare path).
 */
export function pageSize(value: unknown): PageSize | undefined {
  const parsed = typeof value === "string" ? Number(value) : value
  return (PAGE_SIZES as readonly unknown[]).includes(parsed)
    ? (parsed as PageSize)
    : undefined
}

/**
 * Apply a filter change and drop the cursor in the same update.
 *
 * Every list screen should route filter changes through this rather than
 * spreading `prev` by hand, because forgetting the cursor is silent: the page
 * renders, it is simply the wrong page of a different query.
 */
export function withFilters<T extends { cursor?: string }>(
  previous: T,
  changes: Partial<T>,
): T {
  return { ...previous, ...changes, cursor: undefined }
}
