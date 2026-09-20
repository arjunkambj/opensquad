/**
 * Prospects — the lead/CRM entity (`prospects` is the backend name; the UI
 * says Leads). Architecture §4.3/§4.5.
 *
 * TWO HALVES, one file. P21 ships the PIPELINE-WRITER half — the internal
 * mutations a workflow calls (`importCampaignProspects`, `applyResearchOutcome`,
 * `setContactNeeded`, `applyContactEnrichment`, `markDraftReady`). P19 ships
 * the operator-facing CRM surface on the same rows — `search`, `updateStage`,
 * `assign`, `setNextAction`, `addNote` — plus the `markSendAccepted` /
 * `markReplied` derivations the send and inbox boundaries call. The booking
 * lifecycle itself lives in `convex/bookings.ts`; the append-only history
 * write path lives in `convex/leadEvents.ts`.
 *
 * Four rules govern every write below, and none of them is negotiable:
 *
 *   One lead per (campaignId, canonicalDomain). The index is a LOOKUP, not a
 *   uniqueness constraint, so `importCampaignProspects` reads the campaign's
 *   whole prospect range in the SAME transaction it inserts into. A concurrent
 *   insert of the same domain invalidates that read set and one of the two
 *   transactions retries under OCC — which is what turns the lookup into the
 *   constraint the schema documents.
 *
 *   Provenance merges, never overwrites. Re-discovering a company appends only
 *   the source refs whose (source, provider record id | profile URL) identity
 *   is new. Nothing a second source says can erase what the first one found.
 *
 *   A stage never regresses, and a terminal stage is never entered or left
 *   automatically. Every transition compares `salesStageRank` and refuses
 *   anything at or below the current rank; `won`/`lost` are human calls and
 *   P19 owns the path into them.
 *
 *   `lastContactedAt` comes ONLY from a send acceptance and `lastReplyAt` ONLY
 *   from a verified inbound reply. Nothing in this module writes either —
 *   drafting a message is not contacting anyone.
 *
 * Every business update and its `leadEvents` row are written in ONE
 * transaction (§8), so the history can never disagree with the lead.
 */
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  getActiveMembership,
  requireWorkspaceEditor,
  requireWorkspaceMember,
} from "./lib/auth";
import { vEvidenceDoc } from "./evidence";
import {
  appendLeadEvent,
  findLeadEventByOperationKey,
  vLeadEventDoc,
} from "./leadEvents";
import { vBookingDoc } from "./bookings";
import {
  advancedStage,
  assertEpochMs,
  assertExpectedVersion,
  assertNextAction,
  assertProspectContact,
  assertSourceRefs,
  boundedLimit,
  boundedString,
  domainError,
  invalid,
  normalizeCanonicalDomain,
  vNextAction,
  vProspectCandidate,
  vProspectContact,
  vQualification,
  vSalesStage,
  DEFAULT_LIST_LIMIT,
  EPOCH_MS_MIN,
  LEAD_EVENT_NOTE_MAX_LENGTH,
  MAX_LIST_LIMIT,
  PROSPECT_COMPANY_NAME_MAX_LENGTH,
  PROSPECT_FIT_REASON_MAX_LENGTH,
  PROSPECT_IMPORT_CANDIDATES_MAX,
  PROSPECT_SOURCE_REFS_MAX,
  PROSPECT_STAGE_REASON_MAX_LENGTH,
} from "./lib/validators";
import type {
  ProspectCandidate,
  ProspectSourceRef,
  Qualification,
  SalesStage,
} from "./lib/validators";
import { prospectFields } from "./schema";

export const vProspectDoc = v.object({
  _id: v.id("prospects"),
  _creationTime: v.number(),
  ...prospectFields,
});

/** How many campaign rows the importer reads to build its dedupe map. A
 *  campaign's `leadLimit` is 1..5, so anything near this bound already means
 *  every further candidate is refused by the ceiling. */
const CAMPAIGN_PROSPECT_SCAN_LIMIT = 64;

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

const vListPage = v.object({
  items: v.array(vProspectDoc),
  cursor: v.union(v.string(), v.null()),
  hasMore: v.boolean(),
});

type ListPageArgs = {
  workspaceId: Id<"workspaces">;
  campaignId?: Id<"campaigns">;
  salesStage?: SalesStage;
  owner?: string;
  dueRange?: { from?: number; to?: number };
  unscheduled?: boolean;
  cursor?: string | null;
  limit?: number;
};

/**
 * Every list mode is an exact index range — never a post-filtered page
 * (§5/§4.3). The modes and the index behind each:
 *
 *   due-action (`dueRange`, optionally `owner`): soonest-due first on the
 *   two `nextActionDueAt` indexes. A bounded range covers the
 *   "overdue"/"this week" views; rows with NO due time cannot satisfy a
 *   range bound, so this mode never hides them behind a page that looks
 *   filtered — they appear in the owner and default modes instead, sorted
 *   together (the explicit "unscheduled" state, §4.3).
 *
 *   owner (`owner` alone): one member's leads on
 *   `by_workspaceId_and_ownerIdentityKey_and_nextActionDueAt`, soonest first.
 *
 *   pipeline (`campaignId` and/or `salesStage`): newest-change first on the
 *   stage indexes — the unfiltered fallback sorts the whole workspace by
 *   next-action due time, most-recently-scheduled first.
 *
 * Unsupported combinations (owner + stage, a due range + a stage, …) REFUSE
 * rather than silently post-filter: the schema declares an index per enabled
 * combination, and a filter pair with no index is added deliberately or not
 * at all.
 */
