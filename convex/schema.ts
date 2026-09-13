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
  vControlCommand,
  vControlRequestState,
  vDecisionAnswer,
  vDecisionKind,
  vDecisionState,
  vEmployeeTemplate,
  vInputSnapshot,
  vLifecycleOperation,
  vLifecycleOperationState,
  vMembershipStatus,
  vMissionKind,
  vMissionOutcome,
  vMissionPriority,
  vMissionProspectOutcome,
  vMissionState,
  vMissionVisibility,
  vProviderConnectionState,
  vProviderKind,
  vRole,
  vRunState,
  vRuntimeConnectionState,
  vSlotState,
  vSourcePlan,
  vWorkerDataRef,
  vWorkerOperation,
  vWorkerPhase,
  vWorkerRequestState,
  vWorkerScope,
  vArtifactKind,
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

/* ------------------------------------------------------------------ */
/* §4.4 runtime transport (P07)                                        */
/*                                                                     */
/* External-execution transport state only: Workflow owns stage         */
/* ordering/retries and human waits. These rows carry leases, the       */
/* one-model-run slot, scoped worker credentials, the runtime lifecycle */
/* ledger, owner-control commands and artifact receipts.                */
/* ------------------------------------------------------------------ */

export const runtimeConnectionFields = {
  workspaceId: v.id("workspaces"),
  /** Rotated on every replacement/reconnect — credentials, leases and
   *  callbacks stamped with an older generation stay invalid (§7.7). */
  generation: v.number(),
  state: vRuntimeConnectionState,
  createdAt: v.number(),
  updatedAt: v.number(),
  /** ASCII Box reference — the provider's opaque box ID. */
  boxRef: v.optional(v.string()),
  /** Owner-safe Codex account summary — never email/tokens/files. */
  codexAccountSummary: v.optional(
    v.object({
      state: v.union(
        v.literal("none"),
        v.literal("chatgpt"),
        v.literal("apiKey"),
        v.literal("other"),
      ),
      planType: v.optional(v.string()),
      verifiedAt: v.number(),
    }),
  ),
  lastHeartbeatAt: v.optional(v.number()),
  /** Last reported worker phase (liveness hint; never lease evidence). */
  workerPhase: v.optional(vWorkerPhase),
  workerVersion: v.optional(v.string()),
  protocolVersion: v.optional(v.string()),
  currentCodexTurnRef: v.optional(v.string()),
  currentRunId: v.optional(v.id("runs")),
  error: v.optional(v.string()),
};

export const runtimeLifecycleOperationFields = {
  workspaceId: v.id("workspaces"),
  runtimeConnectionId: v.id("runtimeConnections"),
  runtimeGeneration: v.number(),
  operation: vLifecycleOperation,
  /** Stable dedupe key persisted before the provider call. */
  operationKey: v.string(),
  /** SHA-256 hex of the canonical request — replay compares bodies without
   *  retaining credential-bearing payloads. */
  requestFingerprint: v.string(),
  /** Neutral settings + secure injection references only — no raw
   *  credentials. Validated by `assertLifecycleRequestConfig`. */
  requestConfig: v.any(),
  state: vLifecycleOperationState,
  createdAt: v.number(),
  updatedAt: v.number(),
  boxRef: v.optional(v.string()),
  providerOperationRef: v.optional(v.string()),
  error: v.optional(v.string()),
};

export const providerConnectionFields = {
  workspaceId: v.id("workspaces"),
  provider: vProviderKind,
  state: vProviderConnectionState,
  /** Verified capability IDs only — never assumed. */
  capabilities: v.array(v.string()),
  updatedAt: v.number(),
  runtimeConnectionId: v.optional(v.id("runtimeConnections")),
  remoteReference: v.optional(v.string()),
  verifiedAt: v.optional(v.number()),
  error: v.optional(v.string()),
};

export const workerCredentialFields = {
  workspaceId: v.id("workspaces"),
  runtimeConnectionId: v.id("runtimeConnections"),
  runtimeGeneration: v.number(),
  /** SHA-256 hex of the bearer token; plaintext is never persisted. */
  credentialHash: v.string(),
  scopes: v.array(vWorkerScope),
  expiresAt: v.number(),
  state: v.union(v.literal("active"), v.literal("revoked")),
  createdAt: v.number(),
  /** AES-256-GCM envelope (base64) sealing the plaintext token so a
   *  generation-scoped Box env injection or a reconciled create replay can
   *  recover it server-side; opened only inside provisioning actions under
   *  `OPENSQUAD_WORKER_SEAL_KEY` and never returned by any function. */
  sealedCredential: v.optional(v.string()),
  /** Last authenticated bridge call — diagnostics only. */
  lastUsedAt: v.optional(v.number()),
  /** Last claim-class poll — enforces the minimum poll interval. */
  lastPollAt: v.optional(v.number()),
};

