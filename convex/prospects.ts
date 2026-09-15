/**
 * Prospects — the lead/CRM entity (`prospects` is the backend name; the UI
 * says Leads). Architecture §4.3/§4.5.
 *
 * SCOPE FENCE. Architecture §5 assigns this module to P19, which "coordinates
 * `convex/prospects.ts` with P21". P21 ships the PIPELINE-WRITER half plus the
 * two reads the pipeline and its evidence need. The operator-facing CRM
 * surface — `search`, `updateStage`, `assign`, `setNextAction`, `addNote` and
 * the booking transitions — is P19's and is deliberately absent here so the
 * two cards do not collide in one file.
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
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { getActiveMembership, requireWorkspaceMember } from "./lib/auth";
import { vEvidenceDoc } from "./evidence";
import {
  assertExpectedVersion,
  assertNextAction,
  assertProspectContact,
  assertSourceRefs,
  boundedLimit,
  boundedString,
  domainError,
  invalid,
  normalizeCanonicalDomain,
  salesStageRank,
  vProspectCandidate,
  vProspectContact,
  vQualification,
  vSalesStage,
  DEFAULT_LIST_LIMIT,
  PROSPECT_COMPANY_NAME_MAX_LENGTH,
  PROSPECT_FIT_REASON_MAX_LENGTH,
  PROSPECT_IMPORT_CANDIDATES_MAX,
  PROSPECT_SOURCE_REFS_MAX,
  PROSPECT_STAGE_REASON_MAX_LENGTH,
  TERMINAL_SALES_STAGES,
} from "./lib/validators";
import type {
  LeadEventDetails,
  LeadEventKind,
  ProspectCandidate,
  ProspectSourceRef,
  Qualification,
  SalesStage,
} from "./lib/validators";
import { leadEventFields, prospectFields } from "./schema";

export const vProspectDoc = v.object({
  _id: v.id("prospects"),
  _creationTime: v.number(),
  ...prospectFields,
});

export const vLeadEventDoc = v.object({
  _id: v.id("leadEvents"),
  _creationTime: v.number(),
  ...leadEventFields,
});

/** How many campaign rows the importer reads to build its dedupe map. A
 *  campaign's `leadLimit` is 1..5, so anything near this bound already means
 *  every further candidate is refused by the ceiling. */
const CAMPAIGN_PROSPECT_SCAN_LIMIT = 64;

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Leads in one workspace, optionally narrowed to a campaign and/or a stage.
 *
 * Index choice is explicit rather than filtered, so every mode is a range
 * read: stage-only sorts by `updatedAt`, campaign-scoped sorts inside the
 * campaign's stage index, and the unfiltered list sorts by next-action due
 * time — where rows with no due time sort together, which is how the explicit
 * "unscheduled" state stays visible instead of being filtered away (§4.3).
 */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    campaignId: v.optional(v.id("campaigns")),
    salesStage: v.optional(vSalesStage),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vProspectDoc),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const limit = boundedLimit(args.limit);
    const paginate = { numItems: limit, cursor: args.cursor ?? null };
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
  },
});

/**
 * One lead with the evidence behind it and the history that produced it.
 * A row in another workspace is NOT_FOUND, never FORBIDDEN.
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
    return { prospect, evidence, events };
  },
});

/* ------------------------------------------------------------------ */
/* Shared write helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Append one CRM history row, idempotently. `operationKey` is unique per
 * workspace and the index is a lookup, so the read happens in the SAME
 * transaction as the insert; a replayed mutation returns the row it already
 * wrote instead of appending a second one.
 */