async function listPage(
  ctx: QueryCtx,
  args: ListPageArgs,
): Promise<typeof vListPage.type> {
  const paginate = {
    numItems: boundedLimit(args.limit),
    cursor: args.cursor ?? null,
  };

  if (args.unscheduled === true) {
    if (
      args.dueRange !== undefined ||
      args.salesStage !== undefined ||
      args.campaignId !== undefined
    ) {
      throw invalid(
        "unscheduled listing cannot combine with dueRange, salesStage or campaignId — no index supports that combination",
      );
    }
    // `undefined` sorts below every bound on these indexes, and every stored
    // `nextActionDueAt` is ≥ EPOCH_MS_MIN, so `lt(EPOCH_MS_MIN)` names exactly
    // the rows with no due time — the "unscheduled" state as a first-class
    // slice rather than a sentinel date the reader has to know about.
    const owner = args.owner;
    const result =
      owner !== undefined
        ? await ctx.db
            .query("prospects")
            .withIndex(
              "by_workspaceId_and_ownerIdentityKey_and_nextActionDueAt",
              (q) =>
                q
                  .eq("workspaceId", args.workspaceId)
                  .eq("ownerIdentityKey", owner)
                  .lt("nextActionDueAt", EPOCH_MS_MIN),
            )
            .order("desc")
            .paginate(paginate)
        : await ctx.db
            .query("prospects")
            .withIndex("by_workspaceId_and_nextActionDueAt", (q) =>
              q
                .eq("workspaceId", args.workspaceId)
                .lt("nextActionDueAt", EPOCH_MS_MIN),
            )
            .order("desc")
            .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  if (args.dueRange !== undefined) {
    if (args.salesStage !== undefined || args.campaignId !== undefined) {
      throw invalid(
        "due-action listing cannot combine with salesStage or campaignId — no index supports that combination",
      );
    }
    const from =
      args.dueRange.from === undefined
        ? undefined
        : assertEpochMs(args.dueRange.from, "dueRange.from");
    const to =
      args.dueRange.to === undefined
        ? undefined
        : assertEpochMs(args.dueRange.to, "dueRange.to");
    if (from !== undefined && to !== undefined && from > to) {
      throw invalid("dueRange.from must not be after dueRange.to");
    }
    // A lead with NO `nextActionDueAt` stores `undefined` in the index, which
    // sorts below every bound — `lte(to)` alone would return undated leads as
    // "overdue". The lower bound is therefore always present: the caller's
    // `from`, or 0 meaning "has a due date at all".
    const lower = from ?? 0;
    const owner = args.owner;
    const result =
      owner !== undefined
        ? await ctx.db
            .query("prospects")
            .withIndex(
              "by_workspaceId_and_ownerIdentityKey_and_nextActionDueAt",
              (q) => {
                const scoped = q
                  .eq("workspaceId", args.workspaceId)
                  .eq("ownerIdentityKey", owner)
                  .gte("nextActionDueAt", lower);
                return to === undefined
                  ? scoped
                  : scoped.lte("nextActionDueAt", to);
              },
            )
            .order("asc")
            .paginate(paginate)
        : await ctx.db
            .query("prospects")
            .withIndex("by_workspaceId_and_nextActionDueAt", (q) => {
              const scoped = q
                .eq("workspaceId", args.workspaceId)
                .gte("nextActionDueAt", lower);
              return to === undefined
                ? scoped
                : scoped.lte("nextActionDueAt", to);
            })
            .order("asc")
            .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  if (args.owner !== undefined) {
    if (args.salesStage !== undefined || args.campaignId !== undefined) {
      throw invalid(
        "owner listing cannot combine with salesStage or campaignId — no index supports that combination",
      );
    }
    const owner = args.owner;
    const result = await ctx.db
      .query("prospects")
      .withIndex(
        "by_workspaceId_and_ownerIdentityKey_and_nextActionDueAt",
        (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("ownerIdentityKey", owner),
      )
      .order("asc")
      .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  const campaignId = args.campaignId;
  const salesStage = args.salesStage;
  const result =
    campaignId !== undefined
      ? await ctx.db
          .query("prospects")
          .withIndex("by_workspaceId_and_campaignId_and_salesStage", (q) => {
            const scoped = q
              .eq("workspaceId", args.workspaceId)
              .eq("campaignId", campaignId);
            return salesStage === undefined
              ? scoped
              : scoped.eq("salesStage", salesStage);
          })
          .order("desc")
          .paginate(paginate)
      : salesStage !== undefined
        ? await ctx.db
            .query("prospects")
            .withIndex("by_workspaceId_and_salesStage_and_updatedAt", (q) =>
              q
                .eq("workspaceId", args.workspaceId)
                .eq("salesStage", salesStage),
            )
            .order("desc")
            .paginate(paginate)
        : await ctx.db
            .query("prospects")
            .withIndex("by_workspaceId_and_nextActionDueAt", (q) =>
              q.eq("workspaceId", args.workspaceId),
            )
            .order("desc")
            .paginate(paginate);
  return {
    items: result.page,
    cursor: result.isDone ? null : result.continueCursor,
    hasMore: !result.isDone,
  };
}

/** Leads in one workspace — see `listPage` for the supported index modes. */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    campaignId: v.optional(v.id("campaigns")),
    salesStage: v.optional(vSalesStage),
    /** Filter to one member's leads (`ownerIdentityKey`). */
    owner: v.optional(v.string()),
    /** Due-action mode: a bounded `nextActionDueAt` range (either bound may
     *  be omitted; `{}` lists every lead that HAS a due date — undated rows
     *  never appear in this mode). */
    dueRange: v.optional(
      v.object({
        from: v.optional(v.number()),
        to: v.optional(v.number()),
      }),
    ),
    /** The complementary due-mode slice: leads with NO `nextActionDueAt`,
     *  newest first. Combines with `owner` only — a due-state filter is not a
     *  pipeline filter. */
    unscheduled: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: vListPage,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await listPage(ctx, args);
  },
});

/**
 * How many leads have a next action due at or before now — the "Overdue next
 * actions" count the CRM home's attention block renders (J2). Bounded at
 * `MAX_LIST_LIMIT` like every workspace count: `hasMore` means the number is
 * the bound, not the total, and the UI renders "50+". Undated leads can never
 * satisfy the range, so they can never inflate it either.
 */
export const countOverdue = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({
    count: v.number(),
    hasMore: v.boolean(),
    bound: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const now = Date.now();
    const rows = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_nextActionDueAt", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .gte("nextActionDueAt", 0)
          .lte("nextActionDueAt", now),
      )
      .take(MAX_LIST_LIMIT + 1);
    return {
      count: Math.min(rows.length, MAX_LIST_LIMIT),
      hasMore: rows.length > MAX_LIST_LIMIT,
      bound: MAX_LIST_LIMIT,
    };
  },
});

/**
 * Company-name search through the declared `search_company_name` index.
 * Equality filters (`salesStage`, `campaignId`, `owner`) are applied INSIDE
 * `withSearchIndex` — the only fields the index declares — and pagination
 * follows the engine's relevance order. Empty text falls back to the ordinary
 * list, so the picker never has to switch calls (§4.3).
 */
export const search = query({
  args: {
    workspaceId: v.id("workspaces"),
    text: v.string(),
    salesStage: v.optional(vSalesStage),
    campaignId: v.optional(v.id("campaigns")),
    owner: v.optional(v.string()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: vListPage,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const text = boundedString(args.text, "text", {
      max: PROSPECT_COMPANY_NAME_MAX_LENGTH,
    }).trim();
    if (text === "") {
      return await listPage(ctx, args);
    }
    const result = await ctx.db
      .query("prospects")
      .withSearchIndex("search_company_name", (q) => {
        let scoped = q
          .search("companyName", text)
          .eq("workspaceId", args.workspaceId);
        if (args.salesStage !== undefined) {
          scoped = scoped.eq("salesStage", args.salesStage);
        }
        if (args.campaignId !== undefined) {
          scoped = scoped.eq("campaignId", args.campaignId);
        }
        if (args.owner !== undefined) {
          scoped = scoped.eq("ownerIdentityKey", args.owner);
        }
        return scoped;
      })
      .paginate({
        numItems: boundedLimit(args.limit),
        cursor: args.cursor ?? null,
      });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});

/**
 * One lead with the evidence behind it, its bookings and the history that
 * produced it. A row in another workspace is NOT_FOUND, never FORBIDDEN.
 */
export const getDetail = query({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
  },
  returns: v.object({
    prospect: vProspectDoc,
    evidence: v.array(vEvidenceDoc),
    events: v.array(vLeadEventDoc),
    bookings: v.array(vBookingDoc),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const prospect = await ctx.db.get("prospects", args.prospectId);
    if (prospect === null || prospect.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "prospect not found");
    }
    const evidence = await ctx.db
      .query("evidence")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", args.prospectId),
      )
      .order("desc")
      .take(DEFAULT_LIST_LIMIT);
    const events = await ctx.db
      .query("leadEvents")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", args.prospectId),
      )
      .order("desc")
      .take(DEFAULT_LIST_LIMIT);
    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", args.prospectId),
      )
      .order("desc")
      .take(DEFAULT_LIST_LIMIT);
    return { prospect, evidence, events, bookings };
  },
});

