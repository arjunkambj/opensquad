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
 *   EVERY WINDOW IS THE WORKSPACE'S. `from`/`to` arrive as instants the
 *   caller derived in the workspace's IANA zone, and the daily buckets of
 *   `activitySeries` are cut with `localDayKey(…, workspace.timezone)`. A
 *   dashboard bucketed by the browser's midnight would head one day and
 *   count another's rows.
 *
 *   EVERY FIGURE NAMES ITS ROWS. Each loader's doc comment states exactly
 *   which records it counts, because the acceptance for this screen is that
 *   its numbers reconcile with Contacts and Inbox over the same window.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { assertEpochMs, invalid, localDayKey } from "../lib/validators";
import { v } from "convex/values";

/**
 * How many rows any one range read may touch. A trial workspace's whole
 * window is smaller than this, so `hasMore` is false in practice — the bound
 * is what keeps the screen honest once that stops being true.
 */
export const DASHBOARD_SCAN_BOUND = 200;

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

/** No rows, and we know it — distinct from a figure we could not read. */
export const NONE: Bounded = { count: 0, hasMore: false };

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

/**
 * Turn a newest-first page of at most `DASHBOARD_SCAN_BOUND + 1` rows into a
 * count over `range`.
 *
 * `hasMore` is true only when the page filled AND its oldest row is still
 * inside the window — that is the case where rows in the window were left
 * unread. A page that filled but already reached past `from` has counted
 * every row in the window, so the figure is exact and says so.
 */
export function countWithin(
  rows: readonly { at: number }[],
  range: Range,
  bound: number = DASHBOARD_SCAN_BOUND,
): Bounded {
  const within = rows.filter(
    (row) => row.at >= range.from && row.at <= range.to,
  ).length;
  const oldest = rows.at(-1);
  const truncated =
    rows.length > bound && oldest !== undefined && oldest.at >= range.from;
  return { count: Math.min(within, bound), hasMore: truncated };
}

/** A page of at most `bound + 1` rows whose length says whether it filled. */
function filled<T>(rows: readonly T[], bound: number): Bounded {
  return {
    count: Math.min(rows.length, bound),
    hasMore: rows.length > bound,
  };
}

/* ------------------------------------------------------------------ */
/* Leads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Researched leads that scored 3, newest first.
 *
 * Exact range on `by_workspaceId_and_scoreKey`: `scoreKey` is the
 * denormalised mirror of `research.aiScore`, so "score 3" implies
 * "researched" and no post-filter is needed. The index does not carry
 * `createdAt`, so the window is applied to the newest-first page — which is
 * exact for a window ending now, and bounded and honest otherwise.
 *
 * Counts: `prospects` where `scoreKey = 3` and `createdAt` is in the window.
 * The same rows Contacts lists under a 3-flame score.
 */
export async function loadHotLeads(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  range: Range,
): Promise<{ rows: Doc<"prospects">[]; bounded: Bounded }> {
  const page = await ctx.db
    .query("prospects")
    .withIndex("by_workspaceId_and_scoreKey", (q) =>
      q.eq("workspaceId", workspaceId).eq("scoreKey", HOT_LEAD_SCORE),
    )
    .order("desc")
    .take(DASHBOARD_SCAN_BOUND + 1);
  const bounded = countWithin(
    page.map((row) => ({ at: row.createdAt })),
    range,
  );
  const rows = page
    .filter((row) => row.createdAt >= range.from && row.createdAt <= range.to)
    .sort((a, b) => b.createdAt - a.createdAt);
  return { rows, bounded };
}

/**
 * Leads created in the window, for the activity chart's daily series.
 *
 * `prospects` has no `(workspaceId, createdAt)` index, so this reads the
 * three `by_workspaceId_and_approval` ranges newest-first instead — three
 * exact index ranges rather than one table scan. Each is bounded separately,
 * so a workspace past the bound reports `hasMore` and the chart says which
 * rows it counted.
 *
 * The integrator should add `prospects.by_workspaceId_and_createdAt`; this
 * becomes one exact range and the bound stops mattering.
 */
const LEAD_APPROVALS = ["pending", "approved", "rejected"] as const;

export async function loadLeadsCreated(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  range: Range,
): Promise<{ createdAt: number[]; bounded: Bounded }> {
  const createdAt: number[] = [];
  let hasMore = false;
  for (const approval of LEAD_APPROVALS) {
    const page = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_approval", (q) =>
        q.eq("workspaceId", workspaceId).eq("approval", approval),
      )
      .order("desc")
      .take(DASHBOARD_SCAN_BOUND + 1);
    const bucket = countWithin(
      page.map((row) => ({ at: row.createdAt })),
      range,
    );
    hasMore = hasMore || bucket.hasMore;
    for (const row of page) {
      if (row.createdAt >= range.from && row.createdAt <= range.to) {
        createdAt.push(row.createdAt);
      }
    }
  }
  return { createdAt, bounded: { count: createdAt.length, hasMore } };
}

/**
 * Leads sitting at stage `interested` whose stage last moved inside the
 * window. Exact range on `by_workspaceId_and_stage_and_updatedAt` — the same
 * index and the same rows as the Contacts "Interested" filter.
 */
export async function countInterested(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  range: Range,
): Promise<Bounded> {
  const page = await ctx.db
    .query("prospects")
    .withIndex("by_workspaceId_and_stage_and_updatedAt", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("stage", "interested")
        .gte("updatedAt", range.from)
        .lte("updatedAt", range.to),
    )
    .take(DASHBOARD_SCAN_BOUND + 1);
  return filled(page, DASHBOARD_SCAN_BOUND);
}

/**
 * Leads waiting for a yes or a no, right now. Not window-scoped: an approval
 * queue is a state, and hiding the ones that arrived last month would hide
 * work. Exact range on `by_workspaceId_and_approval`.
 */
