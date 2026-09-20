/**
 * What the dashboard reads out of `prospects`.
 *
 * One exact index range per figure, each bounded and each stating which rows
 * it counts — the Contacts screen can be filtered to the same set, which is
 * the acceptance for this screen. `model.ts` holds the bounds and the rules
 * they follow.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { LeadApproval } from "../lib/validators";
import {
  DASHBOARD_SCAN_BOUND,
  HOT_LEAD_SCORE,
  countWithin,
  filled,
  type Bounded,
  type Range,
} from "./model";

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
 * Every approval value, as a total map over the union: an approval added to
 * `vLeadApproval` fails this build until it is listed here, which is what
 * stops the partition below quietly losing a bucket of leads.
 */
const APPROVAL_PARTITION = {
  pending: true,
  approved: true,
  rejected: true,
} satisfies Record<LeadApproval, true>;

const LEAD_APPROVALS = Object.keys(APPROVAL_PARTITION) as LeadApproval[];

/**
 * Leads created in the window, for the activity chart's daily series.
 *
 * `prospects` has no `(workspaceId, createdAt)` index, so this reads the
 * three `by_workspaceId_and_approval` ranges newest-first instead — three
 * exact index ranges rather than one table scan, and together they partition
 * the table, so no lead is missed. Each is bounded separately, so a workspace
 * past the bound reports `hasMore` and the chart says so under the plot.
 *
 * The integrator should add `prospects.by_workspaceId_and_createdAt`; this
 * becomes one exact range and the bound stops mattering.
 */
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