/* ------------------------------------------------------------------ */
/* Shared write helpers                                                */
/* ------------------------------------------------------------------ */

/** Load a prospect for an internal pipeline write, scoped to its workspace. */
async function loadPipelineTarget(
  ctx: MutationCtx,
  prospectId: Id<"prospects">,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"prospects">> {
  const prospect = await ctx.db.get("prospects", prospectId);
  if (prospect === null || prospect.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "prospect not found");
  }
  return prospect;
}

/** Re-read a patched prospect; the row always exists inside the transaction
 *  that just wrote it, so absence is a defect rather than a business case. */
async function reread(
  ctx: MutationCtx,
  prospectId: Id<"prospects">,
): Promise<Doc<"prospects">> {
  const row = await ctx.db.get("prospects", prospectId);
  if (row === null) {
    throw domainError("NOT_FOUND", "prospect not found after write");
  }
  return row;
}

/**
 * The identityKey a newly imported lead is owned by. `prospects.ownerIdentityKey`
 * has always documented "must resolve to an ACTIVE membership" and nothing has
 * ever enforced it. The campaign's creator owns the leads their campaign
 * produced; if that membership has since been revoked the workspace owner takes
 * them; if neither is active the import refuses rather than writing a lead
 * nobody can act on.
 */
async function resolveOwnerIdentityKey(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  campaign: Doc<"campaigns">,
): Promise<string> {
  const creator = await getActiveMembership(
    ctx,
    workspace._id,
    campaign.createdBy,
  );
  if (creator !== null) return creator.identityKey;
  const owner = await getActiveMembership(
    ctx,
    workspace._id,
    workspace.ownerIdentityKey,
  );
  if (owner !== null) return owner.identityKey;
  throw domainError(
    "CONFLICT",
    "neither the campaign creator nor the workspace owner holds an active membership",
  );
}

/* ------------------------------------------------------------------ */
/* Import — the discover seam                                          */
/* ------------------------------------------------------------------ */

/**
 * Persist a batch of candidate companies as leads on a confirmed campaign.
 *
 * This is the seam lead sourcing plugs into: the importer, the `leadLimit`
 * ceiling, the canonical-domain dedupe and the provenance merge. A candidate
 * array from any source imports identically.
 *
 * Per-candidate refusals are COLLECTED, never thrown. One malformed candidate
 * in a batch of five must not cost the other four: an inadmissible URL, a
 * source the campaign never confirmed, an anonymous company and a batch that
 * has reached the campaign's `leadLimit` each land in `skipped` with a stated
 * reason.
 */
export const importCampaignProspects = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    candidates: v.array(vProspectCandidate),
  },
  returns: v.object({
    prospectIds: v.array(v.id("prospects")),
    created: v.number(),
    merged: v.number(),
    skipped: v.array(
      v.object({ companyName: v.string(), reason: v.string() }),
    ),
  }),
  handler: async (ctx, args) => {
    if (args.candidates.length > PROSPECT_IMPORT_CANDIDATES_MAX) {
      throw invalid(
        `candidates allows at most ${PROSPECT_IMPORT_CANDIDATES_MAX} entries`,
      );
    }
    const campaign = await ctx.db.get("campaigns", args.campaignId);
    if (campaign === null) {
      throw domainError("NOT_FOUND", "campaign not found");
    }
    if (campaign.status !== "active") {
      throw domainError(
        "CONFLICT",
        `campaign is ${campaign.status}; no lead may be imported`,
      );
    }
    const workspace = await ctx.db.get("workspaces", campaign.workspaceId);
    if (workspace === null) {
      throw domainError("NOT_FOUND", "workspace not found");
    }
    const ownerIdentityKey = await resolveOwnerIdentityKey(
      ctx,
      workspace,
      campaign,
    );

    // ONE range read over the campaign's whole prospect range. It is both the
    // dedupe map and the ceiling count, and registering that range in this
    // transaction's read set is what makes a concurrent insert of the same
    // domain conflict instead of duplicating.
    const existingRows = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_campaignId_and_canonicalDomain", (q) =>
        q
          .eq("workspaceId", campaign.workspaceId)
          .eq("campaignId", campaign._id),
      )
      .take(CAMPAIGN_PROSPECT_SCAN_LIMIT);
    const byDomain = new Map<string, Doc<"prospects">>();
    for (const row of existingRows) {
      byDomain.set(row.canonicalDomain, row);
    }

    const prospectIds: Id<"prospects">[] = [];
    const skipped: { companyName: string; reason: string }[] = [];
    let created = 0;
    let merged = 0;
    const now = Date.now();

    for (const candidate of args.candidates) {
      const label = candidateLabel(candidate);
      let admitted: {
        companyName: string;
        canonicalDomain: string;
        sourceRefs: ProspectSourceRef[];
        fitReason: string;
        contact: ReturnType<typeof assertProspectContact> | undefined;
      };
      try {
        admitted = admitCandidate(candidate);
      } catch (error) {
        skipped.push({ companyName: label, reason: refusalOf(error) });
        continue;
      }

      const existing = byDomain.get(admitted.canonicalDomain);
      if (existing !== undefined) {
        const mergedRefs = mergeSourceRefs(
          existing.sourceRefs,
          admitted.sourceRefs,
        );
        if (
          mergedRefs.length === existing.sourceRefs.length &&
          (existing.contact !== undefined || admitted.contact === undefined)
        ) {
          // Nothing new to record. Still a merge, not a skip: the candidate
          // named a lead this campaign already holds.
          merged += 1;
          prospectIds.push(existing._id);
          continue;
        }
        const version = existing.version + 1;
        await ctx.db.patch("prospects", existing._id, {
          sourceRefs: mergedRefs,
          version,
          updatedAt: now,
          ...(existing.contact === undefined && admitted.contact !== undefined
            ? { contact: admitted.contact }
            : {}),
        });
        await appendLeadEvent(ctx, {
          workspaceId: existing.workspaceId,
          prospectId: existing._id,
          kind: "note_added",
          summary: `Re-discovered ${existing.canonicalDomain}; provenance merged (${mergedRefs.length} source references)`,
          // Source refs only ever grow, so the resulting count is a stable
          // identity for THIS merge step and a replay dedupes on it.
          operationKey: `prospect:${existing._id}:merge:${mergedRefs.length}`,
          details: {
            note: `Merged provenance from ${admitted.sourceRefs
              .map((ref) => ref.source)
              .join(", ")}`,
          },
        });
        const refreshed = await reread(ctx, existing._id);
        byDomain.set(admitted.canonicalDomain, refreshed);
        merged += 1;
        prospectIds.push(existing._id);
        continue;
      }

      if (byDomain.size >= campaign.leadLimit) {
        skipped.push({
          companyName: label,
          reason: `campaign leadLimit ${campaign.leadLimit} reached`,
        });
        continue;
      }

      const prospectId = await ctx.db.insert("prospects", {
        workspaceId: campaign.workspaceId,
        campaignId: campaign._id,
        companyName: admitted.companyName,
        canonicalDomain: admitted.canonicalDomain,
        sourceRefs: admitted.sourceRefs,
        // Fit is decided by research, never by discovery. A candidate arrives
        // `pending` and stays there until evidence moves it.
        qualification: "pending" as const,
        fitReason: admitted.fitReason,
        salesStage: "discovered" as const,
        ownerIdentityKey,
        version: 1,
        createdAt: now,
        updatedAt: now,
        ...(admitted.contact !== undefined ? { contact: admitted.contact } : {}),
      });
      await appendLeadEvent(ctx, {
        workspaceId: campaign.workspaceId,
        prospectId,
        kind: "stage_changed",
        summary: `Discovered ${admitted.companyName} (${admitted.canonicalDomain})`,
        operationKey: `prospect:${prospectId}:discovered`,
        toStage: "discovered",
      });
      byDomain.set(admitted.canonicalDomain, await reread(ctx, prospectId));
      created += 1;
      prospectIds.push(prospectId);
    }

    return { prospectIds, created, merged, skipped };
  },
});

