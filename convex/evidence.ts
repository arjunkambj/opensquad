/**
 * Evidence — one observation with the source it came from (§4.3/§4.5).
 *
 * This module owns the §4.5 SYNTHESIS SITE: the single place where a research
 * result becomes `evidence` rows. The rule below is the integrator's decision
 * D3, recorded verbatim here and in `plan/evidence/P21.md`.
 *
 * ---------------------------------------------------------------------------
 * §4.5 EVIDENCE SYNTHESIS RULE (P21; integrator decision D3)
 *
 * `evidence` requires nine columns. `vResearchResult.observations` supplies
 * exactly ONE of them (`finding`), and its `sourceUrl` is v.optional where the
 * column is required. The backend therefore synthesizes from ITS OWN Firecrawl
 * retrieval, which is strictly more trustworthy than trusting a model field.
 * Column by column, without exception:
 *
 *   prospectId   The `missionProspects` branch this request was dispatched for.
 *                NEVER model output. §4.5 requires "prospect was assigned", and
 *                the branch row IS the assignment record.
 *
 *   runId        The `runs` row this stage created with `insertRun` — the same
 *                run the worker request was dispatched under.
 *
 *   sourceUrl    ONLY an observation citing a page THIS RUN's backend actually
 *                retrieved becomes an evidence row. The model's `sourceUrl` is
 *                normalized with `normalizeHttpUrl` and looked up in the map of
 *                pages this run fetched. An observation with no `sourceUrl`, or
 *                naming a page the backend never fetched, IS NOT EVIDENCE. It
 *                may live in the research brief artifact, labelled unsourced,
 *                and is counted in the returned `unsourced` total.
 *
 *   retrievedAt  The backend's own retrieval timestamp for THAT page.
 *                `scrapePage` returns `retrievedAt` as an ISO 8601 STRING while
 *                `evidence.retrievedAt` is epoch ms bounded by `assertEpochMs`
 *                (1_000_000_000_000 .. 4_102_444_800_000). Convert with
 *                `Date.parse(page.retrievedAt)`; a NaN or out-of-range value is
 *                REJECTED (the observation is dropped and counted in `rejected`)
 *                rather than stored, and never silently replaced by Date.now().
 *
 *   excerpt      A span of the BACKEND-RETRIEVED page, re-sliced from the
 *                wrapper's 4000-char EXCERPT_LIMIT down to
 *                EVIDENCE_EXCERPT_MAX_LENGTH (2000):
 *                `page.excerpt.slice(0, EVIDENCE_EXCERPT_MAX_LENGTH)`.
 *                Writing `markdownExcerpt` straight through is out of bounds,
 *                and using the model's `finding` here would store a paraphrase
 *                in a column the schema documents as an excerpt of the source.
 *
 *   observation  The model's `finding`, with `topic` carried into it:
 *                `${topic}: ${finding}`, bounded to
 *                EVIDENCE_OBSERVATION_MAX_LENGTH (1000).
 *
 *   confidence   NEVER model-supplied. `vEvidenceConfidence` is
 *                supported | hypothesis | unknown, and its doc comment says the
 *                union exists precisely to stop "an unlabeled guess stored as
 *                `supported`". DEFAULT TO "unknown". The exact rule:
 *
 *                  "supported"  ONLY on this stated mechanical basis — the cited
 *                               page was retrieved by the backend in THIS run
 *                               AND the stored excerpt is drawn from that same
 *                               retrieval AND the retrieval reported a 2xx
 *                               statusCode AND `markdownTruncated` is false.
 *                               Nothing about the model's wording contributes.
 *                  "hypothesis" ONLY where the model labelled it one, i.e. the
 *                               observation's `topic` begins with the reserved
 *                               host marker "hypothesis:" that the Researcher
 *                               role template instructs it to use, per §4.5's
 *                               "hypotheses labeled".
 *                  "unknown"    Everywhere else, including every truncated page,
 *                               every non-2xx retrieval, and every observation
 *                               whose basis cannot be stated mechanically.
 *
 *   workspaceId / createdAt   Backend facts. Not gaps.
 *
 *   artifactId   The result's `artifactIds[]` / `evidenceRefs[].artifactId` are
 *                opaque worker-supplied STRINGS, never validated document ids.
 *                Each is `normalizeId("artifacts", …)`-resolved and then checked
 *                for `workspaceId` AND `missionId` ownership before it is
 *                stored; a string that fails either check is dropped, not
 *                stored.
 *
 * At most RESEARCH_OBSERVATIONS_MAX (12) evidence rows per research result.
 * `qualification` and its reason are NOT new evidence columns: they belong to
 * `prospects.qualification` (vQualification) and `prospects.fitReason` (≤2000).
 * The "concise brief" is an `artifacts` row of kind "research_brief". The
 * evidence table is not weakened in any way to accommodate the worker shape.
 * ---------------------------------------------------------------------------
 *
 * One tightening beyond the letter of the rule, because it makes the rule
 * MECHANICAL instead of merely asserted: a caller does not get to describe the
 * page it retrieved. Every entry in `pages` names a `providerOperations` row,
 * and the url, retrieval time, excerpt, status code and truncation flag are
 * read back from THAT row — the receipt Convex itself wrote when it paid for
 * the page. A page whose operation is missing, is not `completed`, or belongs
 * to another workspace or prospect is not admitted at all, so no observation
 * can cite it. The argument is therefore a set of receipts, not a set of
 * claims.
 */
import { internalMutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireWorkspaceMember } from "./lib/auth";
import {
  assertEpochMs,
  assertEvidenceExcerpt,
  assertEvidenceObservation,
  boundedLimit,
  domainError,
  invalid,
  isHypothesisTopic,
  normalizeHttpUrl,
  vResearchObservation,
  vRetrievedPage,
  RESEARCH_OBSERVATIONS_MAX,
  RESEARCH_OBSERVATION_INPUT_MAX,
  RESEARCH_PAGES_PER_PROSPECT,
} from "./lib/validators";
import type { EvidenceConfidence } from "./lib/validators";
import { evidenceFields } from "./schema";

export const vEvidenceDoc = v.object({
  _id: v.id("evidence"),
  _creationTime: v.number(),
  ...evidenceFields,
});

const vEvidenceListPage = v.object({
  items: v.array(vEvidenceDoc),
  cursor: v.union(v.string(), v.null()),
  hasMore: v.boolean(),
});

/** Why one reported observation did not become an evidence row. */
const vRejectedObservation = v.object({
  topic: v.string(),
  reason: v.string(),
});

/** Bound on the artifact references one research result may offer. */
const RESEARCH_ARTIFACT_REFS_MAX = 4;

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * One prospect's evidence, newest first. A prospect in another workspace is
 * NOT_FOUND, never FORBIDDEN — existence never leaks across a workspace
 * boundary (house rule, and the isolation V02/V06 assert).
 */
export const listForProspect = query({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: vEvidenceListPage,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const prospect = await ctx.db.get("prospects", args.prospectId);
    if (prospect === null || prospect.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "prospect not found");
    }
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("evidence")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", args.prospectId),
      )
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});

/**
 * The evidence ONE run produced — the run-receipt trace V12-3 asks for.
 * Impossible before this slice: `evidence` carried exactly one index, keyed by
 * prospect, so nothing could answer "what did this execution actually cite?".
 */