async function appendLeadEvent(
  ctx: MutationCtx,
  event: {
    workspaceId: Id<"workspaces">;
    prospectId: Id<"prospects">;
    kind: LeadEventKind;
    summary: string;
    operationKey: string;
    fromStage?: SalesStage;
    toStage?: SalesStage;
    missionId?: Id<"missions">;
    runId?: Id<"runs">;
    details?: LeadEventDetails;
  },
): Promise<Id<"leadEvents">> {
  const operationKey = boundedString(event.operationKey, "operationKey", {
    min: 1,
    max: 200,
  });
  const existing = await ctx.db
    .query("leadEvents")
    .withIndex("by_workspaceId_and_operationKey", (q) =>
      q.eq("workspaceId", event.workspaceId).eq("operationKey", operationKey),
    )
    .unique();
  if (existing !== null) {
    return existing._id;
  }
  return ctx.db.insert("leadEvents", {
    workspaceId: event.workspaceId,
    prospectId: event.prospectId,
    kind: event.kind,
    // Every writer in this module is the internal pipeline. A `human` actor
    // carries an identityKey from `ctx.auth` and belongs to P19's operator
    // mutations; model output and email content can never name an actor.
    actor: { source: "workflow" as const },
    summary: boundedString(event.summary, "summary", { min: 1, max: 500 }),
    createdAt: Date.now(),
    operationKey,
    ...(event.fromStage !== undefined ? { fromStage: event.fromStage } : {}),
    ...(event.toStage !== undefined ? { toStage: event.toStage } : {}),
    ...(event.missionId !== undefined ? { missionId: event.missionId } : {}),
    ...(event.runId !== undefined ? { runId: event.runId } : {}),
    ...(event.details !== undefined ? { details: event.details } : {}),
  });
}

/**
 * The stage this transition may land on, or the current one.
 *
 * A later scrape may never move a lead backwards, and an automatic transition
 * never enters or leaves `won`/`lost` — both halves of what `salesStageRank`
 * is load-bearing for. Returning the CURRENT stage rather than throwing is
 * deliberate: a branch that re-runs research on an already-contacted lead
 * should record its finding, not fail.
 */
function advancedStage(current: SalesStage, target: SalesStage): SalesStage {
  if (TERMINAL_SALES_STAGES.includes(current)) return current;
  if (TERMINAL_SALES_STAGES.includes(target)) return current;
  return salesStageRank(target) > salesStageRank(current) ? target : current;
}