/** A bounded label for a refused candidate — never the raw payload. */
function candidateLabel(candidate: ProspectCandidate): string {
  const name =
    typeof candidate.companyName === "string" ? candidate.companyName.trim() : "";
  return (name === "" ? "(anonymous)" : name).slice(0, 120);
}

/** The stated reason behind a per-candidate refusal. */
function refusalOf(error: unknown): string {
  const data =
    typeof error === "object" && error !== null
      ? (error as { data?: { message?: unknown } }).data
      : undefined;
  if (data !== undefined && typeof data.message === "string") {
    return data.message.slice(0, 200);
  }
  if (error instanceof Error) return error.message.slice(0, 200);
  return "candidate could not be imported";
}

/**
 * Validate and normalize one candidate, or throw the reason it is refused.
 *
 * A company with no name is skipped rather than stored: §4.3 and V03-P both
 * say an anonymous business is not a lead, and a row whose only identity is a
 * domain cannot be reviewed by a human.
 */
function admitCandidate(candidate: ProspectCandidate): {
  companyName: string;
  canonicalDomain: string;
  sourceRefs: ProspectSourceRef[];
  fitReason: string;
  contact: ReturnType<typeof assertProspectContact> | undefined;
} {
  const companyName = boundedString(candidate.companyName, "companyName", {
    min: 1,
    max: PROSPECT_COMPANY_NAME_MAX_LENGTH,
  });
  const canonicalDomain = normalizeCanonicalDomain(
    candidate.websiteUrl,
    "websiteUrl",
  );
  const sourceRefs = assertSourceRefs(candidate.sourceRefs);
  const fitReason =
    candidate.fitReason === undefined
      ? "Imported from a lead source; fit not yet assessed."
      : boundedString(candidate.fitReason, "fitReason", {
          min: 1,
          max: PROSPECT_FIT_REASON_MAX_LENGTH,
        });
  const contact =
    candidate.contact === undefined
      ? undefined
      : assertProspectContact(candidate.contact);
  return { companyName, canonicalDomain, sourceRefs, fitReason, contact };
}

/**
 * Merge new provenance into stored provenance. Existing refs are kept in
 * place and only genuinely new identities are appended; the combined list is
 * truncated to `PROSPECT_SOURCE_REFS_MAX` BEFORE `assertSourceRefs` runs,
 * because that helper hard-caps its RAW input at ten and would otherwise
 * throw on a lead that is already at the cap.
 */
function mergeSourceRefs(
  existing: readonly ProspectSourceRef[],
  incoming: readonly ProspectSourceRef[],
): ProspectSourceRef[] {
  const identity = (ref: ProspectSourceRef): string =>
    `${ref.source}:${ref.providerRecordId ?? ref.profileUrl}`;
  const seen = new Set(existing.map(identity));
  const combined = [...existing];
  for (const ref of incoming) {
    if (seen.has(identity(ref))) continue;
    if (combined.length >= PROSPECT_SOURCE_REFS_MAX) break;
    seen.add(identity(ref));
    combined.push(ref);
  }
  return assertSourceRefs(combined);
}

/* ------------------------------------------------------------------ */
/* Pipeline transitions                                                */
/* ------------------------------------------------------------------ */

/**
 * Record what research concluded about a lead.
 *
 * `qualification` and `salesStage` stay orthogonal: only a `qualified` lead
 * advances to the `qualified` stage, and a `rejected` or `needs_review` one
 * lands on `researched` — rejected fit is NOT the terminal `lost` stage, which
 * is a human call P19 owns. Fit evidence is never erased by a later stage.
 */
