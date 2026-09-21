/**
 * Dashboard aggregates — the bounded, index-backed reads reference 20 puts on
 * one screen. Read-only: nothing in this domain writes, schedules or spends.
 *
 * Three rules hold for every figure below, and they are why this file exists
 * rather than a `filter()` in each query.
 *
 *   EVERY READ IS AN INDEX RANGE. Convex has no count API, so a count is a
 *   bounded read of an exact range. Nothing here post-filters a truncated
 *   page into a number: where a range cannot be expressed by a declared
 *   index, the scan is anchored at the newest row and stops at the window's
 *   start, and it reports `hasMore` when it hit the bound before getting
 *   there — a screen that renders "200+" is telling the truth, one that
 *   renders a silently truncated 200 is not.
 *
 *   EVERY WINDOW IS THE ORG'S. `from`/`to` arrive as instants the
 *   caller derived in the org's IANA zone, and the daily buckets of
 *   `activitySeries` are cut with `localDayKey(…, org.timezone)`. A
 *   dashboard bucketed by the browser's midnight would head one day and
 *   count another's rows.
 *
 *   EVERY FIGURE NAMES ITS ROWS. Each loader's doc comment states exactly
 *   which records it counts, because the acceptance for this screen is that
 *   its numbers reconcile with Contacts and Inbox over the same window.
 */
import type { Doc } from "../_generated/dataModel";
import { COUNT_SCAN_BOUND } from "../lib/limits";
import { assertEpochMs, invalid, localDayKey } from "../lib/validators";
import { v } from "convex/values";

/**
 * How many rows any one range read may touch.
 *
 * It is `lib/limits.COUNT_SCAN_BOUND` and not a number of its own, because
 * the acceptance for this screen is that its figures reconcile with the
 * screen each came from: counting to 200 here while `leads/counts.ts`
 * counted to 100 produced two true figures that disagreed past the smaller
 * cap, with nothing on either screen to explain it.
 */
export const DASHBOARD_SCAN_BOUND = COUNT_SCAN_BOUND;

/**
 * The longest window the aggregates will answer, in days. The range pills top
 * out at three months; a longer one is refused rather than silently clipped,
 * because a chart with a missing tail is worse than an error that says so.
 */
export const MAX_DASHBOARD_RANGE_DAYS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The flame score a "hot" lead carries (PLAN §2 row 20). */
export const HOT_LEAD_SCORE = 3;

export const vBounded = v.object({
  count: v.number(),
  /** The read hit `DASHBOARD_SCAN_BOUND` — `count` is a floor, not a total. */
  hasMore: v.boolean(),
});

export type Bounded = { count: number; hasMore: boolean };

export type Range = { from: number; to: number };

/** The arguments every windowed dashboard query takes, declared once. */
export const vRange = {
  orgId: v.id("orgs"),
  from: v.number(),
  to: v.number(),
};

/**
 * Validate the window before a single row is read. Both bounds are real
 * instants, `to` is not before `from`, and the span fits
 * `MAX_DASHBOARD_RANGE_DAYS` — a hand-edited URL cannot turn the dashboard
 * into a full-table scan.
 */
export function assertRange(from: number, to: number): Range {
  assertEpochMs(from, "from");
  assertEpochMs(to, "to");
  if (to < from) {
    throw invalid("to must not be earlier than from");
  }
  if (to - from > MAX_DASHBOARD_RANGE_DAYS * DAY_MS) {
    throw invalid(
      `range must not be longer than ${MAX_DASHBOARD_RANGE_DAYS} days`,
    );
  }
  return { from, to };
}

/** A page of at most `bound + 1` rows whose length says whether it filled. */
export function filled<T>(rows: readonly T[], bound: number): Bounded {
  return {
    count: Math.min(rows.length, bound),
    hasMore: rows.length > bound,
  };
}

/** One day of the activity chart, keyed by its local `YYYY-MM-DD`. */
export type DayBucket = {
  dayKey: string;
  leadsCreated: number;
  contacted: number;
  replies: number;
};

/**
 * Every local day from `from` to `to` inclusive, in order, with the three
 * series counted into it.
 *
 * Days are cut with `localDayKey` in the ORG's zone. The axis is walked
 * in TWELVE-hour steps, not twenty-four: every local day is at least 23 hours
 * long, so a half-day step lands in each one at least once and a spring-
 * forward day can never be stepped over and left out of the axis — which
 * would silently drop that day's rows when they are added below.
 *
 * Days with nothing in them stay in the series as zeros: a gap in a time axis
 * is a lie about the shape of the line, and the empty case is handled by the
 * chart's empty state, not by a shorter axis.
 */
const AXIS_STEP_MS = DAY_MS / 2;

export function bucketByDay(
  range: Range,
  timezone: string,
  series: {
    leadsCreated: readonly number[];
    contacted: readonly number[];
    replies: readonly number[];
  },
): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  const remember = (dayKey: string): void => {
    if (!buckets.has(dayKey)) {
      buckets.set(dayKey, {
        dayKey,
        leadsCreated: 0,
        contacted: 0,
        replies: 0,
      });
    }
  };
  const maxSteps = MAX_DASHBOARD_RANGE_DAYS * 2 + 2;
  for (
    let at = range.from, step = 0;
    at <= range.to && step <= maxSteps;
    at += AXIS_STEP_MS, step += 1
  ) {
    remember(localDayKey(at, timezone));
  }
  // The window's last instant closes the final day, which the stepped walk
  // stops just short of whenever the span is not a whole number of steps.
  remember(localDayKey(range.to, timezone));

  const add = (at: number, field: keyof Omit<DayBucket, "dayKey">): void => {
    const bucket = buckets.get(localDayKey(at, timezone));
    if (bucket !== undefined) {
      bucket[field] += 1;
    }
  };
  for (const at of series.leadsCreated) add(at, "leadsCreated");
  for (const at of series.contacted) add(at, "contacted");
  for (const at of series.replies) add(at, "replies");

  return [...buckets.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

/** The person as the hot-leads and replies panels name them, or `null`. */
export function leadDisplayName(lead: Doc<"prospects">): string | null {
  const name = [lead.firstName, lead.lastName]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" ")
    .trim();
  return name.length === 0 ? null : name;
}
