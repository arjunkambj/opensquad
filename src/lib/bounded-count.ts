/**
 * The one count formatter in this app.
 *
 * No Convex query in this codebase returns a total — every list returns
 * `{ items, cursor, hasMore }` and `plan/architecture.md` §5 forbids exact
 * unlimited counters. So a number on screen is either a stored field the
 * backend maintains or this: exact when the
 * whole set fit on one page, and explicitly bounded otherwise.
 *
 * Two rules go with it, and they are the reason this is a function rather than
 * an inline template string at each call site:
 *
 * 1. **Only ever call it with a FIRST page.** A count taken from page two
 *    counts page two. A paged view shows which page it is on instead.
 * 2. **Never sum the pages fetched so far.** A live Convex subscription
 *    re-renders the list underneath and the running total drifts away from
 *    anything true.
 *
 * With the default limit of 25 an over-full column reads `25+`, not `50+`:
 * `25+` from a 25-row page is honest, and `50+` from a 25-row page is not.
 */
export function boundedCount(length: number, hasMore: boolean): string {
  return hasMore ? `${length}+` : String(length)
}
