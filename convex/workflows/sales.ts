/**
 * The sales mission pipeline (P21 — architecture §6.1, card item 1).
 *
 * This replaces `convex/workflows/devFixture.ts` as the workflow
 * `missions.create` starts. The fixture's only output was two hard-coded
 * strings, `"dev-prospect-1"` and `"dev-prospect-2"`, flowing through
 * `missionProspects.prospectId`; here the branch key is a real
 * `Id<"prospects">` and every stage writes a receipt somebody can audit:
 *
 *   confirmed campaign → per-prospect branches → backend page retrieval →
 *   Researcher evidence → fit decision → Outreach draft proposal → human
 *   approval → explicit per-branch terminal outcome.
 *
 * WHY THE STEPS LIVE IN THIS FILE. The repo's other workflow modules hold
 * only `workflow.define` and keep their steps in a domain module
 * (`workflows/reply.ts` ↔ `inbox.ts`, `workflows/devFixture.ts` ↔
 * `workflows/steps.ts`). P21's declared write surface names exactly one new
 * pipeline module, so splitting these steps would create a file outside it.
 * They are internal mutations either way and the workflow component does not
 * care which module registers them.
 *
 * COMPANY DISCOVERY AND CONTACT ENRICHMENT. The parent runs
 * `apollo.searchCompanies` then `importCampaignProspects` before
 * `sourceProspects`. The child runs `apollo.enrichContact` then
 * `applyContactEnrichment` after a lead is qualified and before
 * `checkContact`. Both actions live in `convex/integrations/apollo.ts`
 * (REST, not guessed MCP tool names). Mutations cannot `runAction`, so
 * these are workflow steps, not calls from `sourceProspects`/`checkContact`.
 *
 * THE FIVE RULES THIS FILE IS BUILT AROUND, EACH LEARNED FROM A REAL HAZARD:
 *
 * 1. A PAUSED MISSION RETURNS `{action:"wait"}`. It never throws. A throw
 *    escalates the mission to `failed` through `onMissionWorkflowComplete`
 *    and makes resume impossible. The PARENT parks on `resumeEvent`; a CHILD
 *    must not, because `resumeEvent` is sent only to `mission.workflowId` and
 *    one event id may be awaited exactly once — a child parked on it would
 *    never wake. A child sleeps durably and re-asks instead.
 * 2. EVERY DECISION AWAIT IS WRAPPED. A parked decision THROWS when the ask
 *    is retired, so each await falls through to a `checkContinuation`-shaped
 *    re-read rather than propagating.
 * 3. PARALLEL AWAITS ARE `Promise.all`, NEVER `Promise.race`, and each event
 *    id is awaited exactly once.
 * 4. STEPS RETURN DISCRIMINATED UNIONS, NOT THROWN ERRORS. `ConvexError`
 *    structured data does not survive a step boundary, and a step return over
 *    800 KiB becomes a step failure — so steps return ids, never payloads.
 * 5. BRANCHES ARE `start(...)` CHILDREN, NOT `step.runWorkflow`. Nesting a
 *    child in the parent's journal makes a child failure throw in the parent,
 *    which is the opposite of "support partial success". `registerBranches`
 *    already implements the right shape — a pre-created completion event plus
 *    the child's own `onComplete` fallback — so the parent's `Promise.all`
 *    always resolves and `aggregateMissionOutcome` turns mixed outcomes into
 *    `partial` with every branch's reason preserved on its own row.
 *
 * HOW MODEL WORK IS SERIALISED AND HUMAN WAITS ARE NOT. There is no
 * workflow-side lock here and there must never be one: the single
 * `workspaceExecutionSlots` row is acquired by the WORKER at `/worker/claim`
 * and released when its request reaches a terminal state. So sibling branches
 * queue behind each other for the model automatically, while a branch parked
 * on a human holds nothing — by the time it parks, its worker request is
 * already terminal and the slot is already free. A pending decision therefore
 * blocks only the branch that opened it: the ask is bound to that child's own
 * `targetWorkflowId` and its continuation event is that child's.
 *
 * AND NOTHING HERE SENDS. There is no call to `sending.*`, no
 * `sendDraftWorkflow` start, and no tool on any surface that could send. A
 * draft reaches the wire only through `approvals.approve`, an
 * editor-authenticated human mutation.
 */
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { EventId } from "@convex-dev/workflow";
import type { Infer } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  DRAFT_EVIDENCE_MAX_ITEMS,
  PROSPECT_FIT_REASON_MAX_LENGTH,
  RESEARCH_OBSERVATIONS_MAX,
  RESEARCH_PAGES_PER_PROSPECT,
  WORKER_INPUT_SCHEMA_VERSION,
  boundedString,
  domainError,
  invalid,
  normalizeHttpUrl,
  parseWorkerResult,
  receiptNamesRun,
  vMissionOutcome,
  vQualification,
  vWorkerRequestCompletion,
} from "../lib/validators";
import type {
  MissionOutcome,
  Qualification,
  RetrievedPage,
} from "../lib/validators";
import {
  PROMPT_EVIDENCE_EXCERPT_MAX,
  PROMPT_PAGE_EXCERPT_MAX,
  renderWorkerInput,
} from "../lib/roleTemplates";
import type { PromptBlock } from "../lib/roleTemplates";
import { dispatchRefusalFor } from "../workerOperations";
import { finishRun, insertRun } from "../runs";
import { recordActivityEvent } from "../activity";
import { vDecisionContinuation } from "../decisions";
import { finalizeBranch } from "./steps";
import { workflow } from "./manager";
import { resumeEvent, vBranchCompletion } from "./events";

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

/** How many times a dispatching stage re-asks while the workspace has no
 *  dispatchable runtime connection. A campaign is worth waiting a few minutes
 *  for; waiting forever pins a branch on a box nobody is going to start. */
const MAX_RUNTIME_WAITS = 10;

const RUNTIME_WAIT_MS = 60_000;

/** A CHILD cannot park on `resumeEvent` (see rule 1 in the header), so it
 *  polls instead. 30 s × 120 ≈ one hour, after which the branch records
 *  `cancelled` with a stated reason rather than hanging. */
const PAUSE_POLL_MS = 30_000;

const PAUSE_POLL_MAX = 120;

/**
 * The cap reconciliation P20 flagged: `DRAFT_EVIDENCE_MAX_ITEMS` (25) is
 * looser than §4.5's 12-observation ceiling. It is resolved HERE, at the
 * caller, because `drafts.evidenceIds` is `v.array(v.string())` with no
 * resolution to rows and `convex/drafts.ts` is not P21's to change. Reading
 * the ids from this branch's OWN prospect is also how the documented-but-
 * unenforced "drafts may link only evidence from the same workspace AND
 * prospect" invariant is honoured.
 */
const DRAFT_EVIDENCE_LIMIT = Math.min(
  DRAFT_EVIDENCE_MAX_ITEMS,
  RESEARCH_OBSERVATIONS_MAX,
);

/** Read-only research retrieval is the one place a bounded retry belongs
 *  (§6.2), and `retry` is honoured for `step.runAction` only. Reservations
 *  settle per page INSIDE the action, so a retried step replays the pages
 *  already paid for instead of paying twice. */
/**
 * How much of one page's failure text reaches a lead's `fitReason`. A
 * provider message can run to 500 characters on its own and three of them are
 * concatenated, so an unbounded join turns a readable reason into a wall.
 */
const RETRIEVAL_REASON_MAX = 140;

/**
 * Bound on a branch's terminal reason.
 *
 * `finalizeBranch` bounds its own `reason` at 500 AND then builds an activity
 * summary as `Prospect branch <id>: <outcome> — <reason>`, which
 * `recordActivityEvent` bounds at 500 as well. A 500-character reason
 * therefore makes the activity write THROW, failing the very step that was
 * recording the branch's outcome. 400 leaves room for the ~52-character
 * prefix. The latent defect is in `convex/workflows/steps.ts`, which is not
 * P21's to change — it is reported in `plan/evidence/P21.md`; this bound is
 * what keeps this caller out of it.
 */
const BRANCH_REASON_MAX = 400;

const RETRIEVE_RETRY = {
  maxAttempts: 2,
  initialBackoffMs: 1_000,
  base: 2,
} as const;

/* ------------------------------------------------------------------ */
/* Shared step result shapes                                           */
/* ------------------------------------------------------------------ */

const vSourceProspectsResult = v.union(
  v.object({ action: v.literal("wait") }),
  v.object({ action: v.literal("abandon"), reason: v.string() }),
  v.object({
    action: v.literal("done"),
    prospectIds: v.array(v.id("prospects")),
    summary: v.string(),
  }),
);

type SourceProspectsResult = Infer<typeof vSourceProspectsResult>;

const vResolveBranchResult = v.union(
  v.object({ action: v.literal("wait") }),
  v.object({ action: v.literal("skip"), reason: v.string() }),
  v.object({
    action: v.literal("proceed"),
    prospectId: v.id("prospects"),
    companyName: v.string(),
  }),
);

type ResolveBranchResult = Infer<typeof vResolveBranchResult>;

const vBeginResearchResult = v.union(
  v.object({ action: v.literal("wait") }),
  v.object({ action: v.literal("skip"), reason: v.string() }),
  v.object({
    action: v.literal("done"),
    runId: v.id("runs"),
    prospectId: v.id("prospects"),
    urls: v.array(v.string()),
  }),
);

type BeginResearchResult = Infer<typeof vBeginResearchResult>;

