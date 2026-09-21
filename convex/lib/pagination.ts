/**
 * The one paged-list envelope: the rows, an opaque `cursor` that is `null` at
 * the end, and `hasMore` for the bounded-count rule (`src/lib/bounded-count.ts`).
 */
export function paged<R>(
  result: { isDone: boolean; continueCursor: string },
  items: R[],
): { items: R[]; cursor: string | null; hasMore: boolean } {
  return {
    items,
    cursor: result.isDone ? null : result.continueCursor,
    hasMore: !result.isDone,
  };
}