export const listForRun = query({
  args: {
    workspaceId: v.id("workspaces"),
    runId: v.id("runs"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: vEvidenceListPage,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const run = await ctx.db.get("runs", args.runId);
    if (run === null || run.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "run not found");
    }
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("evidence")
      .withIndex("by_workspaceId_and_runId_and_createdAt", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("runId", args.runId),
      )
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});

/* ------------------------------------------------------------------ */
/* The §4.5 synthesis site                                             */
/* ------------------------------------------------------------------ */

/** A page this run retrieved, as read back from its own provider receipt. */
type AdmittedPage = {
  readonly url: string;
  readonly retrievedAt: number;
  readonly excerpt: string;
  readonly statusCode: number | undefined;
  readonly truncated: boolean;
};

/**
 * Read one `providerOperations` receipt back into the page it recorded.
 * Returns `null` for anything that is not a completed, inline-result page
 * receipt belonging to this workspace and prospect — the caller then never
 * admits the page, so nothing can cite it.
 *
 * `resultRef.value` is `v.any()` by declaration, so every field is checked
 * here rather than cast. That is the same fail-closed discipline
 * `parseClaimedWork` applies on the worker side.
 */
function admitRecordedPage(
  row: Doc<"providerOperations"> | null,
  workspaceId: Id<"workspaces">,
  prospectId: Id<"prospects">,
): AdmittedPage | null {
  if (row === null) return null;
  if (row.workspaceId !== workspaceId) return null;
  if (row.prospectId !== prospectId) return null;
  if (row.state !== "completed") return null;
  if (row.resultRef === undefined || row.resultRef.kind !== "inline") {
    return null;
  }
  const value: unknown = row.resultRef.value;
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const url = record["url"];
  const retrievedAt = record["retrievedAt"];
  const excerpt = record["excerpt"];
  const truncated = record["truncated"];
  const statusCode = record["statusCode"];
  if (typeof url !== "string" || url === "") return null;
  if (typeof retrievedAt !== "number") return null;
  if (typeof excerpt !== "string") return null;
  if (typeof truncated !== "boolean") return null;
  return {
    url,
    retrievedAt,
    excerpt,
    statusCode: typeof statusCode === "number" ? statusCode : undefined,
    truncated,
  };
}

/**
 * The mechanical basis for `supported`, stated in one place so it can be read
 * and audited as a single predicate. Nothing about the model's wording is an
 * input; only facts the backend's own retrieval recorded.
 */
function confidenceFor(
  page: AdmittedPage,
  topic: string,
): EvidenceConfidence {
  // A labelled hypothesis is never upgraded by a good retrieval: the model
  // said it is a guess, and a guess about a page is not the page's claim.
  if (isHypothesisTopic(topic)) return "hypothesis";
  const ok =
    page.statusCode !== undefined &&
    page.statusCode >= 200 &&
    page.statusCode < 300 &&
    !page.truncated;
  return ok ? "supported" : "unknown";
}

/**
 * Turn one research result into evidence rows.
 *
 * Idempotent per run: a replay reads this run's own rows back and returns
 * them rather than writing a second set. That matters because the research
 * step is a workflow step, and a workflow step may legitimately re-execute.
 *
 * Nothing here can fail a whole research result over one bad observation.
 * Every per-observation refusal is COUNTED and returned — `unsourced` for an
 * observation with no admitted source, `rejected` with a stated reason for
 * everything else — so a gap is visible to the caller and to the brief rather
 * than silently swallowed.
 */
export const recordResearchEvidence = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    missionId: v.id("missions"),
    runId: v.id("runs"),
    /** The receipts of the pages THIS run's backend retrieved. */
    pages: v.array(vRetrievedPage),
    observations: v.array(vResearchObservation),
    /** Opaque worker-supplied artifact references; resolved and ownership
     *  checked here, dropped when either check fails. */
    artifactRefs: v.optional(v.array(v.string())),
  },
  returns: v.object({
    evidenceIds: v.array(v.id("evidence")),
    written: v.number(),
    unsourced: v.number(),
    rejected: v.array(vRejectedObservation),
    replayed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const mission = await ctx.db.get("missions", args.missionId);
    if (mission === null || mission.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "mission not found");
    }
    const prospect = await ctx.db.get("prospects", args.prospectId);
    if (
      prospect === null ||
      prospect.workspaceId !== args.workspaceId ||
      prospect.campaignId !== mission.campaignId
    ) {
      throw domainError("NOT_FOUND", "prospect not found for this mission");
    }
    const run = await ctx.db.get("runs", args.runId);
    if (
      run === null ||
      run.workspaceId !== args.workspaceId ||
      run.missionId !== args.missionId
    ) {
      throw domainError("NOT_FOUND", "run not found for this mission");
    }
    if (args.pages.length > RESEARCH_PAGES_PER_PROSPECT) {
      throw invalid(
        `pages allows at most ${RESEARCH_PAGES_PER_PROSPECT} retrieved pages per prospect`,
      );
    }
    if (args.observations.length > RESEARCH_OBSERVATION_INPUT_MAX) {
      throw invalid(
        `observations allows at most ${RESEARCH_OBSERVATION_INPUT_MAX} entries`,
      );
    }

    // Idempotency: this run's own rows, if it already wrote any.
    const existing = await ctx.db
      .query("evidence")
      .withIndex("by_workspaceId_and_runId_and_createdAt", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("runId", args.runId),
      )
      .take(RESEARCH_OBSERVATIONS_MAX);
    const mine = existing.filter((row) => row.prospectId === args.prospectId);
    if (mine.length > 0) {
      return {
        evidenceIds: mine.map((row) => row._id),
        written: mine.length,
        unsourced: 0,
        rejected: [],
        replayed: true,
      };
    }

    // Resolve the brief artifact, if the worker named one that is really
    // this mission's. An opaque string that does not normalize, names
    // another workspace's row or another mission's row is DROPPED, never
    // stored — see the artifactId clause of the rule above.
    const artifactId = await resolveBriefArtifact(
      ctx,
      args.workspaceId,
      args.missionId,
      args.artifactRefs ?? [],
    );

    // Admit pages from their own receipts. The caller's copies of url,
    // excerpt and timestamp are not consulted.
    const admitted = new Map<string, AdmittedPage>();
    for (const page of args.pages) {
      const row = await ctx.db.get(
        "providerOperations",
        page.providerOperationId,
      );
      const recorded = admitRecordedPage(row, args.workspaceId, args.prospectId);
      if (recorded === null) continue;
      let key: string;
      try {
        key = normalizeHttpUrl(recorded.url, "page.url");
      } catch {
        continue;
      }
      admitted.set(key, recorded);
    }

    const evidenceIds: Id<"evidence">[] = [];
    const rejected: { topic: string; reason: string }[] = [];
    let unsourced = 0;
    const now = Date.now();

    for (const observation of args.observations) {
      const topic = observation.topic;
      if (evidenceIds.length >= RESEARCH_OBSERVATIONS_MAX) {
        rejected.push({
          topic: topicLabel(topic),
          reason: `at most ${RESEARCH_OBSERVATIONS_MAX} observations become evidence for one research result`,
        });
        continue;
      }
      if (observation.sourceUrl === undefined) {
        // Not a rejection: an unsourced observation is a legitimate part of
        // the brief, it is simply not evidence (§4.5).
        unsourced += 1;
        continue;
      }
      let cited: string;
      try {
        cited = normalizeHttpUrl(observation.sourceUrl, "observation.sourceUrl");
      } catch {
        unsourced += 1;
        continue;
      }
      const page = admitted.get(cited);
      if (page === undefined) {
        unsourced += 1;
        continue;
      }
      let row: {
        sourceUrl: string;
        retrievedAt: number;
        excerpt: string;
        observation: string;
        confidence: EvidenceConfidence;
      };
      try {
        row = {
          sourceUrl: page.url,
          // The backend's own retrieval timestamp, re-bounded rather than
          // trusted: a value outside the calendar window is dropped, never
          // replaced by `Date.now()`.
          retrievedAt: assertEpochMs(page.retrievedAt, "page.retrievedAt"),
          excerpt: assertEvidenceExcerpt(page.excerpt),
          observation: assertEvidenceObservation(topic, observation.finding),
          confidence: confidenceFor(page, topic),
        };
      } catch (error) {
        rejected.push({ topic: topicLabel(topic), reason: reasonOf(error) });
        continue;
      }
      const id = await ctx.db.insert("evidence", {
        workspaceId: args.workspaceId,
        prospectId: args.prospectId,
        runId: args.runId,
        createdAt: now,
        ...row,
        ...(artifactId !== undefined ? { artifactId } : {}),
      });
      evidenceIds.push(id);
    }

    return {
      evidenceIds,
      written: evidenceIds.length,
      unsourced,
      rejected,
      replayed: false,
    };
  },
});