export const applyResearchOutcome = internalMutation({
  args: {
    prospectId: v.id("prospects"),
    workspaceId: v.id("workspaces"),
    expectedVersion: v.number(),
    qualification: vQualification,
    fitReason: v.string(),
    evidenceCount: v.number(),
    /** Present when a PERSON settled the fit rather than the research step:
     *  an identityKey the backend captured from `ctx.auth`, never model
     *  output. */
    decidedByIdentityKey: v.optional(v.string()),
  },
  returns: vProspectDoc,
  handler: async (ctx, args) => {
    const prospect = await loadPipelineTarget(
      ctx,
      args.prospectId,
      args.workspaceId,
    );
    assertExpectedVersion(prospect.version, args.expectedVersion, "prospect");
    const fitReason = boundedString(args.fitReason, "fitReason", {
      min: 1,
      max: PROSPECT_FIT_REASON_MAX_LENGTH,
    });
    if (args.evidenceCount < 0 || !Number.isInteger(args.evidenceCount)) {
      throw invalid("evidenceCount must be a non-negative integer");
    }
    const target: SalesStage =
      args.qualification === "qualified" ? "qualified" : "researched";
    const nextStage = advancedStage(prospect.salesStage, target);
    const stageReason = boundedString(
      args.decidedByIdentityKey === undefined
        ? `Research ${args.qualification} on ${args.evidenceCount} cited observation(s)`
        : `Reviewer answered ${args.qualification} on ${args.evidenceCount} cited observation(s)`,
      "stageReason",
      { min: 1, max: PROSPECT_STAGE_REASON_MAX_LENGTH },
    );
    const version = prospect.version + 1;
    await ctx.db.patch("prospects", prospect._id, {
      qualification: args.qualification,
      fitReason,
      salesStage: nextStage,
      stageReason,
      version,
      updatedAt: Date.now(),
    });
    await appendLeadEvent(ctx, {
      workspaceId: prospect.workspaceId,
      prospectId: prospect._id,
      kind: "research_applied",
      summary: stageReason,
      // A human answering the fit question is a SECOND operation on the same
      // version, so it needs its own identity or `appendLeadEvent` finds the
      // research row and returns it — dropping the human decision, the
      // transition it caused and the person who made it from the history.
      operationKey:
        args.decidedByIdentityKey === undefined
          ? `prospect:${prospect._id}:research:${args.expectedVersion}`
          : `prospect:${prospect._id}:fit:${args.expectedVersion}`,
      ...(nextStage === prospect.salesStage
        ? {}
        : { fromStage: prospect.salesStage, toStage: nextStage }),
      ...(args.decidedByIdentityKey !== undefined
        ? {
            actor: {
              source: "human" as const,
              identityKey: args.decidedByIdentityKey,
            },
          }
        : {}),
      details: {
        fromQualification: prospect.qualification,
        toQualification: args.qualification,
        reason: fitReason.slice(0, 1_000),
      },
    });
    return reread(ctx, prospect._id);
  },
});

/**
 * A qualified lead with no address is `contact_needed`, not rejected (§4.3).
 * The next action is recorded WITHOUT a due time: absence is the explicit
 * unscheduled state, never a far-future sentinel.
 */
export const setContactNeeded = internalMutation({
  args: {
    prospectId: v.id("prospects"),
    workspaceId: v.id("workspaces"),
    expectedVersion: v.number(),
    reason: v.string(),
  },
  returns: vProspectDoc,
  handler: async (ctx, args) => {
    const prospect = await loadPipelineTarget(
      ctx,
      args.prospectId,
      args.workspaceId,
    );
    assertExpectedVersion(prospect.version, args.expectedVersion, "prospect");
    if (prospect.qualification !== "qualified") {
      throw domainError(
        "CONFLICT",
        `prospect qualification is ${prospect.qualification}; only a qualified lead can need a contact`,
      );
    }
    if (prospect.contact?.email !== undefined) {
      throw domainError(
        "CONFLICT",
        "prospect already carries a contact address",
      );
    }
    const reason = boundedString(args.reason, "reason", {
      min: 1,
      max: PROSPECT_STAGE_REASON_MAX_LENGTH,
    });
    const nextAction = assertNextAction({
      kind: "enrich_contact",
      description: reason,
    });
    const nextStage = advancedStage(prospect.salesStage, "contact_needed");
    await ctx.db.patch("prospects", prospect._id, {
      salesStage: nextStage,
      stageReason: reason,
      nextAction,
      version: prospect.version + 1,
      updatedAt: Date.now(),
    });
    await appendLeadEvent(ctx, {
      workspaceId: prospect.workspaceId,
      prospectId: prospect._id,
      kind: "next_action_set",
      summary: `Contact needed: ${reason}`,
      operationKey: `prospect:${prospect._id}:contact-needed:${args.expectedVersion}`,
      ...(nextStage === prospect.salesStage
        ? {}
        : { fromStage: prospect.salesStage, toStage: nextStage }),
      details: {
        ...(prospect.nextAction !== undefined
          ? { fromNextAction: prospect.nextAction }
          : {}),
        toNextAction: nextAction,
        reason,
      },
    });
    return reread(ctx, prospect._id);
  },
});

/**
 * Store the one selected contact for a lead — the G2-C5 gate, made mechanical.
 *
 * G2 item 5 requires the gateway to "reject enrichment until Convex has
 * accepted qualification evidence for that prospect". Both halves are checked
 * here, before any paid enrichment call could exist: the lead must be
 * `qualified`, and at least one `evidence` row must already name it.
 *
 * This never advances `salesStage`. Once an address exists the lead is ready
 * to draft, and `draft_ready` is `markDraftReady`'s to assert; going back from
 * `contact_needed` to `qualified` would be a regression, which is forbidden.
 * An enrichment that returned NO address leaves the lead exactly where it is,
 * with its `enrich_contact` next action intact — which is how "we could not
 * get one" stays an explicit state instead of a manufactured address.
 */
export const applyContactEnrichment = internalMutation({
  args: {
    prospectId: v.id("prospects"),
    workspaceId: v.id("workspaces"),
    expectedVersion: v.number(),
    contact: vProspectContact,
  },
  returns: vProspectDoc,
  handler: async (ctx, args) => {
    const prospect = await loadPipelineTarget(
      ctx,
      args.prospectId,
      args.workspaceId,
    );
    assertExpectedVersion(prospect.version, args.expectedVersion, "prospect");
    if (prospect.qualification !== "qualified") {
      throw domainError(
        "CONFLICT",
        `prospect qualification is ${prospect.qualification}; enrichment requires accepted qualification evidence`,
      );
    }
    const cited = await ctx.db
      .query("evidence")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", prospect._id),
      )
      .take(1);
    if (cited.length === 0) {
      throw domainError(
        "CONFLICT",
        "no qualification evidence has been accepted for this prospect",
      );
    }
    // `assertProspectContact` is what stops a guessed address being described
    // as verified: `providerEmailStatus: "verified"` without a returned
    // address is refused outright (V03-P).
    const contact = assertProspectContact(args.contact);
    const found = contact.email !== undefined;
    const stageReason = boundedString(
      found
        ? `Contact ${contact.fullName} selected (${contact.providerEmailStatus})`
        : `No address returned for ${contact.fullName} (${contact.providerEmailStatus})`,
      "stageReason",
      { min: 1, max: PROSPECT_STAGE_REASON_MAX_LENGTH },
    );
    const clearsNextAction =
      found && prospect.nextAction?.kind === "enrich_contact";
    await ctx.db.patch("prospects", prospect._id, {
      contact,
      stageReason,
      version: prospect.version + 1,
      updatedAt: Date.now(),
      ...(clearsNextAction ? { nextAction: undefined } : {}),
    });
    await appendLeadEvent(ctx, {
      workspaceId: prospect.workspaceId,
      prospectId: prospect._id,
      kind: "contact_enriched",
      summary: stageReason,
      operationKey: `prospect:${prospect._id}:contact:${args.expectedVersion}`,
      details: {
        ...(prospect.nextAction !== undefined
          ? { fromNextAction: prospect.nextAction }
          : {}),
        reason: contact.selectionReason,
      },
    });
    return reread(ctx, prospect._id);
  },
});

