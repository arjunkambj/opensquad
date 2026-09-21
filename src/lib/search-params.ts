/** Omit URL defaults, normalize invalid values, and drop pagination cursors whenever filters change. */

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

export function optionalOneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
): T | undefined {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

export function optionalText(value: unknown, max = 200): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length === 0 || trimmed.length > max ? undefined : trimmed
}

/** Bound ID-shaped URL values before passing them to Convex; the backend validates the ID itself. */
export function optionalRecordId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{10,128}$/.test(value)
    ? value
    : undefined
}

export function optionalCursor(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 2048
    ? value
    : undefined
}

const MAX_EPOCH_MS = 8_640_000_000_000_000

/** Custom ranges use absolute epoch milliseconds so shared links keep the same bounds. */
export function optionalEpochMs(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) {
    return undefined
  }
  return parsed < 0 || parsed > MAX_EPOCH_MS ? undefined : parsed
}

export const PAGE_SIZES = [25, 50] as const
export type PageSize = (typeof PAGE_SIZES)[number]

/** Return undefined for the default limit so links omit it. */
export function pageSize(value: unknown): PageSize | undefined {
  const parsed = typeof value === "string" ? Number(value) : value
  return (PAGE_SIZES as readonly unknown[]).includes(parsed)
    ? (parsed as PageSize)
    : undefined
}

/** Page 1 is the default, so links omit it. */
export function optionalPageNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value
  return typeof parsed === "number" &&
    Number.isInteger(parsed) &&
    parsed > 1 &&
    parsed <= 1000
    ? parsed
    : undefined
}

/** Reset the cursor with filters; a cursor from the previous query points at the wrong page. */
export function withFilters<T extends { cursor?: string }>(
  previous: T,
  changes: Partial<T>,
): T {
  return { ...previous, ...changes, cursor: undefined }
}