export const runtimeControlRequestFields = {
  workspaceId: v.id("workspaces"),
  runtimeConnectionId: v.id("runtimeConnections"),
  runtimeGeneration: v.number(),
  /** Backend-minted request identity; also the claim dedupe key. */
  requestId: v.string(),
  command: vControlCommand,
  state: vControlRequestState,
  /** identityKey of the generating owner, or `system` for lease-expiry
   *  interrupts issued by the bridge. */
  requestedBy: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
  claimedAt: v.optional(v.number()),
  /** Login challenge reference for start_login/cancel_login. */
  loginId: v.optional(v.string()),
  /** Codex turn/thread references for interrupt_turn. */
  turnId: v.optional(v.string()),
  threadId: v.optional(v.string()),
  /** Sanitized result summary — never challenge material or credentials. */
  safeResult: v.optional(v.any()),
  /** First accepted result identity + digest — repeated identical results
   *  are acknowledged no-ops; a reused resultId with a different digest is
   *  rejected and recorded. */
  resultId: v.optional(v.string()),
  resultDigest: v.optional(v.string()),
  completedAt: v.optional(v.number()),
};

export const runtimeLoginChallengeFields = {
  workspaceId: v.id("workspaces"),
  runtimeConnectionId: v.id("runtimeConnections"),
  runtimeGeneration: v.number(),
  controlRequestId: v.id("runtimeControlRequests"),
  /** Provider-allowlisted verification URL — owner-only, never in feeds. */
  verificationUrl: v.string(),
  userCode: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
};