/**
 * A draft revision now exists for this lead and is awaiting human approval.
 * Drafting is not contacting: `lastContactedAt` is untouched, and stays that
 * way until a send ACCEPTANCE fact says otherwise.
 */
export const markDraftReady = internalMutation({
  args: {
    prospectId: v.id("prospects"),
    workspaceId: v.id("workspaces"),
    expectedVersion: v.number(),
    draftId: v.id("drafts"),
  },
  returns: vProspectDoc,
  handler: async (ctx, args) => {
    const prospect = await loadPipelineTarget(
      ctx,
      args.prospectId,
      args.workspaceId,
    );
    assertExpectedVersion(prospect.version, args.expectedVersion, "prospect");
    const draft = await ctx.db.get("drafts", args.draftId);
    if (draft === null || draft.workspaceId !== prospect.workspaceId) {
      throw domainError("NOT_FOUND", "draft not found");
    }
    if (prospect.contact?.email === undefined) {
      throw domainError(
        "CONFLICT",
        "prospect has no contact address; it cannot be draft ready",
      );
    }
    const nextStage = advancedStage(prospect.salesStage, "draft_ready");
    const stageReason = boundedString(
      `Draft revision ${draft.revision} proposed for approval`,
      "stageReason",
      { min: 1, max: PROSPECT_STAGE_REASON_MAX_LENGTH },
    );
    const nextAction = assertNextAction({
      kind: "review",
      description: "Review the proposed outreach draft",
    });
    await ctx.db.patch("prospects", prospect._id, {
      salesStage: nextStage,
      stageReason,
      nextAction,
      version: prospect.version + 1,
      updatedAt: Date.now(),
    });
    await appendLeadEvent(ctx, {
      workspaceId: prospect.workspaceId,
      prospectId: prospect._id,
      kind: "stage_changed",
      summary: stageReason,
      operationKey: `prospect:${prospect._id}:draft:${args.draftId}`,
      ...(nextStage === prospect.salesStage
        ? {}
        : { fromStage: prospect.salesStage, toStage: nextStage }),
      details: {
        ...(prospect.nextAction !== undefined
          ? { fromNextAction: prospect.nextAction }
          : {}),
        toNextAction: nextAction,
      },
    });
    return reread(ctx, prospect._id);
  },
});

/* ------------------------------------------------------------------ */
/* CRM mutations — the operator-facing surface (P19, §5)               */
/* ------------------------------------------------------------------ */

/**
 * Load a lead for an operator write. A missing row and a row in another
 * workspace are the same NOT_FOUND — the read must never reveal another
 * workspace's data.
 */
async function loadProspectForWrite(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  prospectId: Id<"prospects">,
): Promise<Doc<"prospects">> {
  const prospect = await ctx.db.get("prospects", prospectId);
  if (prospect === null || prospect.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "prospect not found");
  }
  return prospect;
}

/**
 * Human stage correction — the ONLY path into or out of `won`/`lost`.
 *
 * The mechanical guards (§8 "CRM and booking transitions"):
 *
 *   `booked` requires a CONFIRMED booking on the lead — the generic call
 *   cannot assert a meeting that was never agreed through the booking path.
 *   `booking_proposed` likewise requires an active proposed booking: the
 *   stage means "we mailed the proposal", and the only honest way in without
 *   that record is impossible by construction.
 *
 *   `contacted`/`replied` may be corrected for work that happened off-app
 *   (a phone call), but the `reason` is the stated evidence basis and the
 *   provider-derived `lastContactedAt`/`lastReplyAt` are NEVER fabricated —
 *   they stay the property of `markSendAccepted`/`markReplied`, so the row
 *   always shows whether the app actually sent or received anything.
 *
 * Idempotency: `requestId` is deduped through the `leadEvents`
 * (workspaceId, operationKey) index BEFORE the version check, so a genuine
 * retry returns the recorded transition even though the version moved on;
 * the same requestId naming a DIFFERENT target stage is a CONFLICT, not a
 * silent second application.
 */
export const updateStage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    expectedVersion: v.number(),
    stage: vSalesStage,
    /** Required: a human correction always states its basis (§8). */
    reason: v.string(),
    requestId: v.string(),
  },
  returns: vProspectDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const reason = boundedString(args.reason, "reason", {
      min: 1,
      max: PROSPECT_STAGE_REASON_MAX_LENGTH,
    });
    const prospect = await loadProspectForWrite(
      ctx,
      args.workspaceId,
      args.prospectId,
    );
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.workspaceId,
      `crm:${args.prospectId}:stage:${requestId}`,
    );
    if (prior !== null) {
      if (prior.toStage !== args.stage) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded a move to ${prior.toStage}`,
        );
      }
      return prospect;
    }
    assertExpectedVersion(prospect.version, args.expectedVersion, "prospect");
    if (args.stage === prospect.salesStage) {
      throw invalid(`prospect is already at ${args.stage}`);
    }
    if (args.stage === "booked" || args.stage === "booking_proposed") {
      const booking = await ctx.db
        .query("bookings")
        .withIndex("by_prospectId_and_state", (q) =>
          q
            .eq("prospectId", prospect._id)
            .eq("state", args.stage === "booked" ? "confirmed" : "proposed"),
        )
        .first();
      if (booking === null) {
        throw domainError(
          "CONFLICT",
          `a lead can only reach ${args.stage} through the booking path — there is no ${
            args.stage === "booked" ? "confirmed" : "proposed"
          } booking on this lead`,
        );
      }
    }
    await ctx.db.patch("prospects", prospect._id, {
      salesStage: args.stage,
      stageReason: reason,
      version: prospect.version + 1,
      updatedAt: Date.now(),
    });
    await appendLeadEvent(ctx, {
      workspaceId: prospect.workspaceId,
      prospectId: prospect._id,
      kind: "stage_changed",
      summary: `Stage ${prospect.salesStage} → ${args.stage} (manual correction)`,
      operationKey: `crm:${prospect._id}:stage:${requestId}`,
      fromStage: prospect.salesStage,
      toStage: args.stage,
      actor: { source: "human", identityKey },
      details: { reason },
    });
    return reread(ctx, prospect._id);
  },
});

/**
 * Reassign the lead to another ACTIVE workspace member. `membershipId` is the
 * memberships row, not an identityKey the caller asserts — a membership in
 * another workspace or a revoked one is refused, and the stored owner is the
 * identity the row itself names.
 */
export const assign = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    expectedVersion: v.number(),
    membershipId: v.id("memberships"),
    requestId: v.string(),
  },
  returns: vProspectDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const prospect = await loadProspectForWrite(
      ctx,
      args.workspaceId,
      args.prospectId,
    );
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.workspaceId,
      `crm:${args.prospectId}:assign:${requestId}`,
    );
    if (prior !== null) {
      const recorded = prior.details?.toOwnerIdentityKey;
      const membership = await ctx.db.get("memberships", args.membershipId);
      if (membership === null || recorded !== membership.identityKey) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded a different assignment`,
        );
      }
      return prospect;
    }
    assertExpectedVersion(prospect.version, args.expectedVersion, "prospect");
    const membership = await ctx.db.get("memberships", args.membershipId);
    if (membership === null || membership.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "membership not found");
    }
    if (membership.status !== "active") {
      throw domainError(
        "CONFLICT",
        "the assignee's membership is revoked — owners must be active members",
      );
    }
    if (membership.identityKey === prospect.ownerIdentityKey) {
      // Already theirs — a deliberate no-op, not a new event.
      return prospect;
    }
    await ctx.db.patch("prospects", prospect._id, {
      ownerIdentityKey: membership.identityKey,
      version: prospect.version + 1,
      updatedAt: Date.now(),
    });
    await appendLeadEvent(ctx, {
      workspaceId: prospect.workspaceId,
      prospectId: prospect._id,
      kind: "owner_assigned",
      summary: `Lead reassigned to ${membership.identityKey}`,
      operationKey: `crm:${prospect._id}:assign:${requestId}`,
      actor: { source: "human", identityKey },
      details: {
        fromOwnerIdentityKey: prospect.ownerIdentityKey,
        toOwnerIdentityKey: membership.identityKey,
      },
    });
    return reread(ctx, prospect._id);
  },
});

