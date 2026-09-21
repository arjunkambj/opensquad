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
import {
  DASHBOARD_SCAN_BOUND,
  HOT_LEAD_SCORE,
  filled,
  type Bounded,
  type Range,
} from "./model";

/**
 * When a lead BECAME hot, or `null` if it never did.
 *
 * `researchedAt` is written by research and lives inside the `researched`
 * member of the `research` union — which is also why `scoreKey` exists as a
 * denormalised index key, since Convex cannot index into a union member.
 */
function scoredAt(lead: Doc<"prospects">): number | null {
  return lead.research.status === "researched" ? lead.research.researchedAt : null;
}

/**
 * Researched leads that scored 3, most recently SCORED first.
 *
 * Exact range on `by_orgId_and_scoreKey`: `scoreKey` is the denormalised
 * mirror of `research.aiScore`, so "score 3" implies "researched" and no
 * post-filter is needed to find them.
 *
 * The window is `researchedAt`, NOT `createdAt`. A lead becomes hot when it
 * is scored, and sourcing and research are separate steps that can be weeks
 * apart — a lead sourced two months ago and scored yesterday belongs in "Last
 * 7 days", and windowing it on its creation hid it from this panel while
 * Contacts listed it under the same 3-flame filter. The acceptance for this
 * screen is that the two agree.
 *
 * Counts: `prospects` where `scoreKey = 3` and `research.researchedAt` is in
 * the window. `researchedAt` is not an index key, so the page is anchored at
 * the newest-CREATED scored-3 lead and `hasMore` is true whenever the page
 * filled — with no ordering by `researchedAt` to lean on, a full page cannot
 * prove it saw every lead scored in the window, and saying so is the honest
 * answer.
 */
export async function loadHotLeads(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  range: Range,
): Promise<{ rows: Doc<"prospects">[]; bounded: Bounded }> {
  const page = await ctx.db
    .query("prospects")
    .withIndex("by_orgId_and_scoreKey", (q) =>
      q.eq("orgId", orgId).eq("scoreKey", HOT_LEAD_SCORE),
    )
    .order("desc")
    .take(DASHBOARD_SCAN_BOUND + 1);
  const within: { lead: Doc<"prospects">; at: number }[] = [];
  for (const lead of page) {
    const at = scoredAt(lead);
    if (at !== null && at >= range.from && at <= range.to) {
      within.push({ lead, at });
    }
  }
  within.sort((a, b) => b.at - a.at);
  return {
    rows: within.map((entry) => entry.lead),
    bounded: {
      count: Math.min(within.length, DASHBOARD_SCAN_BOUND),
      hasMore: page.length > DASHBOARD_SCAN_BOUND,
    },
  };
}

/**
 * Leads created in the window, for the activity chart's daily series.
 *
 * ONE exact range on `by_orgId_and_createdAt` — the index the schema declares
 * for precisely this read. It used to fan out across the three
 * `by_orgId_and_approval` ranges to work around an index that did not exist
 * yet; it does now, so the workaround is gone: one range, no partition to
 * keep total, and a bound that means what it says.
 *
 * Counts: `prospects` where `createdAt` is in the window — every lead,
 * whatever its approval or stage.
 */
export async function loadLeadsCreated(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  range: Range,
): Promise<{ createdAt: number[]; bounded: Bounded }> {
  const page = await ctx.db
    .query("prospects")
    .withIndex("by_orgId_and_createdAt", (q) =>
      q.eq("orgId", orgId).gte("createdAt", range.from).lte("createdAt", range.to),
    )
    .order("desc")
    .take(DASHBOARD_SCAN_BOUND + 1);
  return {
    createdAt: page
      .slice(0, DASHBOARD_SCAN_BOUND)
      .map((row) => row.createdAt),
    bounded: filled(page, DASHBOARD_SCAN_BOUND),
  };
}

/**
 * Leads sitting at stage `interested` whose stage last moved inside the
 * window. Exact range on `by_orgId_and_stage_and_updatedAt` — the same
 * index and the same rows as the Contacts "Interested" filter.
 */
export async function countInterested(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  range: Range,
): Promise<Bounded> {
  const page = await ctx.db
    .query("prospects")
    .withIndex("by_orgId_and_stage_and_updatedAt", (q) =>
      q
        .eq("orgId", orgId)
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
 * work. Exact range on `by_orgId_and_approval`.
 */
export async function countPendingApprovals(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
): Promise<Bounded> {
  const page = await ctx.db
    .query("prospects")
    .withIndex("by_orgId_and_approval", (q) =>
      q.eq("orgId", orgId).eq("approval", "pending"),
    )
    .take(DASHBOARD_SCAN_BOUND + 1);
  return filled(page, DASHBOARD_SCAN_BOUND);
}