export const agentSessionFields = {
  workspaceId: v.id("workspaces"),
  employeeId: v.id("employees"),
  /** Campaign- or prospect-scoped session discriminator (bounded string). */
  scopeKey: v.string(),
  runtimeConnectionId: v.id("runtimeConnections"),
  runtimeGeneration: v.number(),
  /** Saved Codex thread reference; resumed only after ownership checks. */
  codexThreadRef: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const workerRequestFields = {
  workspaceId: v.id("workspaces"),
  runtimeConnectionId: v.id("runtimeConnections"),
  runtimeGeneration: v.number(),
  missionId: v.id("missions"),
  runId: v.id("runs"),
  /** Semantic step identity — unique per (missionId, stepKey, generation). */
  stepKey: v.string(),
  /** Attempt generation of this stage execution (mirrors run.generation). */
  generation: v.number(),
  /** §4.5 operation discriminator — selects the accepted result contract. */
  operation: vWorkerOperation,
  state: vWorkerRequestState,
  /** Validated worker input: small inline document or private storage
   *  reference (256 KiB cap, §4.4 note). */
  inputRef: vWorkerDataRef,
  outputSchemaVersion: v.number(),
  /* Continuation binding — assigned by the dispatching backend, never
   * trusted from a callback payload (§4.2 note covers worker requests). */
  targetWorkflowId: v.string(),
  continuationEventId: v.string(),
  workflowGeneration: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  /** SHA-256 hex of the issued lease token — plaintext goes only to the
   *  claiming worker inside the claim response. */
  leaseHash: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  lastHeartbeatAt: v.optional(v.number()),
  /** Last accepted worker-activity time — the 5 s routine-update throttle. */
  lastActivityAt: v.optional(v.number()),
  /** Dedupe of the accepted result: repeated identical results acknowledge;
   *  a reused resultId with a different digest is rejected and recorded. */
  resultId: v.optional(v.string()),
  resultDigest: v.optional(v.string()),
  resultRef: v.optional(vWorkerDataRef),
  /** Forwarded usage — present only when the runtime reported it (§9). */
  usage: v.optional(
    v.object({
      toolCalls: v.optional(v.number()),
      modelCalls: v.optional(v.number()),
      tokens: v.optional(v.number()),
    }),
  ),
  error: v.optional(
    v.object({
      code: v.string(),
      message: v.string(),
      retrySafety: v.optional(
        v.union(
          v.literal("safe"),
          v.literal("unsafe"),
          v.literal("unknown"),
        ),
      ),
    }),
  ),
};

export const workspaceExecutionSlotFields = {
  workspaceId: v.id("workspaces"),
  /** Bumped on every acquisition — a stale slot generation cannot renew. */
  generation: v.number(),
  state: vSlotState,
  updatedAt: v.number(),
  workerRequestId: v.optional(v.id("workerRequests")),
  runId: v.optional(v.id("runs")),
  leaseExpiresAt: v.optional(v.number()),
};

/**
 * §4.3 `artifacts` — defined in THIS block because the P07
 * `POST /worker/artifact` route needs it now. The field map follows the
 * §4.3 contract exactly (plus the transport-provenance `workerRequestId?`);
 * P09 must NOT re-add this table — merge keeps this definition.
 */
export const artifactFields = {
  workspaceId: v.id("workspaces"),
  missionId: v.id("missions"),
  kind: vArtifactKind,
  /** Server-assigned storage ID — the worker never supplies it. */
  storageId: v.id("_storage"),
  mimeType: v.string(),
  byteSize: v.number(),
  /** Server-computed `sha256:<hex>` of the stored bytes. */
  contentDigest: v.string(),
  operationKey: v.string(),
  createdAt: v.number(),
  prospectId: v.optional(v.string()),
  runId: v.optional(v.id("runs")),
  /** The worker request whose lease authorized this upload. */
  workerRequestId: v.optional(v.id("workerRequests")),
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

  /* §4.4 — runtime transport (P07) */

  runtimeConnections: defineTable(runtimeConnectionFields)
    // One active runtime record per workspace, enforced transactionally.
    .index("by_workspaceId", ["workspaceId"]),

  runtimeLifecycleOperations: defineTable(runtimeLifecycleOperationFields)
    .index("by_runtimeConnectionId_and_createdAt", [
      "runtimeConnectionId",
      "createdAt",
    ])
    .index("by_workspaceId_and_operationKey", ["workspaceId", "operationKey"]),

  providerConnections: defineTable(providerConnectionFields).index(
    "by_workspaceId_and_provider",
    ["workspaceId", "provider"],
  ),

  workerCredentials: defineTable(workerCredentialFields)
    // Unique credential hash, enforced transactionally at issuance.
    .index("by_credentialHash", ["credentialHash"])
    .index("by_runtimeConnectionId_and_state", [
      "runtimeConnectionId",
      "state",
    ]),

  runtimeControlRequests: defineTable(runtimeControlRequestFields)
    .index("by_runtimeConnectionId_and_state", [
      "runtimeConnectionId",
      "state",
    ])
    // At most one control request per (workspaceId, requestId).
    .index("by_workspaceId_and_requestId", ["workspaceId", "requestId"]),

  runtimeLoginChallenges: defineTable(runtimeLoginChallengeFields)
    .index("by_runtimeConnectionId", ["runtimeConnectionId"])
    .index("by_expiresAt", ["expiresAt"]),

  agentSessions: defineTable(agentSessionFields)
    // One Codex session per (workspace, employee, scope).
    .index("by_workspaceId_and_employeeId_and_scopeKey", [
      "workspaceId",
      "employeeId",
      "scopeKey",
    ]),

  workerRequests: defineTable(workerRequestFields)
    .index("by_workspaceId_and_state_and_createdAt", [
      "workspaceId",
      "state",
      "createdAt",
    ])
    .index("by_state_and_leaseExpiresAt", ["state", "leaseExpiresAt"])
    .index("by_runId", ["runId"])
    // One transport request per (mission, step, generation).
    .index("by_missionId_and_stepKey_and_generation", [
      "missionId",
      "stepKey",
      "generation",
    ]),

  workspaceExecutionSlots: defineTable(workspaceExecutionSlotFields)
    // The single transactional model-run slot per workspace.
    .index("by_workspaceId", ["workspaceId"]),

  artifacts: defineTable(artifactFields)
    .index("by_missionId_and_createdAt", ["missionId", "createdAt"])
    .index("by_prospectId", ["prospectId"])
    // One artifact per (workspace, operationKey) — deduplicated uploads.
    .index("by_workspaceId_and_operationKey", ["workspaceId", "operationKey"]),
});
