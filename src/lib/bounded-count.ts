/** Only format counts from the first page. Never sum reactive pages: inserts and removals can shift rows. */
export function boundedCount(length: number, hasMore: boolean): string {
  return hasMore ? `${length}+` : String(length)
}