/**
 * Set or clear the lead's next action. `action` is the typed work item;
 * `dueAt` is the operator-derived UTC instant — an absent due time is the
 * explicit "unscheduled" state (§4.3), never a sentinel. Clearing passes
 * `action: null` and records `next_action_cleared` with what it removed.
 */
export const setNextAction = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    expectedVersion: v.number(),
    action: v.union(vNextAction, v.null()),
    dueAt: v.optional(v.number()),
    requestId: v.string(),
  },
  returns: vProspectDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const prospect = await loadProspectForWrite(
      ctx,
      args.workspaceId,
      args.prospectId,
    );
    const nextAction =
      args.action === null
        ? undefined
        : assertNextAction({
            kind: args.action.kind,
            description: args.action.description,
          });
    const nextActionDueAt =
      args.dueAt === undefined
        ? undefined
        : assertEpochMs(args.dueAt, "dueAt");
    if (args.action === null && args.dueAt !== undefined) {
      throw invalid("dueAt has no meaning when the next action is cleared");
    }
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.workspaceId,
      `crm:${args.prospectId}:next-action:${requestId}`,
    );
    if (prior !== null) {
      const same =
        JSON.stringify(prior.details?.toNextAction ?? null) ===
          JSON.stringify(nextAction ?? null) &&
        (prior.details?.toNextActionDueAt ?? undefined) === nextActionDueAt;
      if (!same) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded a different next action`,
        );
      }
      return prospect;
    }
    assertExpectedVersion(prospect.version, args.expectedVersion, "prospect");
    await ctx.db.patch("prospects", prospect._id, {
      nextAction,
      nextActionDueAt,
      version: prospect.version + 1,
      updatedAt: Date.now(),
    });
    await appendLeadEvent(ctx, {
      workspaceId: prospect.workspaceId,
      prospectId: prospect._id,
      kind: nextAction === undefined ? "next_action_cleared" : "next_action_set",
      summary:
        nextAction === undefined
          ? "Next action cleared"
          : `Next action: ${nextAction.kind}`,
      operationKey: `crm:${prospect._id}:next-action:${requestId}`,
      actor: { source: "human", identityKey },
      details: {
        ...(prospect.nextAction !== undefined
          ? { fromNextAction: prospect.nextAction }
          : {}),
        ...(prospect.nextActionDueAt !== undefined
          ? { fromNextActionDueAt: prospect.nextActionDueAt }
          : {}),
        ...(nextAction !== undefined ? { toNextAction: nextAction } : {}),
        ...(nextActionDueAt !== undefined
          ? { toNextActionDueAt: nextActionDueAt }
          : {}),
      },
    });
    return reread(ctx, prospect._id);
  },
});

/**
 * Append a note to the lead's history. A note IS the event — the lead row is
 * untouched (no version bump, no `updatedAt` move), so annotating a lead can
 * never reorder a pipeline view or race an OCC check. `requestId` dedupes the
 * append: a retried note returns the row it already wrote, and the same
 * requestId carrying a different body is a CONFLICT.
 */
export const addNote = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    body: v.string(),
    requestId: v.string(),
  },
  returns: vLeadEventDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const note = boundedString(args.body, "body", {
      min: 1,
      max: LEAD_EVENT_NOTE_MAX_LENGTH,
    });
    await loadProspectForWrite(ctx, args.workspaceId, args.prospectId);
    const operationKey = `crm:${args.prospectId}:note:${requestId}`;
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.workspaceId,
      operationKey,
    );
    if (prior !== null) {
      if (prior.details?.note !== note) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded a different note`,
        );
      }
      return prior;
    }
    const eventId = await appendLeadEvent(ctx, {
      workspaceId: args.workspaceId,
      prospectId: args.prospectId,
      kind: "note_added",
      summary: `Note added by a team member`,
      operationKey,
      actor: { source: "human", identityKey },
      details: { note },
    });
    if (eventId === null) {
      throw domainError("CONFLICT", "note operation key already recorded");
    }
    const event = await ctx.db.get("leadEvents", eventId);
    if (event === null) {
      throw domainError("NOT_FOUND", "lead event not found after insert");
    }
    return event;
  },
});

/* ------------------------------------------------------------------ */
/* Provider-fact derivations (P19, §8)                                  */
/* ------------------------------------------------------------------ */

/**
 * THE contacted/booking_proposed derivation — called by `sending.ts` exactly
 * once per provider-acknowledged send, inside the outcome transaction. It is
 * deliberately non-throwing: a broken association must never roll back the
 * acceptance record the send boundary just committed; it simply records less.
 *
 * What it records, all in one patch:
 *   `lastContactedAt` — the monotonic max of every accepted send.
 *   `contacted` — when the lead has not already advanced past it.
 *   `booking_proposed` — ONLY when the sent draft carries a live
 *   `bookingId`/`bookingVersion` link that still resolves to a `proposed`
 *   booking on this lead (§4.3: "only acceptance of that linked exact draft
 *   can advance its lead"). A stale or moved booking is skipped — the send
 *   itself is still a contact.
 *
 * A `send_accepted` event is written per attempt; a stage event is written
 * only when the stage actually moved. `won`/`lost` and later stages keep the
 * timestamp update without regressing.
 */