const vDispatchResult = v.union(
  v.object({ action: v.literal("wait") }),
  v.object({ action: v.literal("abandon"), reason: v.string() }),
  v.object({ action: v.literal("unavailable"), reason: v.string() }),
  v.object({ action: v.literal("halt"), reason: v.string() }),
  v.object({
    action: v.literal("done"),
    workerRequestId: v.id("workerRequests"),
    continuationEventId: v.string(),
  }),
);

type DispatchResult = Infer<typeof vDispatchResult>;

/* ------------------------------------------------------------------ */
/* Small shared helpers                                                */
/* ------------------------------------------------------------------ */

async function getMission(
  ctx: MutationCtx,
  missionId: Id<"missions">,
): Promise<Doc<"missions">> {
  const mission = await ctx.db.get("missions", missionId);
  if (mission === null) {
    throw domainError("NOT_FOUND", "mission not found");
  }
  return mission;
}

async function getBranch(
  ctx: MutationCtx,
  branchId: Id<"missionProspects">,
): Promise<Doc<"missionProspects">> {
  const branch = await ctx.db.get("missionProspects", branchId);
  if (branch === null) {
    throw domainError("NOT_FOUND", "prospect branch not found");
  }
  return branch;
}

/**
 * The mid-pipeline contract every stage opens with, in one place so no stage
 * can express it differently: paused parks, terminal abandons, anything else
 * proceeds. It RETURNS; it never throws (header rule 1).
 */
function missionGate(
  mission: Doc<"missions">,
): { action: "proceed" } | { action: "wait" } | { action: "abandon"; reason: string } {
  if (mission.state === "paused") return { action: "wait" };
  if (
    mission.state === "active" ||
    mission.state === "waiting_for_user" ||
    mission.state === "waiting_for_runtime"
  ) {
    return { action: "proceed" };
  }
  return { action: "abandon", reason: mission.state };
}

/** The employee that owns one operation in this workspace, falling back to
 *  the mission's assigned employee (the scout) when the workspace has none —
 *  `insertRun` requires an employee and the dispatch derives its capability
 *  set from whichever one the run names. */
async function employeeFor(
  ctx: MutationCtx,
  mission: Doc<"missions">,
  template: "scout" | "researcher" | "outreach",
): Promise<Id<"employees">> {
  const employee = await ctx.db
    .query("employees")
    .withIndex("by_workspaceId_and_template", (q) =>
      q.eq("workspaceId", mission.workspaceId).eq("template", template),
    )
    .unique();
  return employee?._id ?? mission.assignedEmployeeId;
}

/** `employees.instructions` as the operator wrote it, plus a drift note when
 *  the live row no longer matches the version `inputSnapshot` froze. The
 *  snapshot carries versions, never text, so this is the only way the real
 *  instructions reach a prompt at all. */
async function instructionsFor(
  ctx: MutationCtx,
  mission: Doc<"missions">,
  employeeId: Id<"employees">,
): Promise<string> {
  const employee = await ctx.db.get("employees", employeeId);
  if (employee === null) return "(none)";
  const frozen = mission.inputSnapshot.employeeInstructions.find(
    (entry) => entry.employeeId === employeeId,
  );
  if (
    frozen !== undefined &&
    frozen.instructionVersion !== employee.instructionVersion
  ) {
    return (
      `${employee.instructions}\n\n(note: these instructions are version ` +
      `${employee.instructionVersion}; this mission was dispatched against ` +
      `version ${frozen.instructionVersion}.)`
    );
  }
  return employee.instructions;
}

/** The campaign brief and business profile blocks, identical for every stage
 *  of one mission, built from the FROZEN snapshot so a mid-flight brief edit
 *  cannot change what a running mission was asked to do. */
function campaignBlocks(mission: Doc<"missions">): PromptBlock[] {
  const snapshot = mission.inputSnapshot;
  const blocks: PromptBlock[] = [
    {
      label: "campaign_brief",
      text: [
        `title: ${snapshot.campaignTitle}`,
        `requested outcome: ${snapshot.requestedOutcome}`,
        `source plan: ${snapshot.sourcePlan.instruction}`,
        "",
        snapshot.campaignBrief,
      ].join("\n"),
    },
  ];
  const profile = snapshot.businessProfile;
  if (profile !== undefined) {
    blocks.push({
      label: "business_profile",
      text: [
        `our website: ${profile.websiteUrl}`,
        `our offer: ${profile.offer}`,
        `our ideal customer: ${profile.idealCustomer}`,
        `tone: ${profile.tone}`,
        `exclusions: ${profile.exclusions.join("; ") || "(none)"}`,
      ].join("\n"),
    });
  }
  return blocks;
}

function prospectBlock(prospect: Doc<"prospects">): PromptBlock {
  return {
    label: "prospect",
    text: JSON.stringify({
      companyName: prospect.companyName,
      canonicalDomain: prospect.canonicalDomain,
      sources: prospect.sourceRefs.map((ref) => ref.source),
      qualification: prospect.qualification,
    }),
  };
}

/**
 * The pages THIS run read back from their own `providerOperations`
 * receipts. Nothing the model said is consulted: the receipt is what makes
 * a page citable, both here (what it may read) and in
 * `evidence.recordResearchEvidence` (what it may cite).
 *
 * "This run" means the receipt NAMES this run — it either paid for the
 * retrieval or replayed it. A campaign's second mission plans the same URLs
 * and the campaign-scoped `operationKey` replays every one of them, so
 * strict `runId` equality here would return nothing and every branch of
 * every later mission would halt on "no page could be retrieved".
 */
async function retrievedPagesForRun(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  prospectId: Id<"prospects">,
  runId: Id<"runs">,
): Promise<RetrievedPage[]> {
  const rows = await ctx.db
    .query("providerOperations")
    .withIndex("by_workspaceId_and_prospectId_and_state", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("prospectId", prospectId)
        .eq("state", "completed"),
    )
    .take(RESEARCH_PAGES_PER_PROSPECT * 2);
  const pages: RetrievedPage[] = [];
  for (const row of rows) {
    if (!receiptNamesRun(row, runId)) continue;
    if (row.resultRef === undefined || row.resultRef.kind !== "inline") continue;
    const value: unknown = row.resultRef.value;
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    const url = record["url"];
    const retrievedAt = record["retrievedAt"];
    const excerpt = record["excerpt"];
    const truncated = record["truncated"];
    const statusCode = record["statusCode"];
    if (
      typeof url !== "string" ||
      typeof retrievedAt !== "number" ||
      typeof excerpt !== "string" ||
      typeof truncated !== "boolean"
    ) {
      continue;
    }
    pages.push({
      url,
      retrievedAt,
      excerpt,
      truncated,
      providerOperationId: row._id,
      ...(typeof statusCode === "number" ? { statusCode } : {}),
    });
    if (pages.length >= RESEARCH_PAGES_PER_PROSPECT) break;
  }
  return pages;
}

/* ------------------------------------------------------------------ */
/* Parent stage: source the prospects                                  */
/* ------------------------------------------------------------------ */

/** How many campaign rows one sourcing pass reads. The campaign's own
 *  `leadLimit` (1..5) decides how many become branches. */
const CAMPAIGN_PROSPECT_SCAN_LIMIT = 64;

/**
 * Select the prospects this mission will branch on.
 *
 * It re-reads the CAMPAIGN row for `leadLimit`, which is deliberate:
 * `mission.inputSnapshot` does not carry it — `leadLimit` survives only as
 * prose inside `requestedOutcome` — so a stage that needs the number has to
 * ask the row.
 *
 * ── THE APOLLO DISCOVERY SEAM (P09) ──────────────────────────────────────
 * The parent workflow runs `apollo.searchCompanies` then
 * `importCampaignProspects` BEFORE this mutation. This stage re-reads the
 * campaign's persisted leads (including newly imported ones), applies the
 * `leadLimit` ceiling, and records the selected count. It never calls
 * Apollo itself — mutations cannot `runAction`.
 */
export const sourceProspects = internalMutation({
  args: { missionId: v.id("missions") },
  returns: vSourceProspectsResult,
  handler: async (ctx, args): Promise<SourceProspectsResult> => {
    const mission = await getMission(ctx, args.missionId);
    const gate = missionGate(mission);
    if (gate.action !== "proceed") {
      return gate.action === "wait"
        ? { action: "wait" }
        : { action: "abandon", reason: gate.reason };
    }
    const campaign = await ctx.db.get("campaigns", mission.campaignId);
    if (campaign === null) {
      return { action: "abandon", reason: "campaign_missing" };
    }
    // The confirmed-campaign predicate, exactly as §4.1 states it. A mission
    // cannot be created without it, but a stage that spends anything re-asks
    // rather than assuming its creator checked.
    if (campaign.sourcePlan.confirmedBy === undefined) {
      return { action: "abandon", reason: "campaign_source_plan_unconfirmed" };
    }
    const runId = await insertRun(ctx, {
      missionId: mission._id,
      stage: "scout_discover",
      generation: 1,
      inputVersion: mission.inputVersion,
      inputSummary: mission.inputSnapshot.requestedOutcome,
      employeeId: await employeeFor(ctx, mission, "scout"),
    });
    const run = await ctx.db.get("runs", runId);
    if (run === null) {
      throw domainError("NOT_FOUND", "run not found");
    }
    const rows = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_campaignId_and_canonicalDomain", (q) =>
        q
          .eq("workspaceId", mission.workspaceId)
          .eq("campaignId", mission.campaignId),
      )
      .take(CAMPAIGN_PROSPECT_SCAN_LIMIT);
    // A terminal lead is a human's call (§4.3) and is never re-branched.
    const eligible = rows
      .filter(
        (row) => row.salesStage !== "won" && row.salesStage !== "lost",
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, campaign.leadLimit);
    const prospectIds = eligible.map((row) => row._id);
    const apolloConfirmed = campaign.sourcePlan.sources.some(
      (source) => source.source === "apollo",
    );
    const summary =
      prospectIds.length === 0
        ? apolloConfirmed
          ? "No lead is persisted for this campaign after Apollo discovery."
          : "No lead is persisted for this campaign and its confirmed plan names no enabled discovery source."
        : `${prospectIds.length} of at most ${campaign.leadLimit} leads selected for research`;
    await finishRun(ctx, run, "succeeded", {
      outputRefs: [`scout:selected:${prospectIds.length}`],
      usage: { toolCalls: 0, modelCalls: 0 },
    });
    await ctx.db.patch("missions", mission._id, {
      progressSummary: summary.slice(0, 500),
      updatedAt: Date.now(),
    });
    return { action: "done", prospectIds, summary };
  },
});