/** Load a prospect and its mission together, refusing any cross-scope pair. */
async function loadBranchTarget(
  ctx: MutationCtx,
  prospectId: Id<"prospects">,
  missionId: Id<"missions">,
  runId: Id<"runs">,
): Promise<{ prospect: Doc<"prospects">; mission: Doc<"missions"> }> {
  const mission = await ctx.db.get("missions", missionId);
  if (mission === null) {
    throw domainError("NOT_FOUND", "mission not found");
  }
  const prospect = await ctx.db.get("prospects", prospectId);
  if (
    prospect === null ||
    prospect.workspaceId !== mission.workspaceId ||
    prospect.campaignId !== mission.campaignId
  ) {
    throw domainError("NOT_FOUND", "prospect not found for this mission");
  }
  const run = await ctx.db.get("runs", runId);
  if (run === null || run.missionId !== mission._id) {
    throw domainError("NOT_FOUND", "run not found for this mission");
  }
  return { prospect, mission };
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
 * This is the seam Apollo company search (P09) plugs into: P21 ships the
 * importer, the `leadLimit` ceiling, the canonical-domain dedupe and the
 * provenance merge; it ships no Apollo call, because P04's OAuth grant is
 * deferred. A candidate array from any confirmed source imports identically.
 *
 * Per-candidate refusals are COLLECTED, never thrown. One malformed candidate
 * in a batch of five must not cost the other four: an inadmissible URL, a
 * source the campaign never confirmed, an anonymous company and a batch that
 * has reached the campaign's `leadLimit` each land in `skipped` with a stated
 * reason. This is also the FIRST code in the repo that reads
 * `campaigns.leadLimit` to gate anything — it has been validated at write time
 * since P06 and never consulted since.
 */
export const importCampaignProspects = internalMutation({
  args: {
    missionId: v.id("missions"),
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
    const mission = await ctx.db.get("missions", args.missionId);
    if (mission === null) {
      throw domainError("NOT_FOUND", "mission not found");
    }
    if (
      mission.state === "completed" ||
      mission.state === "cancelled" ||
      mission.state === "failed"
    ) {
      throw domainError(
        "CONFLICT",
        `mission is ${mission.state}; it cannot accept new leads`,
      );
    }
    const campaign = await ctx.db.get("campaigns", mission.campaignId);
    if (campaign === null) {
      throw domainError("NOT_FOUND", "campaign not found for mission");
    }
    // The confirmed-campaign predicate, exactly as §4.1 states it.
    if (campaign.sourcePlan.confirmedBy === undefined) {
      throw domainError(
        "CONFLICT",
        "campaign source plan is not confirmed; no lead may be imported",
      );
    }
    if (campaign.status !== "active") {
      throw domainError(
        "CONFLICT",
        `campaign is ${campaign.status}; no lead may be imported`,
      );
    }
    const workspace = await ctx.db.get("workspaces", mission.workspaceId);
    if (workspace === null) {
      throw domainError("NOT_FOUND", "workspace not found");
    }
    const ownerIdentityKey = await resolveOwnerIdentityKey(
      ctx,
      workspace,
      campaign,
    );
    const confirmedSources = new Set(
      campaign.sourcePlan.sources.map((source) => source.source),
    );

    // ONE range read over the campaign's whole prospect range. It is both the
    // dedupe map and the ceiling count, and registering that range in this
    // transaction's read set is what makes a concurrent insert of the same
    // domain conflict instead of duplicating.
    const existingRows = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_campaignId_and_canonicalDomain", (q) =>
        q
          .eq("workspaceId", mission.workspaceId)
          .eq("campaignId", mission.campaignId),
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
        admitted = admitCandidate(candidate, confirmedSources);
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
          missionId: mission._id,
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
        workspaceId: mission.workspaceId,
        campaignId: mission.campaignId,
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
        workspaceId: mission.workspaceId,
        prospectId,
        kind: "stage_changed",
        summary: `Discovered ${admitted.companyName} (${admitted.canonicalDomain})`,
        operationKey: `prospect:${prospectId}:discovered`,
        toStage: "discovered",
        missionId: mission._id,
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
function admitCandidate(
  candidate: ProspectCandidate,
  confirmedSources: ReadonlySet<string>,
): {
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
  for (const ref of candidate.sourceRefs) {
    if (!confirmedSources.has(ref.source)) {
      throw invalid(
        `source ${ref.source} is not in the campaign's confirmed source plan`,
      );
    }
  }
  const sourceRefs = assertSourceRefs(candidate.sourceRefs);
  const fitReason =
    candidate.fitReason === undefined
      ? "Imported from a confirmed source; fit not yet assessed."
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
    missionId: v.id("missions"),
    runId: v.id("runs"),
    expectedVersion: v.number(),
    qualification: vQualification,
    fitReason: v.string(),
    evidenceCount: v.number(),
  },
  returns: vProspectDoc,
  handler: async (ctx, args) => {
    const { prospect, mission } = await loadBranchTarget(
      ctx,
      args.prospectId,
      args.missionId,
      args.runId,
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
      `Research ${args.qualification} on ${args.evidenceCount} cited observation(s)`,
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
      operationKey: `prospect:${prospect._id}:research:${args.runId}`,
      ...(nextStage === prospect.salesStage
        ? {}
        : { fromStage: prospect.salesStage, toStage: nextStage }),
      missionId: mission._id,
      runId: args.runId,
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
    missionId: v.id("missions"),
    runId: v.id("runs"),
    expectedVersion: v.number(),
    reason: v.string(),
  },
  returns: vProspectDoc,
  handler: async (ctx, args) => {
    const { prospect, mission } = await loadBranchTarget(
      ctx,
      args.prospectId,
      args.missionId,
      args.runId,
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
      operationKey: `prospect:${prospect._id}:contact-needed:${args.runId}`,
      ...(nextStage === prospect.salesStage
        ? {}
        : { fromStage: prospect.salesStage, toStage: nextStage }),
      missionId: mission._id,
      runId: args.runId,
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
 * here, BEFORE any Apollo call could exist: the lead must be `qualified`, and
 * at least one `evidence` row must already name it. The refusal is therefore
 * provable with Apollo blocked, which is exactly the half P21 owns.
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
    missionId: v.id("missions"),
    runId: v.id("runs"),
    expectedVersion: v.number(),
    contact: vProspectContact,
  },
  returns: vProspectDoc,
  handler: async (ctx, args) => {
    const { prospect, mission } = await loadBranchTarget(
      ctx,
      args.prospectId,
      args.missionId,
      args.runId,
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
      operationKey: `prospect:${prospect._id}:contact:${args.runId}`,
      missionId: mission._id,
      runId: args.runId,
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
    missionId: v.id("missions"),
    runId: v.id("runs"),
    expectedVersion: v.number(),
    draftId: v.id("drafts"),
  },
  returns: vProspectDoc,
  handler: async (ctx, args) => {
    const { prospect, mission } = await loadBranchTarget(
      ctx,
      args.prospectId,
      args.missionId,
      args.runId,
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
      missionId: mission._id,
      runId: args.runId,
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

/** Re-exported for the pipeline steps that decide a qualification. */
export type { Qualification };