/** A bounded, storable label for a refused observation's topic. */
function topicLabel(topic: string): string {
  return topic.trim().slice(0, 120);
}

/**
 * The stated reason behind a per-observation refusal. `ConvexError.data` is
 * read FIRST: a `ConvexError` is also an `Error`, and its `.message` is the
 * serialized `{code, message}` envelope, so reading `.message` first would put
 * JSON where a human-readable reason belongs.
 */
function reasonOf(error: unknown): string {
  const data =
    typeof error === "object" && error !== null
      ? (error as { data?: { message?: unknown } }).data
      : undefined;
  if (data !== undefined && typeof data.message === "string") {
    return data.message.slice(0, 200);
  }
  if (error instanceof Error) return error.message.slice(0, 200);
  return "observation could not be stored";
}

/**
 * Resolve the first worker-supplied artifact reference that is genuinely an
 * `artifacts` row of THIS workspace and THIS mission. Every reference is an
 * opaque string from model output, so `normalizeId` is the only way to turn
 * one into an id, and ownership is checked after it resolves — a row id from
 * another workspace normalizes perfectly well and must still be refused.
 */
async function resolveBriefArtifact(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  missionId: Id<"missions">,
  refs: readonly string[],
): Promise<Id<"artifacts"> | undefined> {
  for (const ref of refs.slice(0, RESEARCH_ARTIFACT_REFS_MAX)) {
    if (typeof ref !== "string" || ref.length === 0 || ref.length > 200) {
      continue;
    }
    const id = ctx.db.normalizeId("artifacts", ref);
    if (id === null) continue;
    const row = await ctx.db.get("artifacts", id);
    if (row === null) continue;
    if (row.workspaceId !== workspaceId) continue;
    if (row.missionId !== missionId) continue;
    return row._id;
  }
  return undefined;
}
