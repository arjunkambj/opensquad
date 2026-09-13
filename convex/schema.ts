/**
 * OpenSquad schema — §4.1 workspace/configuration tables (P02) and the §4.2
 * work/supervision tables (P06): missions, missionProspects, runs, decisions,
 * missionComments, activityEvents. Later tasks extend this file with the
 * §4.3/§4.4 tables (prospects, drafts, runtime transport, usage);
 * component-owned mail/crawl tables never enter this schema.
 *
 * Notation: `ms` timestamps are integer UTC epoch milliseconds. Indexes use
 * application timestamp fields; uniqueness invariants are enforced inside the
 * mutating transaction, not by the index itself.
 *
 * The exported `*Fields` maps are the single source of truth for both
 * `defineTable` and per-module `returns` doc validators.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vBoardColumn,
  vCampaignStatus,
  vCapabilityId,
  vDecisionAnswer,
  vDecisionKind,
  vDecisionState,
  vEmployeeTemplate,
  vInputSnapshot,
  vMembershipStatus,
  vMissionKind,
  vMissionOutcome,
  vMissionPriority,
  vMissionProspectOutcome,
  vMissionState,
  vMissionVisibility,
  vRole,
  vRunState,
  vSourcePlan,
} from "./lib/validators";

export const workspaceFields = {
  name: v.string(),
  /** `tokenIdentifier` (`iss|sub`) of the provisioning owner. */
  ownerIdentityKey: v.string(),
  /** IANA timezone, validated on write. */
  timezone: v.string(),
  automationState: v.union(v.literal("active"), v.literal("paused")),
  policyVersion: v.number(),
  dailySendLimit: v.number(),
  sendWindow: v.object({
    /** IANA weekdays as integers 0 (Sunday) – 6 (Saturday). */
    weekdays: v.array(v.number()),
    /** Minutes after local midnight, 0–1439; startMinute < endMinute. */
    startMinute: v.number(),
    endMinute: v.number(),
  }),
  /** Assigned only by the server demo bootstrap; never client-set. */
  demoMode: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
  /** AgentMail inbox reference assigned by P05/P10; unique when present. */
  inboxRef: v.optional(v.string()),
  pauseReason: v.optional(v.string()),
};