export const markSendAccepted = internalMutation({
  args: {
    sendAttemptId: v.id("sendAttempts"),
    at: v.number(),
  },
  returns: v.object({
    applied: v.boolean(),
    stage: vSalesStage,
  }),
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null) {
      return { applied: false, stage: "discovered" as const };
    }
    const conversation = await ctx.db.get(
      "conversations",
      attempt.conversationId,
    );
    if (conversation === null || conversation.prospectId === undefined) {
      return { applied: false, stage: "discovered" as const };
    }
    const prospect = await ctx.db.get("prospects", conversation.prospectId);
    if (prospect === null || prospect.workspaceId !== attempt.workspaceId) {
      return { applied: false, stage: "discovered" as const };
    }
    const draft = await ctx.db.get("drafts", attempt.draftId);

    // The booking link the dispatch gate already validated — re-checked here
    // because a confirm/reschedule could have landed between the two.
    let booking: Doc<"bookings"> | null = null;
    if (draft !== null && draft.bookingId !== undefined) {
      const linked = await ctx.db.get("bookings", draft.bookingId);
      if (
        linked !== null &&
        linked.workspaceId === prospect.workspaceId &&
        linked.prospectId === prospect._id &&
        linked.state === "proposed" &&
        linked.version === draft.bookingVersion
      ) {
        booking = linked;
      }
    }

    const now = Date.now();
    const nextStage = advancedStage(
      prospect.salesStage,
      booking !== null ? "booking_proposed" : "contacted",
    );
    const moved = nextStage !== prospect.salesStage;
    const patch: Partial<Doc<"prospects">> = {
      lastContactedAt: Math.max(prospect.lastContactedAt ?? 0, args.at),
      version: prospect.version + 1,
      updatedAt: now,
      ...(moved
        ? {
            salesStage: nextStage,
            stageReason:
              booking !== null
                ? "Booking proposal send accepted by the provider"
                : "Outbound send accepted by the provider",
          }
        : {}),
      ...(booking !== null
        ? {
            nextAction: assertNextAction({
              kind: "confirm_booking",
              description:
                "Record the agreed meeting time when the prospect confirms",
            }),
          }
        : {}),
    };
    await ctx.db.patch("prospects", prospect._id, patch);
    // `booking` is only set when the linked draft exists — the narrowed
    // `draft !== null` here is what that implication looks like to the
    // checker.
    if (booking !== null && draft !== null) {
      await ctx.db.patch("bookings", booking._id, {
        ...(booking.conversationId === undefined
          ? { conversationId: conversation._id }
          : {}),
        ...(booking.draftId === undefined ? { draftId: draft._id } : {}),
        updatedAt: now,
      });
    }
    await appendLeadEvent(ctx, {
      workspaceId: prospect.workspaceId,
      prospectId: prospect._id,
      kind: "send_accepted",
      summary: `Outbound send accepted by the provider (attempt ${attempt._id})`,
      operationKey: `prospect:${prospect._id}:send-accepted:${attempt._id}`,
      ...(booking !== null ? { bookingId: booking._id } : {}),
    });
    if (moved) {
      await appendLeadEvent(ctx, {
        workspaceId: prospect.workspaceId,
        prospectId: prospect._id,
        kind: booking !== null ? "booking_proposed" : "stage_changed",
        summary:
          booking !== null
            ? `Booking proposal delivered — lead is booking_proposed`
            : `Stage ${prospect.salesStage} → ${nextStage}`,
        operationKey:
          // Keyed per ATTEMPT, not per booking: a human can pull the stage
          // back down and a second send carrying the same live booking link
          // must still record its re-advance — the row and the append-only
          // history can never disagree. True replays still dedupe because
          // one attempt writes this key at most once.
          booking !== null
            ? `prospect:${prospect._id}:booking-sent:${booking._id}:${attempt._id}`
            : `prospect:${prospect._id}:contacted:${attempt._id}`,
        fromStage: prospect.salesStage,
        toStage: nextStage,
        ...(booking !== null ? { bookingId: booking._id } : {}),
        details:
          booking !== null
            ? {
                toNextAction: {
                  kind: "confirm_booking" as const,
                  description:
                    "Record the agreed meeting time when the prospect confirms",
                },
              }
            : {},
      });
    }
    return { applied: true, stage: nextStage };
  },
});

/**
 * THE replied derivation — called by `inbox.ts` once per verified inbound on
 * a conversation that is already linked to a lead, and by
 * `conversations.associateProspect` when a held thread is bound. Keyed on the
 * provider message ref so a replayed receipt dedupes rather than double-
 * counting. Non-throwing like `markSendAccepted`: a reply fact must never
 * roll back the receipt that carries it.
 *
 * Sets `lastReplyAt` to the latest verified inbound, advances the stage to
 * `replied` unless the lead already sits past it, and clears an `await_reply`
 * next action — the only automatic next-action change this module makes,
 * because the reply is the fact that completes it.
 */
export const markReplied = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageRef: v.string(),
    at: v.number(),
  },
  returns: v.object({
    applied: v.boolean(),
    stage: v.optional(vSalesStage),
  }),
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null || conversation.prospectId === undefined) {
      return { applied: false };
    }
    const prospect = await ctx.db.get("prospects", conversation.prospectId);
    if (prospect === null || prospect.workspaceId !== conversation.workspaceId) {
      return { applied: false };
    }
    const messageRef = boundedString(args.messageRef, "messageRef", {
      min: 1,
      max: 300,
    });
    const operationKey = `prospect:${prospect._id}:replied:${messageRef}`;
    const prior = await findLeadEventByOperationKey(
      ctx,
      prospect.workspaceId,
      operationKey,
    );
    if (prior !== null) {
      return { applied: true, stage: prospect.salesStage };
    }
    const now = Date.now();
    const nextStage = advancedStage(prospect.salesStage, "replied");
    const moved = nextStage !== prospect.salesStage;
    const clearsAwait = prospect.nextAction?.kind === "await_reply";
    await ctx.db.patch("prospects", prospect._id, {
      lastReplyAt: Math.max(prospect.lastReplyAt ?? 0, args.at),
      version: prospect.version + 1,
      updatedAt: now,
      ...(moved
        ? {
            salesStage: nextStage,
            stageReason: "Verified inbound reply on the linked conversation",
          }
        : {}),
      ...(clearsAwait ? { nextAction: undefined } : {}),
    });
    await appendLeadEvent(ctx, {
      workspaceId: prospect.workspaceId,
      prospectId: prospect._id,
      kind: "reply_received",
      summary: `Verified inbound reply recorded on the linked conversation`,
      operationKey,
      details: {
        ...(prospect.nextAction !== undefined && clearsAwait
          ? { fromNextAction: prospect.nextAction }
          : {}),
      },
    });
    if (moved) {
      await appendLeadEvent(ctx, {
        workspaceId: prospect.workspaceId,
        prospectId: prospect._id,
        kind: "stage_changed",
        summary: `Stage ${prospect.salesStage} → replied`,
        operationKey: `prospect:${prospect._id}:stage-replied:${messageRef}`,
        fromStage: prospect.salesStage,
        toStage: nextStage,
      });
    }
    return { applied: true, stage: nextStage };
  },
});

/** Re-exported for the pipeline steps that decide a qualification. */
export type { Qualification };
