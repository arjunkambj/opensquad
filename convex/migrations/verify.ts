/**
 * The read-only precondition for MIGRATION.md §6.6 — "prove suppression
 * works, not just exists".
 *
 * §6.6 itself is a live check the integrator runs: a real send preflight to a
 * suppressed address, refused with the suppression reason. That check can
 * only mean anything if every kept suppression still points at an org
 * that exists — an opt-out owned by a deleted org is matched by no
 * preflight and silently suppresses nothing, which is the exact failure the
 * clean-slate path's keep-list exists to prevent. This query proves that
 * precondition, with counts, and names the rows that fail it.
 *
 * It is a query: it reads and asserts, it never repairs. A dangling
 * suppression is a decision for the owner and the integrator, not something a
 * verification step may quietly delete.
 */
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Bounded so the check always fits one transaction's read budget. A count
 * that hits the cap is reported as `truncated`, and `ok` is then false: a
 * partial scan is not a proof.
 */
const SCAN_CAP = 4096;

/** Ids listed in full in the result; the count is always exact for the scan. */
const MAX_REPORTED_IDS = 100;

export const suppressionOwnership = internalQuery({
  args: {},
  returns: v.object({
    /** True only when the whole table was scanned and nothing dangles. */
    ok: v.boolean(),
    suppressionsScanned: v.number(),
    orgsScanned: v.number(),
    /** Suppressions whose `orgId` resolves to an existing org. */
    ownedByLiveOrg: v.number(),
    /** Suppressions whose `orgId` no longer resolves. */
    orphaned: v.number(),
    orphanedIds: v.array(v.id("suppressions")),
    orphanedIdsTruncated: v.boolean(),
    /**
     * Distinct orgs that hold at least one suppression — the set §6.6's
     * live preflight check has to cover, one address each.
     */
    orgsWithSuppressions: v.number(),
    /** A scan that hit `SCAN_CAP`; the answer is partial, so `ok` is false. */
    truncated: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const suppressions = await ctx.db.query("suppressions").take(SCAN_CAP + 1);
    const orgs = await ctx.db.query("orgs").take(SCAN_CAP + 1);

    const truncated: string[] = [];
    if (suppressions.length > SCAN_CAP) {
      truncated.push("suppressions");
    }
    if (orgs.length > SCAN_CAP) {
      truncated.push("orgs");
    }

    const liveOrgs = new Set<string>(
      orgs.slice(0, SCAN_CAP).map((org) => org._id),
    );

    const orphanedIds: Id<"suppressions">[] = [];
    const holders = new Set<string>();
    let orphaned = 0;
    let ownedByLiveOrg = 0;

    for (const suppression of suppressions.slice(0, SCAN_CAP)) {
      if (liveOrgs.has(suppression.orgId)) {
        ownedByLiveOrg += 1;
        holders.add(suppression.orgId);
        continue;
      }
      orphaned += 1;
      if (orphanedIds.length < MAX_REPORTED_IDS) {
        orphanedIds.push(suppression._id);
      }
    }

    return {
      ok: orphaned === 0 && truncated.length === 0,
      suppressionsScanned: Math.min(suppressions.length, SCAN_CAP),
      orgsScanned: Math.min(orgs.length, SCAN_CAP),
      ownedByLiveOrg,
      orphaned,
      orphanedIds,
      orphanedIdsTruncated: orphaned > orphanedIds.length,
      orgsWithSuppressions: holders.size,
      truncated,
    };
  },
});