export const membershipFields = {
  workspaceId: v.id("workspaces"),
  identityKey: v.string(),
  role: vRole,
  status: vMembershipStatus,
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const businessProfileFields = {
  workspaceId: v.id("workspaces"),
  websiteUrl: v.string(),
  offer: v.string(),
  idealCustomer: v.string(),
  tone: v.string(),
  exclusions: v.array(v.string()),
  version: v.number(),
  updatedAt: v.number(),
  /** identityKey of the last editor. */
  updatedBy: v.string(),
};

export const employeeFields = {
  workspaceId: v.id("workspaces"),
  template: vEmployeeTemplate,
  name: v.string(),
  instructions: v.string(),
  instructionVersion: v.number(),
  enabled: v.boolean(),
  /** Subset of the host capability policy for this template. */
  allowedCapabilities: v.array(vCapabilityId),
  updatedAt: v.number(),
};

export const campaignFields = {
  workspaceId: v.id("workspaces"),
  title: v.string(),
  brief: v.string(),
  briefVersion: v.number(),
  sourcePlan: vSourcePlan,
  /** 1–5 accepted prospects for MVP. */
  leadLimit: v.number(),
  /** Paid contact-enrichment ceiling for the campaign lifetime. */
  enrichmentLimit: v.number(),
  status: vCampaignStatus,
  /** identityKey of the creator. */
  createdBy: v.string(),
  /** Client retry key — when present, `create` dedupes on
   * (workspaceId, requestId) transactionally instead of double-creating. */
  requestId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

/* ------------------------------------------------------------------ */
/* §4.2 Work and supervision tables (P06)                              */
/* ------------------------------------------------------------------ */

export const missionFields = {
  workspaceId: v.id("workspaces"),
  campaignId: v.id("campaigns"),
  kind: vMissionKind,
  title: v.string(),
  state: vMissionState,
  /** Derived from state + requiredDecisionCount; only validated transitions
   *  update it (see `boardColumnForMission` in lib/validators.ts). */
  boardColumn: vBoardColumn,
  /** Optimistic-concurrency version, bumped by every transition. */
  version: v.number(),
  /** Frozen confirmed inputs at dispatch, bound to 64 KiB (§4.2). */
  inputSnapshot: vInputSnapshot,
  /** Version of the frozen input snapshot — the value runs record as
   *  `inputVersion`. Bumps only when inputs are legitimately re-frozen
   *  (a future revise path); never on state transitions. */
  inputVersion: v.number(),
  priority: vMissionPriority,
  assignedEmployeeId: v.id("employees"),
  progressSummary: v.string(),
  /** Open required decisions; >0 pulls the card into Needs you (§6). */
  requiredDecisionCount: v.number(),
  visibility: vMissionVisibility,
  /** identityKey of the creator. */
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  /** Serializable Workflow component ID, assigned once at dispatch. */
  workflowId: v.optional(v.string()),
  /** Generation of the workflow that currently owns this mission; events or
   *  callbacks stamped with an older generation never advance it (§6.2). */
  workflowGeneration: v.number(),
  /** Set on reply/follow-up missions spawned from another mission. */
  parentMissionId: v.optional(v.id("missions")),
  completedAt: v.optional(v.number()),
  /** Terminal technical failure detail (state `failed`). */
  failure: v.optional(
    v.object({
      message: v.string(),
      at: v.number(),
    }),
  ),
  /** Terminal aggregate of explicit child outcomes (§6.1 step 9). */
  outcome: v.optional(
    v.object({
      kind: vMissionOutcome,
      summary: v.string(),
    }),
  ),
  /** Client retry key — `create` dedupes on (workspaceId, requestId)
   *  transactionally instead of double-creating. */
  requestId: v.optional(v.string()),
};

export const missionProspectFields = {
  workspaceId: v.id("workspaces"),
  missionId: v.id("missions"),
  /**
   * Becomes `v.id("prospects")` when P09/P19 lands that table. A bounded
   * string key meanwhile; the dev fixture uses `dev-prospect-*` keys and
   * registration validates the parent mission belongs to the workspace.
   */
  prospectId: v.string(),
  /** Branch generation; bumped when a branch is legitimately re-dispatched. */
  generation: v.number(),
  createdAt: v.number(),
  /** Serializable Workflow ID of the branch's child workflow, once started. */
  childWorkflowId: v.optional(v.string()),
  /** Parent-workflow event ID the child signals with its terminal outcome. */
  completionEventId: v.optional(v.string()),
  outcome: v.optional(vMissionProspectOutcome),
  outcomeReason: v.optional(v.string()),
  completedAt: v.optional(v.number()),
};

export const runFields = {
  workspaceId: v.id("workspaces"),
  missionId: v.id("missions"),
  employeeId: v.id("employees"),
  /** Stage name owned by the pipeline (P09); bounded free-form for now. */
  stage: v.string(),
  /** Attempt generation of this stage's execution. */
  generation: v.number(),
  state: vRunState,
  /** Version of the mission input snapshot this run consumed. */
  inputVersion: v.number(),
  inputSummary: v.string(),
  createdAt: v.number(),
  startedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
  sessionId: v.optional(v.string()),
  outputRefs: v.optional(v.array(v.string())),
  /** Reported usage only — unknown stays absent (§9). */
  usage: v.optional(
    v.object({
      toolCalls: v.optional(v.number()),
      modelCalls: v.optional(v.number()),
      tokens: v.optional(v.number()),
    }),
  ),
  error: v.optional(
    v.object({
      message: v.string(),
      retryable: v.optional(v.boolean()),
    }),
  ),
};

export const decisionFields = {
  workspaceId: v.id("workspaces"),
  missionId: v.id("missions"),
  kind: vDecisionKind,
  state: vDecisionState,
  /** Optimistic-concurrency version; resolve takes `expectedVersion`. */
  version: v.number(),
  /** Required asks hold the mission in Needs you until resolved/superseded. */
  required: v.boolean(),
  /** What a human must answer and why. */
  reason: v.string(),
  /** Semantic-ask identity — at most one OPEN decision per (missionId,
   *  askKey), enforced transactionally in `openRequiredDecision`. */
  askKey: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  /* Continuation binding — assigned by the backend when dispatching, never
   * trusted from a callback payload (§4.2 note). Serializable component ID
   * types, so plain strings. */
  targetWorkflowId: v.string(),
  continuationEventId: v.string(),
  workflowGeneration: v.number(),
  /** Set once the resolution's durable continuation signal was delivered. */
  continuationSentAt: v.optional(v.number()),
  /** requestId that produced this resolution — replayed resolves return the
   *  recorded outcome instead of applying twice. */
  resolutionRequestId: v.optional(v.string()),
  /* §4.3 forward references — become v.id(...) when P10/P11 land their
   * tables (drafts, sendAttempts, approvals). */
  draftId: v.optional(v.string()),
  sendAttemptId: v.optional(v.string()),
  approvalId: v.optional(v.string()),
  /** Field names a `missing_information` ask requests. */
  requestedFields: v.optional(v.array(v.string())),
  answer: v.optional(vDecisionAnswer),
  /** identityKey of the resolver. */
  resolvedBy: v.optional(v.string()),
  resolvedAt: v.optional(v.number()),
};

export const missionCommentFields = {
  workspaceId: v.id("workspaces"),
  missionId: v.id("missions"),
  /** identityKey of the commenting member. */
  authorIdentityKey: v.string(),
  body: v.string(),
  createdAt: v.number(),
  /** Run that consumed this comment as guidance — never an approval. */
  acknowledgedByRunId: v.optional(v.id("runs")),
};

export const activityEventFields = {
  workspaceId: v.id("workspaces"),
  missionId: v.id("missions"),
  kind: v.string(),
  summary: v.string(),
  /** identityKey for human actions; `workflow`/`system` otherwise. */
  actor: v.string(),
  createdAt: v.number(),
  /** Unique per workspace; duplicates are dropped transactionally. */
  dedupeKey: v.string(),
  runId: v.optional(v.id("runs")),
  /** §4.3 forward references — v.id(...) once those tables land. */
  prospectId: v.optional(v.string()),
  conversationId: v.optional(v.string()),
  artifactId: v.optional(v.string()),
};

export default defineSchema({
  workspaces: defineTable(workspaceFields)
    .index("by_ownerIdentityKey", ["ownerIdentityKey"])
    .index("by_inboxRef", ["inboxRef"]),

  memberships: defineTable(membershipFields)
    // Unique (workspaceId, identityKey) pair, enforced transactionally.
    .index("by_workspaceId_and_identityKey", ["workspaceId", "identityKey"])
    .index("by_identityKey_and_status", ["identityKey", "status"]),

  businessProfiles: defineTable(businessProfileFields)
    // One current profile per workspace, enforced transactionally.
    .index("by_workspaceId", ["workspaceId"]),

  employees: defineTable(employeeFields)
    // Exactly one employee per (workspaceId, template), enforced transactionally.
    .index("by_workspaceId_and_template", ["workspaceId", "template"]),

  campaigns: defineTable(campaignFields)
    .index("by_workspaceId_and_status", ["workspaceId", "status"])
    // At most one campaign per (workspaceId, requestId), enforced in `create`.
    .index("by_workspaceId_and_requestId", ["workspaceId", "requestId"]),

  /* §4.2 — work and supervision (P06) */

  missions: defineTable(missionFields)
    // Board pagination: one column at a time, most recently updated first.
    .index("by_workspaceId_and_visibility_and_boardColumn_and_updatedAt", [
      "workspaceId",
      "visibility",
      "boardColumn",
      "updatedAt",
    ])
    // Spec name
    // `by_workspaceId_and_campaignId_and_visibility_and_boardColumn_and_updatedAt`
    // is 73 chars — over Convex's 64-char index-name limit. The field tuple is
    // unchanged; only the name is shortened.
    .index("by_workspaceId_and_campaignId_and_boardColumn_and_updatedAt", [
      "workspaceId",
      "campaignId",
      "visibility",
      "boardColumn",
      "updatedAt",
    ])
    // At most one mission per (workspaceId, requestId), enforced in `create`.
    .index("by_workspaceId_and_requestId", ["workspaceId", "requestId"]),

  missionProspects: defineTable(missionProspectFields)
    // Unique (missionId, prospectId) pair — the stable child start key,
    // enforced transactionally in `registerProspectBranch`.
    .index("by_missionId_and_prospectId", ["missionId", "prospectId"])
    .index("by_prospectId", ["prospectId"])
    .index("by_childWorkflowId", ["childWorkflowId"]),

  runs: defineTable(runFields)
    .index("by_missionId_and_createdAt", ["missionId", "createdAt"])
    .index("by_workspaceId_and_state", ["workspaceId", "state"])
    .index("by_employeeId_and_state", ["employeeId", "state"]),

  decisions: defineTable(decisionFields)
    .index("by_workspaceId_and_state_and_createdAt", [
      "workspaceId",
      "state",
      "createdAt",
    ])
    .index("by_missionId_and_state", ["missionId", "state"])
    // §4.3 forward reference — becomes useful when `drafts` lands (P10).
    .index("by_draftId", ["draftId"]),

  missionComments: defineTable(missionCommentFields).index(
    "by_missionId_and_createdAt",
    ["missionId", "createdAt"],
  ),

  activityEvents: defineTable(activityEventFields)
    .index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"])
    .index("by_missionId_and_createdAt", ["missionId", "createdAt"])
    .index("by_workspaceId_and_dedupeKey", ["workspaceId", "dedupeKey"]),
});