export async function countPendingApprovals(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
): Promise<Bounded> {
  const page = await ctx.db
    .query("prospects")
    .withIndex("by_workspaceId_and_approval", (q) =>
      q.eq("workspaceId", workspaceId).eq("approval", "pending"),
    )
    .take(DASHBOARD_SCAN_BOUND + 1);
  return filled(page, DASHBOARD_SCAN_BOUND);
}

/* ------------------------------------------------------------------ */
/* Outreach and replies                                                */
/* ------------------------------------------------------------------ */

/**
 * Sends the provider ACCEPTED inside the window — `sendAttempts` in state
 * `acknowledged` with `updatedAt` in range, an exact range on
 * `by_workspaceId_and_state_and_updatedAt`.
 *
 * `acknowledged` means accepted, never delivered (PLAN §4.3), and `updatedAt`
 * on such a row is when it was accepted. A follow-up is its own attempt, so
 * the attempt count is emails and the distinct conversation count is people:
 * both are returned, and the stat card shows the second with the first
 * underneath it.
 */
export async function loadAcknowledgedSends(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  range: Range,
): Promise<{
  rows: Doc<"sendAttempts">[];
  emails: Bounded;
  contacted: Bounded;
}> {
  const page = await ctx.db
    .query("sendAttempts")
    .withIndex("by_workspaceId_and_state_and_updatedAt", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("state", "acknowledged")
        .gte("updatedAt", range.from)
        .lte("updatedAt", range.to),
    )
    .take(DASHBOARD_SCAN_BOUND + 1);
  const rows = page.slice(0, DASHBOARD_SCAN_BOUND);
  const conversations = new Set(rows.map((row) => row.conversationId));
  const hasMore = page.length > DASHBOARD_SCAN_BOUND;
  return {
    rows,
    emails: filled(page, DASHBOARD_SCAN_BOUND),
    contacted: { count: conversations.size, hasMore },
  };
}

const CONVERSATION_STATES = ["open", "closed", "unassigned"] as const;

/**
 * Threads a real reply landed in during the window — `conversations` whose
 * `lastInboundAt` is in range, newest reply first. These are exactly the rows
 * the Inbox lists as having been replied to.
 *
 * `conversations` has no `lastInboundAt` index, so this walks the three
 * `by_workspaceId_and_state_and_lastMessageAt` ranges from `from` forward.
 * That is sound rather than convenient: `lastMessageAt` is bumped by every
 * message, inbound included, so `lastMessageAt >= lastInboundAt` always and
 * no thread whose reply is in the window can sort below `from`. There is no
 * upper bound on the scan for the same reason — a thread we answered after
 * the window still had its reply inside it.
 *
 * The integrator should add `conversations.by_workspaceId_and_lastInboundAt`;
 * this becomes one exact range.
 */
export async function loadRepliedConversations(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  range: Range,
): Promise<{ rows: Doc<"conversations">[]; bounded: Bounded }> {
  const rows: Doc<"conversations">[] = [];
  let hasMore = false;
  for (const state of CONVERSATION_STATES) {
    const page = await ctx.db
      .query("conversations")
      .withIndex("by_workspaceId_and_state_and_lastMessageAt", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .eq("state", state)
          .gte("lastMessageAt", range.from),
      )
      .order("desc")
      .take(DASHBOARD_SCAN_BOUND + 1);
    hasMore = hasMore || page.length > DASHBOARD_SCAN_BOUND;
    for (const row of page) {
      const at = row.lastInboundAt;
      if (at !== undefined && at >= range.from && at <= range.to) {
        rows.push(row);
      }
    }
  }
  rows.sort((a, b) => (b.lastInboundAt ?? 0) - (a.lastInboundAt ?? 0));
  return {
    rows,
    bounded: { count: Math.min(rows.length, DASHBOARD_SCAN_BOUND), hasMore },
  };
}

/* ------------------------------------------------------------------ */
/* Meetings                                                            */
/* ------------------------------------------------------------------ */

/**
 * Meetings, counted the way PLAN §9.5 defines them: CONFIRMED bookings only,
 * whose meeting time falls inside the window. A confirmed booking always
 * carries `startsAt`, so this is an exact range on
 * `by_workspaceId_and_state_and_startsAt`.
 *
 * A booking link in an email and a model reading agreement out of a reply are
 * both proposals — they are counted separately, below, and never here.
 */
export async function countConfirmedMeetings(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  range: Range,
): Promise<Bounded> {
  const page = await ctx.db
    .query("bookings")
    .withIndex("by_workspaceId_and_state_and_startsAt", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("state", "confirmed")
        .gte("startsAt", range.from)
        .lte("startsAt", range.to),
    )
    .take(DASHBOARD_SCAN_BOUND + 1);
  return filled(page, DASHBOARD_SCAN_BOUND);
}

/**
 * Proposals still open, right now. Not window-scoped: a proposal has no
 * agreed time to place it in a window — that is the whole difference between
 * it and a meeting — so this is the live count of `proposed` bookings.
 */
export async function countProposedMeetings(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
): Promise<Bounded> {
  const page = await ctx.db
    .query("bookings")
    .withIndex("by_workspaceId_and_state_and_startsAt", (q) =>
      q.eq("workspaceId", workspaceId).eq("state", "proposed"),
    )
    .take(DASHBOARD_SCAN_BOUND + 1);
  return filled(page, DASHBOARD_SCAN_BOUND);
}

/* ------------------------------------------------------------------ */
/* Daily buckets                                                       */
/* ------------------------------------------------------------------ */

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
 * Days are cut with `localDayKey` in the WORKSPACE's zone. The axis is walked
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