/* ------------------------------------------------------------------ */
/* Branch stage: resolve the prospect this branch was registered for   */
/* ------------------------------------------------------------------ */

/**
 * Turn a branch key into a persisted lead, or skip the branch honestly.
 *
 * `missionProspects.prospectId` is still `v.string()` — it is a durable
 * workflow event field (`vBranchCompletion`) and retyping it under an
 * in-flight journal breaks resume, so P21 sequences that change rather than
 * taking it (see `plan/evidence/P21.md`). `normalizeId` is what makes the
 * repoint safe in the meantime: a legacy `dev-prospect-*` key, or a row from
 * another workspace, resolves to nothing and the branch skips with a stated
 * reason instead of researching a lead that does not exist.
 */
export const resolveBranchProspect = internalMutation({
  args: { branchId: v.id("missionProspects") },
  returns: vResolveBranchResult,
  handler: async (ctx, args): Promise<ResolveBranchResult> => {
    const branch = await getBranch(ctx, args.branchId);
    if (branch.outcome !== undefined) {
      return {
        action: "skip",
        reason: branch.outcomeReason ?? "branch already recorded an outcome",
      };
    }
    const mission = await getMission(ctx, branch.missionId);
    const gate = missionGate(mission);
    if (gate.action === "wait") return { action: "wait" };
    if (gate.action === "abandon") {
      return { action: "skip", reason: `mission is ${gate.reason}` };
    }
    const prospectId = ctx.db.normalizeId("prospects", branch.prospectId);
    if (prospectId === null) {
      return { action: "skip", reason: "branch key is not a persisted prospect" };
    }
    const prospect = await ctx.db.get("prospects", prospectId);
    if (
      prospect === null ||
      prospect.workspaceId !== mission.workspaceId ||
      prospect.campaignId !== mission.campaignId
    ) {
      return { action: "skip", reason: "prospect is not on this campaign" };
    }
    return {
      action: "proceed",
      prospectId,
      companyName: prospect.companyName,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Branch stage: plan and open the research run                        */
/* ------------------------------------------------------------------ */

/**
 * Homepage plus at most two more pages, from the lead's own provenance.
 *
 * §G2's Firecrawl route item 2 is a bound on the CALLER, because `scrapePage`
 * is one page per call with no fan-out parameter. The plan is built entirely
 * from the lead's canonical domain and its recorded `sourceRefs`, and a
 * profile URL pointing at some other host is dropped: a prospect's provenance
 * may name a directory entry, and following it would research the directory.
 */
function planResearchUrls(prospect: Doc<"prospects">): string[] {
  const host = prospect.canonicalDomain;
  const urls: string[] = [`https://${host}/`];
  const seen = new Set(urls);
  const sameHost = (candidate: string): string | null => {
    let normalized: string;
    try {
      normalized = normalizeHttpUrl(candidate, "sourceRef.profileUrl");
    } catch {
      return null;
    }
    const parsed = new URL(normalized);
    const bare = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return bare === host ? normalized : null;
  };
  for (const ref of prospect.sourceRefs) {
    if (urls.length >= RESEARCH_PAGES_PER_PROSPECT) break;
    const candidate = sameHost(ref.profileUrl);
    if (candidate === null || seen.has(candidate)) continue;
    seen.add(candidate);
    urls.push(candidate);
  }
  for (const path of ["/about", "/pricing"]) {
    if (urls.length >= RESEARCH_PAGES_PER_PROSPECT) break;
    const candidate = `https://${host}${path}`;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    urls.push(candidate);
  }
  return urls;
}

export const beginResearchRun = internalMutation({
  args: { branchId: v.id("missionProspects") },
  returns: vBeginResearchResult,
  handler: async (ctx, args): Promise<BeginResearchResult> => {
    const branch = await getBranch(ctx, args.branchId);
    const mission = await getMission(ctx, branch.missionId);
    const gate = missionGate(mission);
    if (gate.action === "wait") return { action: "wait" };
    if (gate.action === "abandon") {
      return { action: "skip", reason: `mission is ${gate.reason}` };
    }
    const prospectId = ctx.db.normalizeId("prospects", branch.prospectId);
    if (prospectId === null) {
      return { action: "skip", reason: "branch key is not a persisted prospect" };
    }
    const prospect = await ctx.db.get("prospects", prospectId);
    if (prospect === null || prospect.workspaceId !== mission.workspaceId) {
      return { action: "skip", reason: "prospect not found" };
    }
    const runId = await insertRun(ctx, {
      missionId: mission._id,
      stage: "research",
      generation: branch.generation,
      inputVersion: mission.inputVersion,
      inputSummary: `Research ${prospect.companyName} (${prospect.canonicalDomain})`,
      employeeId: await employeeFor(ctx, mission, "researcher"),
    });
    return {
      action: "done",
      runId,
      prospectId,
      urls: planResearchUrls(prospect),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Branch stage: dispatch the research turn                            */
/* ------------------------------------------------------------------ */

export const dispatchResearch = internalMutation({
  args: {
    branchId: v.id("missionProspects"),
    runId: v.id("runs"),
    targetWorkflowId: v.string(),
  },
  returns: vDispatchResult,
  handler: async (ctx, args): Promise<DispatchResult> => {
    const branch = await getBranch(ctx, args.branchId);
    const mission = await getMission(ctx, branch.missionId);
    const gate = missionGate(mission);
    if (gate.action === "wait") return { action: "wait" };
    if (gate.action === "abandon") {
      return { action: "abandon", reason: gate.reason };
    }
    const prospectId = ctx.db.normalizeId("prospects", branch.prospectId);
    if (prospectId === null) {
      return { action: "halt", reason: "branch key is not a persisted prospect" };
    }
    const prospect = await ctx.db.get("prospects", prospectId);
    if (prospect === null) {
      return { action: "halt", reason: "prospect not found" };
    }
    const pages = await retrievedPagesForRun(
      ctx,
      mission.workspaceId,
      prospectId,
      args.runId,
    );
    if (pages.length === 0) {
      // No page was retrieved, so there is nothing to research and nothing a
      // model could honestly say. Spending a model call here would buy a
      // guess; the branch reports the gap instead (§G2 Firecrawl item 5).
      return { action: "halt", reason: "no page could be retrieved" };
    }
    // The dispatch pre-check. `dispatchWorkerRequest` THROWS for every
    // refusal it makes — no dispatchable runtime, a full `model_runs` day, a
    // disabled employee, a withdrawn capability — and a `ctx.runMutation`
    // throw shares this transaction, so a stage that wants to park and
    // retry, or to finish with a reason a person can act on, has to ask
    // first. `dispatchRefusalFor` mirrors those checks in dispatch order
    // against the same rows, so the pre-check and the dispatch can never
    // disagree.
    const employeeId = await employeeFor(ctx, mission, "researcher");
    const refusal = await dispatchRefusalFor(ctx, {
      mission,
      employeeId,
      operation: "research",
      stepKey: `research:${branch._id}`,
      generation: branch.generation,
    });
    if (refusal !== null) {
      return { action: refusal.kind, reason: refusal.reason };
    }
    const input = renderWorkerInput({
      operation: "research",
      employeeInstructions: await instructionsFor(ctx, mission, employeeId),
      blocks: [
        ...campaignBlocks(mission),
        prospectBlock(prospect),
        {
          label: "retrieved_pages",
          text: JSON.stringify(
            pages.map((page) => ({
              url: page.url,
              retrievedAt: new Date(page.retrievedAt).toISOString(),
              statusCode: page.statusCode ?? null,
              truncated: page.truncated,
              excerpt: page.excerpt.slice(0, PROMPT_PAGE_EXCERPT_MAX),
            })),
          ),
        },
      ],
      scopeKey: `sales:${mission._id}:${prospectId}:research`,
    });
    const dispatched = await ctx.runMutation(
      internal.workerOperations.dispatchWorkerRequest,
      {
        missionId: mission._id,
        runId: args.runId,
        stepKey: `research:${branch._id}`,
        generation: branch.generation,
        operation: "research",
        input,
        outputSchemaVersion: WORKER_INPUT_SCHEMA_VERSION,
        targetWorkflowId: args.targetWorkflowId,
        workflowGeneration: mission.workflowGeneration,
      },
    );
    return {
      action: "done",
      workerRequestId: dispatched.workerRequestId,
      continuationEventId: dispatched.continuationEventId,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Branch stage: apply the research outcome                            */
/* ------------------------------------------------------------------ */

const vApplyResearchResult = v.union(
  v.object({ action: v.literal("failed"), reason: v.string() }),
  v.object({
    action: v.literal("done"),
    qualification: vQualification,
    fitReason: v.string(),
    written: v.number(),
    unsourced: v.number(),
  }),
);

type ApplyResearchResult = Infer<typeof vApplyResearchResult>;

/**
 * THE FIT RULE, STATED MECHANICALLY.
 *
 * `vResearchResult` carries no `qualification` field, so nothing the model
 * says decides fit. What decides it is what the run could actually prove:
 *
 *   needs_review  no observation could be traced to a page this run
 *                 retrieved (`written === 0`), OR the researcher reported
 *                 `status: "pending"` — it said the pages were not enough.
 *   qualified     at least one cited observation was stored from a page this
 *                 run retrieved AND the researcher reported `complete`.
 *
 * `rejected` is never automatic. A lead is rejected only by a person
 * answering the branch's own `missing_information` ask, which is the decision
 * the `needs_review` path opens. That keeps §4.5's "hypotheses labeled" and
 * `vEvidenceConfidence`'s reason for existing intact at the fit level too: an
 * unproven judgement is labelled unproven, not resolved by the machine.
 */
function fitFrom(
  status: "complete" | "pending",
  written: number,
  summary: string,
  unsourced: number,
): { qualification: Qualification; fitReason: string } {
  if (written === 0) {
    return {
      qualification: "needs_review",
      fitReason:
        `No observation could be traced to a page this run retrieved` +
        (unsourced > 0 ? ` (${unsourced} unsourced).` : ".") +
        ` Researcher brief: ${summary}`,
    };
  }
  if (status === "pending") {
    return {
      qualification: "needs_review",
      fitReason: `Researcher reported the retrieved pages were not enough to judge fit. Brief: ${summary}`,
    };
  }
  return { qualification: "qualified", fitReason: summary };
}

export const applyResearchResult = internalMutation({
  args: {
    branchId: v.id("missionProspects"),
    runId: v.id("runs"),
    workerRequestId: v.optional(v.id("workerRequests")),
    /** Set when the retrieval produced nothing, so the lead records the gap
     *  instead of the pipeline pretending the model was never asked. */
    retrievalFailure: v.optional(v.string()),
    /** Set when no model turn could be DISPATCHED at all — a full
     *  `model_runs` day, a disabled employee, a withdrawn capability. The
     *  lead records that reason rather than reading as though the model had
     *  been asked and had nothing to say. */
    dispatchFailure: v.optional(v.string()),
  },
  returns: vApplyResearchResult,
  handler: async (ctx, args): Promise<ApplyResearchResult> => {
    const branch = await getBranch(ctx, args.branchId);
    const mission = await getMission(ctx, branch.missionId);
    const prospectId = ctx.db.normalizeId("prospects", branch.prospectId);
    if (prospectId === null) {
      return { action: "failed", reason: "branch key is not a persisted prospect" };
    }
    const prospect = await ctx.db.get("prospects", prospectId);
    if (prospect === null) {
      return { action: "failed", reason: "prospect not found" };
    }
    const run = await ctx.db.get("runs", args.runId);
    if (run === null) {
      return { action: "failed", reason: "run not found" };
    }
    let status: "complete" | "pending" = "pending";
    let summary =
      args.retrievalFailure ??
      args.dispatchFailure ??
      "No research result was recorded.";
    let observations: { topic: string; finding: string; sourceUrl?: string }[] =
      [];
    let artifactRefs: string[] = [];
    if (args.workerRequestId !== undefined) {
      // The completion event is a HINT; the recorded row is the truth.
      const request = await ctx.db.get(
        "workerRequests",
        args.workerRequestId,
      );
      if (request === null || request.missionId !== mission._id) {
        return { action: "failed", reason: "worker request not found" };
      }
      if (request.state !== "succeeded" || request.resultRef?.kind !== "inline") {
        const detail =
          request.error?.message ?? `worker request is ${request.state}`;
        await finishRun(ctx, run, "failed", {
          errorMessage: detail.slice(0, 500),
        });
        return { action: "failed", reason: detail.slice(0, 300) };
      }
      try {
        const parsed = parseWorkerResult(request.resultRef.value, "research");
        if (parsed.operation !== "research") {
          throw invalid("result is not a research result");
        }
        status = parsed.status;
        summary = parsed.summary;
        observations = [...parsed.observations];
        artifactRefs = [...(parsed.artifactIds ?? [])];
      } catch {
        await finishRun(ctx, run, "failed", {
          errorMessage: "research result failed its own contract",
        });
        return { action: "failed", reason: "research result was not usable" };
      }
    }
    const pages = await retrievedPagesForRun(
      ctx,
      mission.workspaceId,
      prospectId,
      args.runId,
    );
    const recorded =
      observations.length === 0
        ? { written: 0, unsourced: 0, evidenceIds: [] as Id<"evidence">[] }
        : await ctx.runMutation(internal.evidence.recordResearchEvidence, {
            workspaceId: mission.workspaceId,
            prospectId,
            missionId: mission._id,
            runId: args.runId,
            pages,
            observations,
            ...(artifactRefs.length > 0 ? { artifactRefs } : {}),
          });
    const fit = fitFrom(status, recorded.written, summary, recorded.unsourced);
    await ctx.runMutation(internal.prospects.applyResearchOutcome, {
      prospectId,
      missionId: mission._id,
      runId: args.runId,
      expectedVersion: prospect.version,
      qualification: fit.qualification,
      fitReason: boundedString(fit.fitReason, "fitReason", {
        min: 1,
        max: PROSPECT_FIT_REASON_MAX_LENGTH,
      }),
      evidenceCount: recorded.written,
    });
    // When a worker turn ran, the BRIDGE already finished this receipt at
    // the request's terminal transition, and `finishRun` is idempotent on a
    // terminal run — so this call lands only on the path where no turn was
    // dispatched at all (nothing retrievable), which is exactly the path
    // that would otherwise leave a run `running` forever. The counts a
    // person reads are on the activity row below either way.
    await finishRun(ctx, run, "succeeded", {
      outputRefs: [
        `research:pages:${pages.length}`,
        `research:evidence:${recorded.written}`,
        `research:unsourced:${recorded.unsourced}`,
      ],
      usage: { toolCalls: 0, modelCalls: args.workerRequestId === undefined ? 0 : 1 },
    });
    await recordActivityEvent(ctx, {
      workspaceId: mission.workspaceId,
      missionId: mission._id,
      kind: "prospect_research_applied",
      summary:
        `${prospect.companyName}: ${fit.qualification} on ${recorded.written} ` +
        `cited observation(s) from ${pages.length} retrieved page(s), ` +
        `${recorded.unsourced} unsourced`,
      actor: "workflow",
      dedupeKey: `branch:${branch._id}:research:${args.runId}`,
      runId: args.runId,
      prospectId: prospectId,
    });
    return {
      action: "done",
      qualification: fit.qualification,
      fitReason: fit.fitReason,
      written: recorded.written,
      unsourced: recorded.unsourced,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Branch stage: the human fit decision                                */
/* ------------------------------------------------------------------ */

const vOpenFitDecisionResult = v.union(
  v.object({ action: v.literal("skip"), reason: v.string() }),
  v.object({
    action: v.literal("done"),
    decisionId: v.id("decisions"),
    continuationEventId: v.string(),
  }),
);

type OpenFitDecisionResult = Infer<typeof vOpenFitDecisionResult>;

/**
 * Ask a person whether an unproven lead is a fit. The ask is bound to THIS
 * CHILD's workflow (`openRequiredDecision` accepts a registered
 * `missionProspects.childWorkflowId`), which is exactly why one prospect's
 * pending decision cannot stop a sibling from reaching a draft.
 */
export const openFitDecision = internalMutation({
  args: {
    branchId: v.id("missionProspects"),
    targetWorkflowId: v.string(),
    fitReason: v.string(),
  },
  returns: vOpenFitDecisionResult,
  handler: async (ctx, args): Promise<OpenFitDecisionResult> => {
    const branch = await getBranch(ctx, args.branchId);
    const mission = await getMission(ctx, branch.missionId);
    if (missionGate(mission).action === "abandon") {
      return { action: "skip", reason: `mission is ${mission.state}` };
    }
    const prospectId = ctx.db.normalizeId("prospects", branch.prospectId);
    const prospect =
      prospectId === null ? null : await ctx.db.get("prospects", prospectId);
    if (prospect === null) {
      return { action: "skip", reason: "prospect not found" };
    }
    const ask = await ctx.runMutation(internal.decisions.openRequiredDecision, {
      missionId: mission._id,
      kind: "missing_information",
      reason: boundedString(
        `Research could not settle whether ${prospect.companyName} ` +
          `(${prospect.canonicalDomain}) fits this campaign. ${args.fitReason} ` +
          `Answer \`fit\` with "qualified" to continue to a draft, or ` +
          `"rejected" to stop this lead. Nothing is sent either way.`,
        "reason",
        { min: 1, max: 1000 },
      ),
      askKey: `sales:fit:${branch._id}`,
      required: true,
      requestedFields: ["fit"],
      targetWorkflowId: args.targetWorkflowId,
    });
    return {
      action: "done",
      decisionId: ask.decisionId,
      continuationEventId: ask.continuationEventId,
    };
  },
});

const vApplyFitResult = v.object({
  qualification: vQualification,
  reason: v.string(),
});

/**
 * Apply the person's answer. The delivered event was a hint; the recorded
 * decision row is re-read here, and an answer that is not exactly
 * `"qualified"` or `"rejected"` leaves the lead in `needs_review` rather than
 * being interpreted into one.
 */
export const applyFitDecision = internalMutation({
  args: {
    branchId: v.id("missionProspects"),
    runId: v.id("runs"),
    decisionId: v.id("decisions"),
  },
  returns: vApplyFitResult,
  handler: async (
    ctx,
    args,
  ): Promise<{ qualification: Qualification; reason: string }> => {
    const branch = await getBranch(ctx, args.branchId);
    const mission = await getMission(ctx, branch.missionId);
    const decision = await ctx.db.get("decisions", args.decisionId);
    if (decision === null || decision.missionId !== mission._id) {
      return { qualification: "needs_review", reason: "fit ask not found" };
    }
    const answered = decision.answer?.fields?.["fit"];
    if (decision.state !== "resolved" || answered === undefined) {
      return {
        qualification: "needs_review",
        reason: `fit ask is ${decision.state}`,
      };
    }
    if (answered !== "qualified" && answered !== "rejected") {
      return {
        qualification: "needs_review",
        reason: `fit answer "${answered.slice(0, 60)}" is not qualified or rejected`,
      };
    }
    const prospectId = ctx.db.normalizeId("prospects", branch.prospectId);
    const prospect =
      prospectId === null ? null : await ctx.db.get("prospects", prospectId);
    if (prospect === null || prospectId === null) {
      return { qualification: "needs_review", reason: "prospect not found" };
    }
    const reason = `Reviewer ${decision.resolvedBy ?? "unknown"} answered ${answered}.`;
    // The run's OWN cited evidence, counted rather than assumed. A hard-coded
    // zero here overwrote the lead's `stageReason` with "0 cited
    // observation(s)" even when the research run had stored some.
    const cited = await ctx.db
      .query("evidence")
      .withIndex("by_workspaceId_and_runId_and_createdAt", (q) =>
        q.eq("workspaceId", mission.workspaceId).eq("runId", args.runId),
      )
      .take(RESEARCH_OBSERVATIONS_MAX);
    await ctx.runMutation(internal.prospects.applyResearchOutcome, {
      prospectId,
      missionId: mission._id,
      runId: args.runId,
      expectedVersion: prospect.version,
      qualification: answered,
      fitReason: boundedString(`${reason} ${prospect.fitReason}`, "fitReason", {
        min: 1,
        max: PROSPECT_FIT_REASON_MAX_LENGTH,
      }),
      evidenceCount: cited.filter((row) => row.prospectId === prospectId)
        .length,
      // The decision is a SECOND operation on this run. Naming it keeps the
      // reviewer's answer, the identity `decisions.resolve` captured and the
      // transition it caused in the lead's history, instead of colliding
      // with the research row under this run's key and vanishing.
      decidedBy: {
        decisionId: args.decisionId,
        ...(decision.resolvedBy !== undefined
          ? { identityKey: decision.resolvedBy }
          : {}),
      },
    });
    return { qualification: answered, reason };
  },
});

/* ------------------------------------------------------------------ */
/* Branch stage: the contact gate (the Apollo enrichment seam)         */
/* ------------------------------------------------------------------ */

const vContactGateResult = v.union(
  v.object({ action: v.literal("ready"), recipient: v.string() }),
  v.object({ action: v.literal("contact_needed"), reason: v.string() }),
  v.object({ action: v.literal("skip"), reason: v.string() }),
);

type ContactGateResult = Infer<typeof vContactGateResult>;

/**
 * Does this qualified lead have an address to write to?
 *
 * ── THE APOLLO ENRICHMENT SEAM (P09) ─────────────────────────────────────
 * The child workflow runs `apollo.enrichContact` then
 * `applyContactEnrichment` BEFORE this mutation, once the lead is
 * `qualified`. This stage only reads the stored contact: an address means
 * ready; absence becomes `contact_needed` with an `enrich_contact` next
 * action and NO due time. It never calls Apollo itself — mutations cannot
 * `runAction`. `applyContactEnrichment` still refuses unless the lead is
 * `qualified` AND Convex has accepted evidence for it (G2 item 5).
 */
export const checkContact = internalMutation({
  args: {
    branchId: v.id("missionProspects"),
    runId: v.id("runs"),
  },
  returns: vContactGateResult,
  handler: async (ctx, args): Promise<ContactGateResult> => {
    const branch = await getBranch(ctx, args.branchId);
    const mission = await getMission(ctx, branch.missionId);
    const prospectId = ctx.db.normalizeId("prospects", branch.prospectId);
    const prospect =
      prospectId === null ? null : await ctx.db.get("prospects", prospectId);
    if (prospect === null || prospectId === null) {
      return { action: "skip", reason: "prospect not found" };
    }
    const email = prospect.contact?.email;
    if (email !== undefined) {
      return { action: "ready", recipient: email };
    }
    const reason =
      "No business address returned by any confirmed source";
    await ctx.runMutation(internal.prospects.setContactNeeded, {
      prospectId,
      missionId: mission._id,
      runId: args.runId,
      expectedVersion: prospect.version,
      reason,
    });
    return { action: "contact_needed", reason };
  },
});

/* ------------------------------------------------------------------ */
/* Branch stage: dispatch the outreach draft                           */
/* ------------------------------------------------------------------ */

const vDispatchDraftResult = v.union(
  v.object({ action: v.literal("wait") }),
  v.object({ action: v.literal("abandon"), reason: v.string() }),
  v.object({ action: v.literal("unavailable"), reason: v.string() }),
  v.object({ action: v.literal("halt"), reason: v.string() }),
  v.object({
    action: v.literal("done"),
    runId: v.id("runs"),
    workerRequestId: v.id("workerRequests"),
    continuationEventId: v.string(),
  }),
);

type DispatchDraftResult = Infer<typeof vDispatchDraftResult>;

export const dispatchDraft = internalMutation({
  args: {
    branchId: v.id("missionProspects"),
    targetWorkflowId: v.string(),
  },
  returns: vDispatchDraftResult,
  handler: async (ctx, args): Promise<DispatchDraftResult> => {
    const branch = await getBranch(ctx, args.branchId);
    const mission = await getMission(ctx, branch.missionId);
    const gate = missionGate(mission);
    if (gate.action === "wait") return { action: "wait" };
    if (gate.action === "abandon") {
      return { action: "abandon", reason: gate.reason };
    }
    const prospectId = ctx.db.normalizeId("prospects", branch.prospectId);
    const prospect =
      prospectId === null ? null : await ctx.db.get("prospects", prospectId);
    if (prospect === null || prospectId === null) {
      return { action: "halt", reason: "prospect not found" };
    }
    // The same pre-check `dispatchResearch` makes, for the same reason: a
    // refusal must arrive as a step result this branch can act on, never as
    // a throw that fails the child workflow and replaces the lead's terminal
    // reason with a serialized error envelope.
    const employeeId = await employeeFor(ctx, mission, "outreach");
    const refusal = await dispatchRefusalFor(ctx, {
      mission,
      employeeId,
      operation: "draft",
      stepKey: `draft:${branch._id}`,
      generation: branch.generation,
    });
    if (refusal !== null) {
      return { action: refusal.kind, reason: refusal.reason };
    }
    // This branch's OWN evidence, newest first, capped at the reconciled
    // 12 — never another prospect's, which is the §4.3 invariant
    // `drafts.evidenceIds` documents and cannot itself enforce.
    const evidence = await ctx.db
      .query("evidence")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", prospectId),
      )
      .order("desc")
      .take(DRAFT_EVIDENCE_LIMIT);
    if (evidence.length === 0) {
      return {
        action: "halt",
        reason: "no stored evidence to write from",
      };
    }
    const runId = await insertRun(ctx, {
      missionId: mission._id,
      stage: "outreach_draft",
      generation: branch.generation,
      inputVersion: mission.inputVersion,
      inputSummary: `Draft outreach to ${prospect.companyName}`,
      employeeId,
    });
    const input = renderWorkerInput({
      operation: "draft",
      employeeInstructions: await instructionsFor(ctx, mission, employeeId),
      blocks: [
        ...campaignBlocks(mission),
        prospectBlock(prospect),
        {
          label: "evidence",
          text: JSON.stringify(
            evidence.map((row) => ({
              observation: row.observation,
              sourceUrl: row.sourceUrl,
              confidence: row.confidence,
              excerpt: row.excerpt.slice(0, PROMPT_EVIDENCE_EXCERPT_MAX),
            })),
          ),
        },
      ],
      scopeKey: `sales:${mission._id}:${prospectId}:draft`,
    });
    const dispatched = await ctx.runMutation(
      internal.workerOperations.dispatchWorkerRequest,
      {
        missionId: mission._id,
        runId,
        stepKey: `draft:${branch._id}`,
        generation: branch.generation,
        operation: "draft",
        input,
        outputSchemaVersion: WORKER_INPUT_SCHEMA_VERSION,
        targetWorkflowId: args.targetWorkflowId,
        workflowGeneration: mission.workflowGeneration,
      },
    );
    return {
      action: "done",
      runId,
      workerRequestId: dispatched.workerRequestId,
      continuationEventId: dispatched.continuationEventId,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Branch stage: install the draft and open its approval               */
/* ------------------------------------------------------------------ */

const vInstallDraftResult = v.union(
  v.object({ action: v.literal("halt"), reason: v.string() }),
  v.object({
    action: v.literal("done"),
    draftId: v.id("drafts"),
    revision: v.number(),
    decisionId: v.id("decisions"),
    continuationEventId: v.string(),
  }),
);

type InstallDraftResult = Infer<typeof vInstallDraftResult>;

export const installDraft = internalMutation({
  args: {
    branchId: v.id("missionProspects"),
    runId: v.id("runs"),
    workerRequestId: v.id("workerRequests"),
    targetWorkflowId: v.string(),
  },
  returns: vInstallDraftResult,
  handler: async (ctx, args): Promise<InstallDraftResult> => {
    const branch = await getBranch(ctx, args.branchId);
    const mission = await getMission(ctx, branch.missionId);
    const prospectId = ctx.db.normalizeId("prospects", branch.prospectId);
    const prospect =
      prospectId === null ? null : await ctx.db.get("prospects", prospectId);
    if (prospect === null || prospectId === null) {
      return { action: "halt", reason: "prospect not found" };
    }
    const run = await ctx.db.get("runs", args.runId);
    if (run === null) {
      return { action: "halt", reason: "run not found" };
    }
    const recipient = prospect.contact?.email;
    if (recipient === undefined) {
      await finishRun(ctx, run, "failed", {
        errorMessage: "prospect lost its contact address before the draft",
      });
      return { action: "halt", reason: "prospect has no contact address" };
    }
    const workspace = await ctx.db.get("workspaces", mission.workspaceId);
    if (workspace === null || workspace.inboxRef === undefined) {
      await finishRun(ctx, run, "failed", {
        errorMessage: "workspace has no mail inbox to stage a conversation on",
      });
      return {
        action: "halt",
        reason:
          "workspace has no mail inbox; connect one before outreach can be drafted",
      };
    }
    const request = await ctx.db.get("workerRequests", args.workerRequestId);
    if (
      request === null ||
      request.missionId !== mission._id ||
      request.state !== "succeeded" ||
      request.resultRef?.kind !== "inline"
    ) {
      const detail = request?.error?.message ?? `draft is ${request?.state}`;
      await finishRun(ctx, run, "failed", {
        errorMessage: detail.slice(0, 500),
      });
      return { action: "halt", reason: detail.slice(0, 300) };
    }
    let subject: string;
    let body: string;
    try {
      const parsed = parseWorkerResult(request.resultRef.value, "draft");
      if (parsed.operation !== "draft") {
        throw invalid("result is not a draft result");
      }
      subject = parsed.subject;
      body = parsed.body;
    } catch {
      await finishRun(ctx, run, "failed", {
        errorMessage: "draft result failed its own contract",
      });
      return { action: "halt", reason: "draft result was not usable" };
    }
    // One conversation per prospect. Re-using the existing row keeps a
    // re-executed step from opening a second thread for the same lead.
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_prospectId", (q) => q.eq("prospectId", prospectId))
      .first();
    const conversation =
      existing ??
      (await ctx.runMutation(internal.drafts.stageConversation, {
        workspaceId: mission.workspaceId,
        inboxRef: workspace.inboxRef,
        prospectId,
        employeeId: await employeeFor(ctx, mission, "outreach"),
      }));
    const evidenceIds = (
      await ctx.db
        .query("evidence")
        .withIndex("by_prospectId_and_createdAt", (q) =>
          q.eq("prospectId", prospectId),
        )
        .order("desc")
        .take(DRAFT_EVIDENCE_LIMIT)
    ).map((row) => row._id as string);
    const draft = await ctx.runMutation(internal.drafts.createRevision, {
      conversationId: conversation._id,
      missionId: mission._id,
      recipient,
      subject,
      body,
      evidenceIds,
      createdBy: "workflow",
      targetWorkflowId: args.targetWorkflowId,
      requestId: `sales:${branch._id}:${branch.generation}`,
      openDecision: true,
    });
    const bound = await ctx.db
      .query("decisions")
      .withIndex("by_draftId", (q) => q.eq("draftId", draft._id))
      .collect();
    const ask = bound.find(
      (decision) =>
        decision.kind === "draft_approval" && decision.state === "open",
    );
    if (ask === undefined) {
      await finishRun(ctx, run, "failed", {
        errorMessage: "draft approval ask was not opened",
      });
      return { action: "halt", reason: "draft approval ask missing" };
    }
    await ctx.runMutation(internal.prospects.markDraftReady, {
      prospectId,
      missionId: mission._id,
      runId: args.runId,
      expectedVersion: prospect.version,
      draftId: draft._id,
    });
    // Idempotent: the bridge finished this receipt when the drafting turn
    // reached `succeeded`. It stays here so a future non-model drafting path
    // cannot leave a run `running`.
    await finishRun(ctx, run, "succeeded", {
      outputRefs: [`draft:${draft._id}:r${draft.revision}`],
      usage: { toolCalls: 0, modelCalls: 1 },
    });
    return {
      action: "done",
      draftId: draft._id,
      revision: draft.revision,
      decisionId: ask._id,
      continuationEventId: ask.continuationEventId,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Branch terminal                                                     */
/* ------------------------------------------------------------------ */

const vFinishBranchArgs = v.object({
  outcome: v.union(
    v.literal("completed"),
    v.literal("contact_needed"),
    v.literal("rejected"),
    v.literal("skipped"),
    v.literal("failed"),
    v.literal("cancelled"),
  ),
  reason: v.string(),
});

/** Record the branch's explicit terminal outcome and signal its parent —
 *  one transaction, through the shared helper, so a duplicate call keeps the
 *  recorded outcome and the parent's `Promise.all` always resolves. */
export const finishBranch = internalMutation({
  args: {
    branchId: v.id("missionProspects"),
    ...vFinishBranchArgs.fields,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const branch = await getBranch(ctx, args.branchId);
    await finalizeBranch(ctx, branch, args.outcome, args.reason);
    return null;
  },
});

/** Is the mission still parked? A CHILD cannot await `resumeEvent`, so it
 *  re-asks after a durable sleep. */
export const branchPauseCheck = internalMutation({
  args: { branchId: v.id("missionProspects") },
  returns: v.union(
    v.literal("wait"),
    v.literal("proceed"),
    v.literal("abandon"),
  ),
  handler: async (ctx, args): Promise<"wait" | "proceed" | "abandon"> => {
    const branch = await getBranch(ctx, args.branchId);
    const mission = await getMission(ctx, branch.missionId);
    return missionGate(mission).action;
  },
});

/* ------------------------------------------------------------------ */
/* The parent workflow                                                 */
/* ------------------------------------------------------------------ */

export const salesMissionWorkflow = workflow
  .define({
    args: { missionId: v.id("missions") },
    returns: v.object({ outcome: vMissionOutcome }),
  })
  .handler(async (step, args): Promise<{ outcome: MissionOutcome }> => {

    // 1. Dispatch gate.
    let gate = await step.runMutation(
      internal.workflows.steps.gateMission,
      { missionId: args.missionId },
      { name: "gate:dispatch" },
    );
    while (gate.action === "wait") {
      await step.awaitEvent(resumeEvent);
      gate = await step.runMutation(
        internal.workflows.steps.gateMission,
        { missionId: args.missionId },
        { name: "gate:dispatch" },
      );
    }
    if (gate.action === "abandon") {
      return { outcome: "cancelled" as const };
    }

    // 2. Apollo company discovery, then source the persisted leads.
    const discovered = await step.runAction(
      internal.integrations.apollo.searchCompanies,
      { missionId: args.missionId },
      { name: "apollo.searchCompanies" },
    );
    if (discovered.action === "done" && discovered.candidates.length > 0) {
      await step.runMutation(
        internal.prospects.importCampaignProspects,
        {
          missionId: args.missionId,
          candidates: discovered.candidates,
        },
        { name: "importCampaignProspects" },
      );
    }
    let sourced = await step.runMutation(
      internal.workflows.sales.sourceProspects,
      { missionId: args.missionId },
      { name: "sourceProspects" },
    );
    while (sourced.action === "wait") {
      await step.awaitEvent(resumeEvent);
      sourced = await step.runMutation(
        internal.workflows.sales.sourceProspects,
        { missionId: args.missionId },
        { name: "sourceProspects" },
      );
    }
    if (sourced.action === "abandon") {
      return { outcome: "cancelled" as const };
    }

    // 3. Zero prospects is NOT an abandon — abandoning cancels the mission
    //    and tells the operator nothing. The mission asks once, naming a
    //    concrete remedy, re-sources once, and then completes honestly with
    //    whatever it has (V03-P: connection blockers explain a remedy).
    if (sourced.prospectIds.length === 0) {
      const ask = await step.runMutation(
        internal.decisions.openRequiredDecision,
        {
          missionId: args.missionId,
          kind: "missing_information",
          reason:
            "This campaign has no persisted leads to research. Leads must " +
            "come from the confirmed Apollo search or another persisted " +
            "source. If discovery was unavailable, set APOLLO_API_KEY on " +
            "this Convex deployment. Add leads to the campaign, then " +
            "answer `source` to re-check. Nothing is contacted either way.",
          askKey: "sales:no_prospects",
          required: true,
          requestedFields: ["source"],
          targetWorkflowId: step.workflowId,
        },
        { name: "openNoProspectsAsk" },
      );
      await step.runMutation(
        internal.workflows.steps.markAwaitingUser,
        { missionId: args.missionId },
        { name: "markAwaitingUser:noProspects" },
      );
      try {
        await step.awaitEvent({
          id: ask.continuationEventId as EventId,
          validator: vDecisionContinuation,
        });
      } catch {
        // Retired underneath us — fall through and complete with what the
        // mission actually has rather than propagating.
      }
      const rediscovered = await step.runAction(
        internal.integrations.apollo.searchCompanies,
        { missionId: args.missionId },
        { name: "apollo.searchCompanies:retry" },
      );
      if (
        rediscovered.action === "done" &&
        rediscovered.candidates.length > 0
      ) {
        await step.runMutation(
          internal.prospects.importCampaignProspects,
          {
            missionId: args.missionId,
            candidates: rediscovered.candidates,
          },
          { name: "importCampaignProspects:retry" },
        );
      }
      sourced = await step.runMutation(
        internal.workflows.sales.sourceProspects,
        { missionId: args.missionId },
        { name: "sourceProspects:retry" },
      );
      if (sourced.action !== "done" || sourced.prospectIds.length === 0) {
        const completed = await step.runMutation(
          internal.workflows.steps.completeMission,
          { missionId: args.missionId },
          { name: "completeMission" },
        );
        return { outcome: completed.outcome };
      }
    }

    // 4. Prospect branches. `start(...)` children with pre-created completion
    //    events — NOT `step.runWorkflow`, which would nest each child in this
    //    journal and make one child's failure throw here.
    let registered = await step.runMutation(
      internal.workflows.steps.registerBranches,
      {
        missionId: args.missionId,
        parentWorkflowId: step.workflowId,
        prospectKeys: sourced.prospectIds,
      },
      { name: "registerBranches" },
    );
    while (registered.action === "wait") {
      await step.awaitEvent(resumeEvent);
      registered = await step.runMutation(
        internal.workflows.steps.registerBranches,
        {
          missionId: args.missionId,
          parentWorkflowId: step.workflowId,
          prospectKeys: sourced.prospectIds,
        },
        { name: "registerBranches" },
      );
    }
    if (registered.action === "abandon") {
      return { outcome: "cancelled" as const };
    }

    // 5. Every branch, in parallel, each event id awaited exactly once.
    //    `Promise.all` and never `Promise.race`: a race would abandon the
    //    siblings mid-flight, which is the opposite of partial success. Every
    //    child delivers `vBranchCompletion` even when it fails or is
    //    cancelled (`onProspectWorkflowComplete`'s fallback), so this always
    //    resolves.
    await Promise.all(
      registered.branches.map((branch) =>
        step.awaitEvent({
          id: branch.completionEventId as EventId,
          validator: vBranchCompletion,
        }),
      ),
    );

    // 6. Aggregate. Mixed outcomes become `partial` with every branch's own
    //    terminal reason preserved on its own row — nothing vanishes from
    //    the counts.
    const completed = await step.runMutation(
      internal.workflows.steps.completeMission,
      { missionId: args.missionId },
      { name: "completeMission" },
    );
    return { outcome: completed.outcome };
  });

/* ------------------------------------------------------------------ */
/* The branch child workflow                                           */
/* ------------------------------------------------------------------ */

export const salesProspectWorkflow = workflow
  .define({
    args: {
      branchId: v.id("missionProspects"),
      missionId: v.id("missions"),
    },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    /** Record the branch's terminal outcome. Every exit goes through here so
     *  the parent's awaited event is always delivered with a stated reason. */
    const finish = async (
      outcome:
        | "completed"
        | "contact_needed"
        | "rejected"
        | "skipped"
        | "failed"
        | "cancelled",
      reason: string,
      name: string,
    ): Promise<null> => {
      await step.runMutation(
        internal.workflows.sales.finishBranch,
        {
          branchId: args.branchId,
          reason: reason.slice(0, BRANCH_REASON_MAX),
          outcome,
        },
        { name },
      );
      return null;
    };
    /** A CHILD may not park on `resumeEvent` (header rule 1). It sleeps
     *  durably and re-asks, bounded, and records `cancelled` rather than
     *  hanging if the pause outlives the budget.
     *
     *  `polls` in and `polls` out are ONE running counter — the number of
     *  30 s polls this branch has already spent across every pause it has
     *  observed. The caller must write the returned count back, or a branch
     *  that waited out one pause would enter its next one with the budget
     *  already at `PAUSE_POLL_MAX`, execute no loop body, and be cancelled
     *  instantly on a reason ("paused beyond the branch budget") that
     *  nothing had actually spent. */
    const waitOutPause = async (
      label: string,
      polls: number,
    ): Promise<{
      state: "proceed" | "abandon" | "exhausted";
      polls: number;
    }> => {
      let spent = polls;
      for (let poll = polls; poll < PAUSE_POLL_MAX; poll += 1) {
        await step.sleep(PAUSE_POLL_MS, { name: `${label}:pause:${poll}` });
        spent = poll + 1;
        const state = await step.runMutation(
          internal.workflows.sales.branchPauseCheck,
          { branchId: args.branchId },
          { name: `${label}:pauseCheck:${poll}` },
        );
        if (state !== "wait") return { state, polls: spent };
      }
      return { state: "exhausted", polls: spent };
    };

    // 1. Which lead is this branch about?
    let resolved = await step.runMutation(
      internal.workflows.sales.resolveBranchProspect,
      { branchId: args.branchId },
      { name: "resolveBranch" },
    );
    let pausePolls = 0;
    while (resolved.action === "wait") {
      const waited = await waitOutPause("resolve", pausePolls);
      const state = waited.state;
      pausePolls = waited.polls;
      if (state === "abandon") {
        return await finish("cancelled", "mission is not active", "finish:resolveAbandoned");
      }
      if (state === "exhausted") {
        return await finish(
          "cancelled",
          "mission paused beyond the branch budget",
          "finish:resolvePauseExhausted",
        );
      }
      resolved = await step.runMutation(
        internal.workflows.sales.resolveBranchProspect,
        { branchId: args.branchId },
        { name: "resolveBranch:retry" },
      );
    }
    if (resolved.action === "skip") {
      return await finish("skipped", resolved.reason, "finish:resolveSkipped");
    }

    // 2. Open the research run and plan its pages.
    let opened = await step.runMutation(
      internal.workflows.sales.beginResearchRun,
      { branchId: args.branchId },
      { name: "beginResearch" },
    );
    while (opened.action === "wait") {
      const waited = await waitOutPause("beginResearch", pausePolls);
      const state = waited.state;
      pausePolls = waited.polls;
      if (state !== "proceed") {
        return await finish(
          "cancelled",
          state === "abandon"
            ? "mission is not active"
            : "mission paused beyond the branch budget",
          "finish:beginResearchPaused",
        );
      }
      opened = await step.runMutation(
        internal.workflows.sales.beginResearchRun,
        { branchId: args.branchId },
        { name: "beginResearch:retry" },
      );
    }
    if (opened.action === "skip") {
      return await finish("skipped", opened.reason, "finish:researchSkipped");
    }
    const runId = opened.runId;

    // 3. The BACKEND retrieves the pages. The model never fetches anything:
    //    no provider secret may enter the Box, and §G2 requires the page
    //    allowance to be reserved transactionally before the provider is
    //    contacted — which happens inside this action, per page.
    const retrieved = await step.runAction(
      internal.integrations.firecrawl.retrieveProspectPages,
      {
        missionId: args.missionId,
        prospectId: opened.prospectId,
        runId,
        urls: opened.urls,
      },
      { name: "retrievePages", retry: RETRIEVE_RETRY },
    );

    // 4. Dispatch the research turn — unless nothing was retrieved, in which
    //    case there is nothing to research and a model call would buy a
    //    guess.
    let researchRequestId: Id<"workerRequests"> | undefined;
    let researchHalt: string | undefined;
    if (retrieved.pages.length > 0) {
      let dispatched = await step.runMutation(
        internal.workflows.sales.dispatchResearch,
        {
          branchId: args.branchId,
          runId,
          targetWorkflowId: step.workflowId,
        },
        { name: "dispatchResearch:0" },
      );
      let runtimeWaits = 0;
      let redispatch = 0;
      while (
        dispatched.action === "wait" ||
        dispatched.action === "unavailable"
      ) {
        if (dispatched.action === "wait") {
          const waited = await waitOutPause(
            `dispatchResearch:${redispatch}`,
            pausePolls,
          );
          const state = waited.state;
          pausePolls = waited.polls;
          if (state !== "proceed") {
            return await finish(
              "cancelled",
              state === "abandon"
                ? "mission is not active"
                : "mission paused beyond the branch budget",
              "finish:researchPaused",
            );
          }
        } else {
          if (runtimeWaits >= MAX_RUNTIME_WAITS) {
            return await finish(
              "failed",
              `Model work could not be dispatched to research this lead (${dispatched.reason}).`,
              "finish:researchRuntimeUnavailable",
            );
          }
          runtimeWaits += 1;
          await step.sleep(RUNTIME_WAIT_MS, {
            name: `researchRuntimeWait:${runtimeWaits}`,
          });
        }
        redispatch += 1;
        dispatched = await step.runMutation(
          internal.workflows.sales.dispatchResearch,
          {
            branchId: args.branchId,
            runId,
            targetWorkflowId: step.workflowId,
          },
          { name: `dispatchResearch:${redispatch}` },
        );
      }
      if (dispatched.action === "abandon") {
        return await finish(
          "cancelled",
          `mission is ${dispatched.reason}`,
          "finish:researchAbandoned",
        );
      }
      if (dispatched.action === "halt") {
        // No model turn will be dispatched for this lead. The reason is
        // carried into `applyResearchResult` so it lands on the lead's own
        // `fitReason`, rather than the lead reading as though the model had
        // been asked and had nothing to say.
        researchHalt = dispatched.reason;
      } else {
        researchRequestId = dispatched.workerRequestId;
        // The completion event is always delivered — `succeeded`, `failed`,
        // `cancelled` and `uncertain` alike — so this cannot hang on a
        // request the lease sweep retired.
        await step.awaitEvent({
          id: dispatched.continuationEventId as EventId,
          validator: vWorkerRequestCompletion,
        });
      }
    }

    // 5. Apply what the run could actually prove. With no retrieved page the
    //    lead records the gap and this branch fails honestly — no evidence
    //    is fabricated to fill it (§G2 Firecrawl item 5).
    const retrievalFailure =
      retrieved.pages.length === 0
        ? `No page could be retrieved for this lead: ${
            retrieved.failures
              .map(
                (failure) =>
                  `${failure.url} — ${failure.message.slice(0, RETRIEVAL_REASON_MAX)}`,
              )
              .join("; ") || "no URL was admissible"
          }`
        : undefined;
    const applied = await step.runMutation(
      internal.workflows.sales.applyResearchResult,
      {
        branchId: args.branchId,
        runId,
        ...(researchRequestId !== undefined
          ? { workerRequestId: researchRequestId }
          : {}),
        ...(retrievalFailure !== undefined ? { retrievalFailure } : {}),
        ...(researchHalt !== undefined
          ? {
              dispatchFailure: `No research turn could be dispatched for this lead: ${researchHalt}`,
            }
          : {}),
      },
      { name: "applyResearch" },
    );
    if (applied.action === "failed") {
      return await finish("failed", applied.reason, "finish:researchFailed");
    }
    if (retrieved.pages.length === 0) {
      return await finish(
        "failed",
        applied.fitReason,
        "finish:noPageRetrieved",
      );
    }

    // 6. The fit gate. `qualified` continues; anything else asks a person,
    //    on an ask bound to THIS child — which is why a sibling keeps going.
    let qualification = applied.qualification;
    if (qualification !== "qualified") {
      const ask = await step.runMutation(
        internal.workflows.sales.openFitDecision,
        {
          branchId: args.branchId,
          targetWorkflowId: step.workflowId,
          fitReason: applied.fitReason.slice(0, 400),
        },
        { name: "openFitDecision" },
      );
      if (ask.action === "skip") {
        return await finish("skipped", ask.reason, "finish:fitAskSkipped");
      }
      await step.runMutation(
        internal.workflows.steps.markAwaitingUser,
        { missionId: args.missionId },
        { name: "markAwaitingUser:fit" },
      );
      try {
        await step.awaitEvent({
          id: ask.continuationEventId as EventId,
          validator: vDecisionContinuation,
        });
      } catch {
        // A retired ask throws. Re-read the decision row rather than
        // propagating — the recorded row is the truth either way.
      }
      const decided = await step.runMutation(
        internal.workflows.sales.applyFitDecision,
        { branchId: args.branchId, runId, decisionId: ask.decisionId },
        { name: "applyFitDecision" },
      );
      qualification = decided.qualification;
      if (qualification === "rejected") {
        return await finish("rejected", decided.reason, "finish:fitRejected");
      }
      if (qualification !== "qualified") {
        return await finish(
          "contact_needed",
          `This lead still needs a person: ${decided.reason}`,
          "finish:fitUnresolved",
        );
      }
    }

    // 7. The contact gate. Paid Apollo enrichment runs first; a qualified
    //    lead with no address is then `contact_needed` with an
    //    `enrich_contact` next action — an explicit state, never a
    //    manufactured address.
    const enriched = await step.runAction(
      internal.integrations.apollo.enrichContact,
      { branchId: args.branchId, runId },
      { name: "apollo.enrichContact" },
    );
    if (enriched.action === "ready") {
      await step.runMutation(
        internal.prospects.applyContactEnrichment,
        {
          prospectId: enriched.prospectId,
          missionId: args.missionId,
          runId,
          expectedVersion: enriched.expectedVersion,
          contact: enriched.contact,
        },
        { name: "applyContactEnrichment" },
      );
    } else if (
      enriched.action === "no_address" &&
      enriched.contact !== undefined
    ) {
      await step.runMutation(
        internal.prospects.applyContactEnrichment,
        {
          prospectId: enriched.prospectId,
          missionId: args.missionId,
          runId,
          expectedVersion: enriched.expectedVersion,
          contact: enriched.contact,
        },
        { name: "applyContactEnrichment" },
      );
    }
    const contact = await step.runMutation(
      internal.workflows.sales.checkContact,
      { branchId: args.branchId, runId },
      { name: "checkContact" },
    );
    if (contact.action === "skip") {
      return await finish("skipped", contact.reason, "finish:contactSkipped");
    }
    if (contact.action === "contact_needed") {
      return await finish(
        "contact_needed",
        contact.reason,
        "finish:contactNeeded",
      );
    }

    // 8. Propose an outreach draft.
    let proposed = await step.runMutation(
      internal.workflows.sales.dispatchDraft,
      { branchId: args.branchId, targetWorkflowId: step.workflowId },
      { name: "dispatchDraft:0" },
    );
    let draftRuntimeWaits = 0;
    let draftRedispatch = 0;
    while (proposed.action === "wait" || proposed.action === "unavailable") {
      if (proposed.action === "wait") {
        const waited = await waitOutPause(
          `dispatchDraft:${draftRedispatch}`,
          pausePolls,
        );
        const state = waited.state;
        pausePolls = waited.polls;
        if (state !== "proceed") {
          return await finish(
            "cancelled",
            state === "abandon"
              ? "mission is not active"
              : "mission paused beyond the branch budget",
            "finish:draftPaused",
          );
        }
      } else {
        if (draftRuntimeWaits >= MAX_RUNTIME_WAITS) {
          return await finish(
            "contact_needed",
            `Model work could not be dispatched to draft outreach (${proposed.reason}); the lead is waiting for a person.`,
            "finish:draftRuntimeUnavailable",
          );
        }
        draftRuntimeWaits += 1;
        await step.sleep(RUNTIME_WAIT_MS, {
          name: `draftRuntimeWait:${draftRuntimeWaits}`,
        });
      }
      draftRedispatch += 1;
      proposed = await step.runMutation(
        internal.workflows.sales.dispatchDraft,
        { branchId: args.branchId, targetWorkflowId: step.workflowId },
        { name: `dispatchDraft:${draftRedispatch}` },
      );
    }
    if (proposed.action === "abandon") {
      return await finish(
        "cancelled",
        `mission is ${proposed.reason}`,
        "finish:draftAbandoned",
      );
    }
    if (proposed.action === "halt") {
      return await finish(
        "contact_needed",
        `No outreach draft was proposed (${proposed.reason}); the lead is waiting for a person.`,
        "finish:draftHalted",
      );
    }
    await step.awaitEvent({
      id: proposed.continuationEventId as EventId,
      validator: vWorkerRequestCompletion,
    });
    const installed = await step.runMutation(
      internal.workflows.sales.installDraft,
      {
        branchId: args.branchId,
        runId: proposed.runId,
        workerRequestId: proposed.workerRequestId,
        targetWorkflowId: step.workflowId,
      },
      { name: "installDraft" },
    );
    if (installed.action === "halt") {
      return await finish(
        "contact_needed",
        `The proposed draft was not installed (${installed.reason}); the lead is waiting for a person.`,
        "finish:installHalted",
      );
    }

    // 9. Park on the human. The worker request is already terminal, so the
    //    workspace execution slot is already free: this wait costs a journal
    //    row and nothing else, and a sibling can be running a model turn
    //    while this branch sits here. Nothing here can send — only
    //    `approvals.approve` can, and only a person can call it.
    await step.runMutation(
      internal.workflows.steps.markAwaitingUser,
      { missionId: args.missionId },
      { name: "markAwaitingUser:draft" },
    );
    let resolution: Infer<typeof vDecisionContinuation> | null = null;
    try {
      resolution = await step.awaitEvent({
        id: installed.continuationEventId as EventId,
        validator: vDecisionContinuation,
      });
    } catch {
      return await finish(
        "skipped",
        `Draft revision ${installed.revision} was superseded before it was answered; nothing was sent.`,
        "finish:approvalRetired",
      );
    }
    // `changes_requested` and `rejected` BOTH carry `approved: false`, so the
    // branch reads `fields.draftResolution` and never `answer.approved`.
    const draftResolution = resolution.answer.fields?.["draftResolution"];
    if (draftResolution === "approved") {
      return await finish(
        "completed",
        `Draft revision ${installed.revision} approved; the send boundary owns it from here.`,
        "finish:approved",
      );
    }
    if (draftResolution === "changes_requested") {
      return await finish(
        "contact_needed",
        `The reviewer asked for changes to draft revision ${installed.revision}; the lead is waiting for a person.`,
        "finish:changesRequested",
      );
    }
    return await finish(
      "rejected",
      `The reviewer rejected draft revision ${installed.revision}; nothing was sent.`,
      "finish:draftRejected",
    );
  });
