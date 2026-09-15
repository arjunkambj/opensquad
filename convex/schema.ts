/**
 * OpenSquad schema — §4.1 workspace/configuration tables (P02), the §4.2
 * work/supervision tables (P06), the §4.4 runtime transport and usage tables
 * (P07/P10), the §4.3 correspondence tables (P10) and the §4.3 lead, booking
 * and evidence tables (P20). Component-owned mail/crawl tables never enter
 * this schema. Every table is declared exactly once: a task that writes rows
 * imports the `*Fields` map, it does not re-declare the table.
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
  vApprovalVerdict,
  vBoardColumn,
  vCampaignStatus,
  vCapabilityId,
  vControlCommand,
  vControlRequestState,
  vConversationNoteKind,
  vConversationState,
  vDecisionAnswer,
  vDecisionKind,
  vDecisionState,
  vEmailEventDirection,
  vEmailEventHandlingState,
  vQuarantineReason,
  vQuarantineState,
  vEmployeeTemplate,
  vEndpointOperation,
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
  vSendAttemptState,
  vSlotState,
  vSourcePlan,
  vSuppressionKind,
  vSuppressionReason,
  vProviderOperationState,
  vUsageMetric,
  vUsageReservationState,
  vWorkerDataRef,
  vWorkerOperation,
  vWorkerPhase,
  vWorkerRequestState,
  vWorkerScope,
  vArtifactKind,
  vBookingProposal,
  vBookingState,
  vConfirmationSource,
  vEvidenceConfidence,
  vLeadEventActor,
  vLeadEventDetails,
  vLeadEventKind,
  vNextAction,
  vProspectContact,
  vProspectSourceRef,
  vQualification,
  vReplyDisposition,
  vSalesStage,
  vTakeoverReason,
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
   * Still a bounded string key after P20 declared `prospects`: the ONLY
   * producer today is the dev fixture's synthetic `dev-prospect-*` keys,
   * which are not document IDs, so `v.id("prospects")` would fail both
   * statically and at insert validation. It also flows into the durable
   * `vBranchCompletion` workflow event, which cannot change validator under
   * an in-flight journal. P21 retypes it in the commit that replaces the
   * fixture scan with real `prospects` rows.
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
  /** Mirrors `missionProspects.prospectId`, so it carries the same synthetic
   *  fixture keys and is retyped with it in P21 — not here. */
  prospectId: v.optional(v.string()),
  /* `conversations` and `artifacts` have landed, but retyping these two is
   * P11's and P09's call at the modules that write them (`activity.ts`
   * `ActivityInput` moves with them); `artifactId` has no writer at all yet.
   * P20 touches only the four tables it declares. */
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
  /** The capability set Convex ISSUED for this request, derived at dispatch
   *  from the run's employee ∩ `HOST_CAPABILITY_POLICY`. This column — not
   *  the mirror inside `inputRef.value` and never anything the worker sends
   *  — is the authority every tool route re-checks. Optional only because
   *  rows predating P21 exist on the dev deployment; ABSENT MEANS NONE, and
   *  every read site treats `undefined` as `[]` and denies. */
  capabilities: v.optional(v.array(vCapabilityId)),
  /** Tool calls this request has been authorized for, compared against
   *  `inputRef.value.constraints.maxToolCalls` inside the authorizing
   *  transaction. Absent means zero. */
  toolCallsUsed: v.optional(v.number()),
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
  /** Externally supplied: the worker's `x-prospect-id` upload header, bounded
   *  and validated at `workerBridge.uploadArtifact`. A value crossing the trust
   *  boundary stays a validated string; the internally produced prospect
   *  references on `evidence` and `leadEvents` are real `v.id`s. */
  prospectId: v.optional(v.string()),
  runId: v.optional(v.id("runs")),
  /** The worker request whose lease authorized this upload. */
  workerRequestId: v.optional(v.id("workerRequests")),
};

/* ------------------------------------------------------------------ */
/* §4.3 leads, bookings and evidence (P20)                             */
/*                                                                     */
/* THE single declaration site for `prospects`, `leadEvents`,          */
/* `bookings` and `evidence`. P09 (sourcing), P11 (inbox), P19 (CRM    */
/* and booking behavior) and P21 (pipeline) all write these rows and   */
/* none of them re-declares a table or opens a second lead store.      */
/* P20 declares contracts only — no mutation lives in this slice.      */
/* ------------------------------------------------------------------ */

/**
 * Prospects — the lead/CRM entity (`prospects` is the backend name; the UI
 * says Leads). Two facts stay deliberately orthogonal: `qualification` is
 * whether the company fits, `salesStage` is how far the conversation has
 * travelled, and `contact` is whether an address exists. A missing email
 * therefore never erases fit evidence.
 *
 * One prospect per (campaignId, canonicalDomain) — the index is a lookup, so
 * the inserting mutation enforces it transactionally. `sourceRefs` merges on
 * re-discovery rather than being replaced, which is why provenance survives a
 * second source finding the same company.
 *
 * `version` is optimistic concurrency: every CRM mutation takes an
 * `expectedVersion` and fails CONFLICT rather than clobbering a concurrent
 * stage change.
 */
export const prospectFields = {
  workspaceId: v.id("workspaces"),
  campaignId: v.id("campaigns"),
  companyName: v.string(),
  /** Dedupe key — normalized host, meaningful subdomains preserved. */
  canonicalDomain: v.string(),
  /** At most 10 distinct refs; merged, never overwritten, on re-discovery. */
  sourceRefs: v.array(vProspectSourceRef),
  qualification: vQualification,
  fitReason: v.string(),
  salesStage: vSalesStage,
  /** identityKey of the owner; must resolve to an ACTIVE membership. */
  ownerIdentityKey: v.string(),
  /** Optimistic-concurrency version; bumped by every CRM mutation. */
  version: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  /** The one selected business person (MVP), absent until enrichment. */
  contact: v.optional(vProspectContact),
  nextAction: v.optional(vNextAction),
  /** UTC ms derived from the selected timezone. ABSENT means unscheduled —
   *  an explicit state the CRM renders, never a far-future sentinel. */
  nextActionDueAt: v.optional(v.number()),
  /** Set from a send ACCEPTANCE fact, not from drafting. */
  lastContactedAt: v.optional(v.number()),
  /** Set from a verified inbound reply. */
  lastReplyAt: v.optional(v.number()),
  /** Stated basis for the current stage; required for human corrections. */
  stageReason: v.optional(v.string()),
};

/**
 * Lead events — the append-only CRM history (status, owner, note, next action
 * and booking transitions). Rows are never edited or deleted: a stage
 * correction appends a row preserving `fromStage`, it does not rewrite one.
 * Every business update and its event are written in ONE transaction
 * (§8 "CRM and booking transitions"),
 * so the history can never disagree with the lead.
 *
 * `actor` is a discriminated union so "comes from auth or internal workflow"
 * is structural — model output and email content can never name an actor.
 * `operationKey` is unique per workspace, enforced in the inserting mutation.
 */
export const leadEventFields = {
  workspaceId: v.id("workspaces"),
  prospectId: v.id("prospects"),
  kind: vLeadEventKind,
  actor: vLeadEventActor,
  summary: v.string(),
  createdAt: v.number(),
  /** Idempotency key; unique per workspace, enforced transactionally. */
  operationKey: v.string(),
  fromStage: v.optional(vSalesStage),
  toStage: v.optional(vSalesStage),
  bookingId: v.optional(v.id("bookings")),
  missionId: v.optional(v.id("missions")),
  runId: v.optional(v.id("runs")),
  /** Closed previous/new payload §8 "CRM and booking transitions" requires
   *  an event to preserve. */
  details: v.optional(vLeadEventDetails),
};

/**
 * Bookings — operator-authored meeting records. At most one `proposed` or
 * `confirmed` booking per lead, checked transactionally through
 * `by_prospectId_and_state`. A proposal implies NO confirmation: a sent link,
 * an offered slot or a model's reading of a reply all leave the row
 * `proposed`.
 *
 * `startsAt`/`endsAt`/`timezone` are REQUIRED once the state is `confirmed`,
 * `completed` or `no_show`, together with `confirmationSource: manual`, an
 * authenticated `confirmedBy`/`confirmedAt` and a short stated
 * `confirmationNote`. `externalEventRef` is stored only when a real provider
 * event exists — `confirmationSource: provider` stays unavailable until a
 * validated calendar connector verifies one. None of this CRUD sends an
 * invitation or alters a remote calendar.
 */
export const bookingFields = {
  workspaceId: v.id("workspaces"),
  prospectId: v.id("prospects"),
  /** identityKey of the responsible member; must be an ACTIVE membership. */
  ownerIdentityKey: v.string(),
  state: vBookingState,
  version: v.number(),
  proposal: vBookingProposal,
  createdAt: v.number(),
  updatedAt: v.number(),
  conversationId: v.optional(v.id("conversations")),
  missionId: v.optional(v.id("missions")),
  /** The exact proposal draft whose acceptance may advance the lead. */
  draftId: v.optional(v.id("drafts")),
  startsAt: v.optional(v.number()),
  endsAt: v.optional(v.number()),
  /** IANA zone of the CONFIRMED meeting — distinct from the zone a `slots`
   *  proposal offered, which a reschedule does not rewrite. */
  timezone: v.optional(v.string()),
  confirmationSource: v.optional(vConfirmationSource),
  /** identityKey of the authenticated human who asserted the agreed time. */
  confirmedBy: v.optional(v.string()),
  confirmedAt: v.optional(v.number()),
  externalEventRef: v.optional(v.string()),
  /** Short basis, e.g. "prospect confirmed by reply". */
  confirmationNote: v.optional(v.string()),
  cancellationReason: v.optional(v.string()),
};

/**
 * Evidence — one observation with the source it came from (§4.3/§4.5).
 * Excerpts are bounded to 2,000 characters and at most 12 observations are
 * accepted per research result; the full output lives in storage behind
 * `artifactId`. `retrievedAt` is the worker's source-retrieval timestamp —
 * evidence metadata, never a permission or accounting timestamp (§4.5).
 * Drafts may link only evidence from the same workspace AND prospect.
 */
export const evidenceFields = {
  workspaceId: v.id("workspaces"),
  prospectId: v.id("prospects"),
  /** The run that produced this observation — always an execution receipt. */
  runId: v.id("runs"),
  /** Validated public http/https source. */
  sourceUrl: v.string(),
  retrievedAt: v.number(),
  excerpt: v.string(),
  observation: v.string(),
  confidence: vEvidenceConfidence,
  createdAt: v.number(),
  artifactId: v.optional(v.id("artifacts")),
};

/* ------------------------------------------------------------------ */
/* §4.3 correspondence (P10) — conversations, immutable drafts,         */
/* approvals, send attempts, suppressions and provider-event receipts.  */
/* `artifacts` is declared in the §4.4 block above (P07 needs it);      */
/* `prospects`/`leadEvents`/`bookings`/`evidence` in the block above.   */
/* ------------------------------------------------------------------ */

/**
 * Conversations — full §4.3 table. P11 builds the public
 * `conversations.ts` module; P10 needs the table now because drafts,
 * approvals and send attempts all bind `contextVersion`/`currentDraftId`
 * here, and provides only the minimal internal helpers in `drafts.ts` plus the
 * send-acknowledgement thread mapping in `sending.ts`.
 */
export const conversationFields = {
  workspaceId: v.id("workspaces"),
  /** AgentMail inbox reference this conversation lives on. */
  inboxRef: v.string(),
  employeeId: v.id("employees"),
  state: vConversationState,
  /** When true, automation is frozen: no sends, drafts or reply workflows. */
  humanTakeover: v.boolean(),
  /**
   * Advances on inbound replies, takeover/assignment/closure and new current
   * draft revisions — every fact that invalidates "nothing changed since the
   * draft was written". Approvals and send preflight pin this version.
   */
  contextVersion: v.number(),
  unreadCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  /** Association target for §5 `conversations.associateProspect` (P11).
   *  Internally produced — the association is made by an authorized operator
   *  against a lead already in this workspace, never from a provider payload. */
  prospectId: v.optional(v.id("prospects")),
  /**
   * The campaign this thread's reply work runs under, FROZEN at association.
   * `missionFields.campaignId` is required, so a reply mission needs one; and
   * recording what was agreed when the lead was linked means a later
   * re-campaigning of that lead cannot silently retarget in-flight reply
   * work. Written only by `conversations.associateProspect`, which refuses a
   * campaign the prospect does not belong to.
   */
  campaignId: v.optional(v.id("campaigns")),
  /**
   * Human owner of this thread (identityKey). Must resolve to an ACTIVE
   * membership before it is stored — the same rule `prospects.ownerIdentityKey`
   * carries. Distinct from `employeeId`, which assigns the MACHINE.
   */
  assigneeIdentityKey: v.optional(v.string()),
  /** Why automation is frozen. Present whenever `humanTakeover` is true. */
  takeoverReason: v.optional(vTakeoverReason),
  /** identityKey of the operator who froze it, or `"system"`. */
  takeoverBy: v.optional(v.string()),
  /** When the current hold started — "held since", and stale-hold ordering. */
  takeoverAt: v.optional(v.number()),
  /**
   * Product-level meaning of the most recent inbound reply, so the inbox row
   * can show its classification tag (`plan/ux.md` §165) without reading a
   * `workerRequests` transport row per listed conversation.
   */
  lastDisposition: v.optional(vReplyDisposition),
  lastDispositionAt: v.optional(v.number()),
  /**
   * Normalized sender of the most recent inbound message, when it parsed as
   * one address. Stored as DATA: it never selects a workspace or a
   * conversation and never becomes a send recipient. `conversations.resume`
   * compares it against the associated lead's contact, where a mismatch
   * BLOCKS the resume — it can refuse, never grant.
   */
  lastInboundFrom: v.optional(v.string()),
  /** Per-inbox provider thread id (AgentMail thread ids are per-inbox). */
  providerThreadRef: v.optional(v.string()),
  currentDraftId: v.optional(v.id("drafts")),
  lastInboundMessageRef: v.optional(v.string()),
  lastInboundAt: v.optional(v.number()),
  lastMessageAt: v.optional(v.number()),
};

/**
 * Internal notes on a conversation (P11) — the audit trail a thread with no
 * mission is otherwise denied. `activityEventFields.missionId`,
 * `decisionFields.missionId` and `missionCommentFields.missionId` are all
 * required `v.id("missions")`, and an unassigned conversation has no mission
 * (a mission needs a campaign, which needs an associated lead), so none of
 * those three can record its intake, takeover, association or closure.
 *
 * `kind: "system"` rows are those lifecycle records; `kind: "note"` rows are
 * human annotations. Rows are append-only, and — keeping `activity.ts`'s
 * invariant for `missionComments` verbatim — a note can NEVER resolve a
 * business approval: this table has no path to decision state.
 *
 * Notes do not bump `conversations.contextVersion`. Architecture §8 limits
 * bumps to inbound replies, takeover/assignment/closure and explicit context
 * changes; a private annotation must not invalidate every live approval.
 */
export const conversationNoteFields = {
  workspaceId: v.id("workspaces"),
  conversationId: v.id("conversations"),
  kind: vConversationNoteKind,
  /** identityKey of the author, or `"system"`. */
  actor: v.string(),
  body: v.string(),
  createdAt: v.number(),
};

/**
 * Drafts — immutable revisions of the exact send payload (§8). Every send
 * field is frozen per row; `payloadHash` commits to the canonical
 * serialization of {endpointOperation, inboxRef, normalizedRecipient,
 * subject, body, replyToMessageRef}. A revision can never be edited in
 * place — `drafts.revise`/`createRevision` insert a new row and move
 * `conversations.currentDraftId`.
 */
export const draftFields = {
  workspaceId: v.id("workspaces"),
  conversationId: v.id("conversations"),
  /** Sender inbox the payload will go out through (provider inbox id). */
  inboxRef: v.string(),
  missionId: v.id("missions"),
  /** 1-based revision number within the conversation; rows are immutable. */
  revision: v.number(),
  /** Address as supplied; `normalizedRecipient` is the canonical form. */
  recipient: v.string(),
  normalizedRecipient: v.string(),
  subject: v.string(),
  body: v.string(),
  payloadHash: v.string(),
  /** `conversations.contextVersion` the content was written against. */
  basedOnContextVersion: v.number(),
  campaignBriefVersion: v.number(),
  policyVersion: v.number(),
  /**
   * §4.3 evidence links. Still `v.string()` after P20 declared `evidence`:
   * the values arrive as `vDraftResult.evidenceRefs` label/artifact/storage
   * strings from the worker, so they are externally supplied until a backend
   * step resolves them to rows. P21 owns that resolution and the retype.
   */
  evidenceIds: v.array(v.string()),
  /** identityKey for human edits; `workflow` for pipeline-proposed drafts. */
  createdBy: v.string(),
  createdAt: v.number(),
  /** Parent provider message id — makes the attempt a `reply` operation. */
  replyToMessageRef: v.optional(v.string()),
  supersededAt: v.optional(v.number()),
  /* Booking-invitation drafts only (§4.3): the proposal this content offers
   * and the booking version it was written against. Both are re-validated on
   * approval AND on dispatch, so a rescheduled or cancelled booking can never
   * go out under the old approval. P19 writes them; P20 declares them here
   * because `bookings` and `drafts` share this one declaration site. */
  bookingId: v.optional(v.id("bookings")),
  bookingVersion: v.optional(v.number()),
  /** Client retry key — `revise`/`createRevision` dedupe on
   *  (workspaceId, requestId) transactionally. */
  requestId: v.optional(v.string()),
};

/**
 * Approvals — one immutable verdict per resolution of a `draft_approval`
 * decision, bound to the exact payloadHash + normalizedRecipient +
 * contextVersion. A later edit supersedes applicability, not the record.
 */
export const approvalFields = {
  workspaceId: v.id("workspaces"),
  draftId: v.id("drafts"),
  draftRevision: v.number(),
  payloadHash: v.string(),
  normalizedRecipient: v.string(),
  /** `conversations.contextVersion` at resolution — preflight re-checks it
   *  has not advanced before dispatch. */
  contextVersion: v.number(),
  decision: vApprovalVerdict,
  approverIdentityKey: v.string(),
  createdAt: v.number(),
  /** Client retry key — (workspaceId, requestId) dedupe makes a replayed
   *  resolve return the recorded row. */
  requestId: v.string(),
};

/**
 * Send attempts — the ONE logical send per draft revision (§8.3). Durable
 * intent (`reserved`) is committed before any network I/O; `requesting`
 * marks the dispatch boundary — no local action can retract an HTTP request
 * already sent. `providerDeliveryFacts` carries verified webhook facts only,
 * never a second transport-truth store.
 */
export const sendAttemptFields = {
  workspaceId: v.id("workspaces"),
  draftId: v.id("drafts"),
  approvalId: v.id("approvals"),
  conversationId: v.id("conversations"),
  inboxRef: v.string(),
  /** Stable semantic key — `send:<draftId>:<n>` assigned at reservation. */
  operationKey: v.string(),
  endpointOperation: vEndpointOperation,
  /** Generated once at reservation; NEVER regenerated or rotated (G3). */
  providerIdempotencyKey: v.string(),
  state: vSendAttemptState,
  payloadHash: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  providerMessageRef: v.optional(v.string()),
  providerThreadRef: v.optional(v.string()),
  /** Verified delivery facts folded in from `emailEventReceipts`. */
  providerDeliveryFacts: v.optional(
    v.object({
      lastEventType: v.optional(v.string()),
      lastEventAt: v.optional(v.number()),
      deliveredAt: v.optional(v.number()),
      bouncedAt: v.optional(v.number()),
      complainedAt: v.optional(v.number()),
      rejectedAt: v.optional(v.number()),
      eventIds: v.optional(v.array(v.string())),
    }),
  ),
  /** The resolved delivery_uncertain decision authorizing THIS attempt as
   *  the single recorded replacement for a prior uncertain attempt (§8.7). */
  replacementDecisionId: v.optional(v.id("decisions")),
  requestStartedAt: v.optional(v.number()),
  /** When a `reserved` (parked) attempt may dispatch — recorded so the row
   *  self-describes its wake condition and the stale-attempt sweep can
   *  re-drive one whose scheduled wake was lost. */
  nextPermittedAt: v.optional(v.number()),
  /** The replacement attempt that covers THIS uncertain attempt — set when
   *  a `delivery_uncertain` decision authorized the replacement (§8.7).
   *  Coverage is transitive down the chain, so a re-uncertain replacement
   *  only needs a fresh decision for the latest open uncertainty. */
  coveredByAttemptId: v.optional(v.id("sendAttempts")),
  error: v.optional(
    v.object({
      message: v.string(),
      at: v.number(),
      httpStatus: v.optional(v.number()),
      reason: v.optional(v.string()),
    }),
  ),
  reconciledAt: v.optional(v.number()),
};

/**
 * Suppressions — explicit email or domain blocks (§4.3). Domain suppression
 * is always explicit, never inferred from one person's unsubscribe.
 */
export const suppressionFields = {
  workspaceId: v.id("workspaces"),
  kind: vSuppressionKind,
  normalizedValue: v.string(),
  reason: vSuppressionReason,
  createdAt: v.number(),
  sourceConversationId: v.optional(v.id("conversations")),
};

/**
 * Provider event receipts (§4.3): the application's dedupe/replay record for
 * verified provider events. `applicationKey` dedupes the business effect
 * (`incoming:<inbox>:<message>` for inbound; `outbound:<messageRef>:<type>`
 * for delivery facts); `providerEventId` dedupes delivery. Delivery events
 * that arrive before the send attempt recorded its providerMessageRef stay
 * `pending` and are folded in by `sending.ts` afterwards. P11 consumes the
 * pending rows fully; `providerFacts` holds only necessary verified fields —
 * never another copy of message bodies.
 */
export const emailEventReceiptFields = {
  workspaceId: v.id("workspaces"),
  inboxRef: v.string(),
  providerEventId: v.string(),
  applicationKey: v.string(),
  providerMessageRef: v.string(),
  eventType: v.string(),
  receivedAt: v.number(),
  /**
   * Which half of the mail path this row belongs to, derived from
   * `applicationKey` by `directionForApplicationKey` so the two can never
   * disagree. It exists to keep the inbound drain's filter INSIDE its index
   * range: the two halves settle by different routes, so an outbound receipt
   * whose message ref never lands on a send attempt stays `pending` forever
   * and would otherwise fill the oldest-first scan window.
   */
  direction: vEmailEventDirection,
  handlingState: vEmailEventHandlingState,
  /** Bounded projection of the verified event (≤4 KiB enforced on write). */
  providerFacts: v.record(v.string(), v.any()),
  providerThreadRef: v.optional(v.string()),
  handledAt: v.optional(v.number()),
  error: v.optional(v.string()),
};

/**
 * Quarantined provider events (§4.3, integrations.md §G3 "Unknown inboxes are
 * quarantined").
 *
 * `emailEventReceipts.workspaceId` is required, and it should stay required —
 * every consumer of that table reads it inside a workspace. But a verified
 * event for an inbox no workspace claims has no workspace to be filed under,
 * and dropping it loses the mail permanently: the component has already
 * marked the `event_id` ingested, so the provider's retry returns before
 * enqueueing any callback, and nothing else records that the message existed.
 *
 * So the unattributable ones land here instead — PROVIDER IDENTIFIERS ONLY,
 * the same discipline as the receipt table and the log lines. The body stays
 * where it already is, in the component's own `inboundMessages` row, which is
 * what makes a replay possible once the assignment is corrected without this
 * table becoming the second message store §4.3 forbids.
 */
export const quarantinedEmailEventFields = {
  inboxRef: v.string(),
  providerEventId: v.string(),
  applicationKey: v.string(),
  providerMessageRef: v.string(),
  providerThreadRef: v.optional(v.string()),
  eventType: v.string(),
  reason: vQuarantineReason,
  receivedAt: v.number(),
  state: vQuarantineState,
  /**
   * The provider's own `timestamp`, carried so a replayed delivery fact keeps
   * the stamp it arrived with. Never an ordering authority — the component's
   * parse silently degrades to `Date.now()`.
   */
  providerTimestamp: v.optional(v.number()),
  releasedAt: v.optional(v.number()),
  releasedTo: v.optional(v.id("workspaces")),
  /** A bounded reason written by the application; never provider text. */
  note: v.optional(v.string()),
};

/* ------------------------------------------------------------------ */
/* §4.4 usage (P10) — send bucket + reservations. The §4.4 runtime      */
/* transport tables (runtimeConnections, workerRequests, …) belong to   */
/* P07 and are intentionally NOT declared here.                         */
/* ------------------------------------------------------------------ */

/**
 * Usage buckets — atomic capacity counters (§9). `reserved + committed +
 * uncertain <= limit` is enforced inside the reserving transaction;
 * `periodKey` is the workspace-local day for `sends` and the campaign
 * lifetime for enrichment.
 */
export const usageBucketFields = {
  workspaceId: v.id("workspaces"),
  /** `workspace` for sends; `campaign:<id>` for campaign-lifetime metrics. */
  scopeKey: v.string(),
  metric: vUsageMetric,
  periodKey: v.string(),
  limit: v.number(),
  reserved: v.number(),
  committed: v.number(),
  uncertain: v.number(),
  updatedAt: v.number(),
};

/** One debit lifecycle per logical operation/bucket (§4.4). */
export const usageReservationFields = {
  workspaceId: v.id("workspaces"),
  bucketId: v.id("usageBuckets"),
  operationKey: v.string(),
  quantity: v.number(),
  state: vUsageReservationState,
  createdAt: v.number(),
  updatedAt: v.number(),
  providerReference: v.optional(v.string()),
};

/**
 * §4.4 `providerOperations` — the dedupe/accounting record for ONE paid
 * provider invocation. G2's gateway contract item 3 requires that "a
 * duplicate invocation ID returns its recorded result or status" and that
 * "ambiguous failures consume the reservation until reconciled"; before this
 * table there was nowhere to record either.
 *
 * The row is written in the SAME transaction as the `usage.reserve` it owns,
 * before the provider is contacted, so there is no window in which a paid
 * call exists with no record of it. `reservationIds` names the reservations
 * the settle path must move, so a caller can never settle a different debit
 * than the one it took.
 */
export const providerOperationFields = {
  workspaceId: v.id("workspaces"),
  provider: vProviderKind,
  /** Stable semantic invocation id. A repeat returns the recorded result or
   *  status instead of forwarding a second paid request. */
  operationKey: v.string(),
  missionId: v.id("missions"),
  /** sha256 of the canonical {provider, tool, arguments}. A reused
   *  operationKey carrying different arguments is a CONFLICT, never a
   *  replay — the same rule `checkArtifactGrant` applies to content. */
  requestDigest: v.string(),
  /** The usage reservations this operation took, settled together. */
  reservationIds: v.array(v.id("usageReservations")),
  state: vProviderOperationState,
  createdAt: v.number(),
  updatedAt: v.number(),
  prospectId: v.optional(v.id("prospects")),
  runId: v.optional(v.id("runs")),
  /* Continuation binding — present ONLY for a callback-correlated operation
   * (a durable crawl). The bounded synchronous scrape and the lease-bound
   * tool route complete inside their own action and have no continuation to
   * correlate, so they leave these absent rather than inventing one. */
  targetWorkflowId: v.optional(v.string()),
  continuationEventId: v.optional(v.string()),
  workflowGeneration: v.optional(v.number()),
  /** The provider's own reference for the request — the backend receipt. */
  componentRequestRef: v.optional(v.string()),
  resultRef: v.optional(vWorkerDataRef),
  resultDigest: v.optional(v.string()),
  error: v.optional(v.object({ code: v.string(), message: v.string() })),
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
    // Chronological ask history for one mission (`listForMission`).
    .index("by_missionId_and_createdAt", ["missionId", "createdAt"])
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
    // Stuck-op sweep: `uncertain`, stale `accepted` and stale `pending` rows.
    .index("by_state_and_updatedAt", ["state", "updatedAt"])
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

  /* §4.3 — leads, bookings and evidence (P20) */

  prospects: defineTable(prospectFields)
    // Pipeline mode: one stage at a time, most recently updated first.
    .index("by_workspaceId_and_salesStage_and_updatedAt", [
      "workspaceId",
      "salesStage",
      "updatedAt",
    ])
    .index("by_workspaceId_and_campaignId_and_salesStage", [
      "workspaceId",
      "campaignId",
      "salesStage",
    ])
    // Due-action mode, scoped to one owner…
    .index("by_workspaceId_and_ownerIdentityKey_and_nextActionDueAt", [
      "workspaceId",
      "ownerIdentityKey",
      "nextActionDueAt",
    ])
    // …and across the workspace. Rows with no due time sort together, which
    // is how the unscheduled state stays visible instead of being filtered.
    .index("by_workspaceId_and_nextActionDueAt", [
      "workspaceId",
      "nextActionDueAt",
    ])
    // One prospect per (campaignId, canonicalDomain) — a lookup, not a
    // constraint; the inserting mutation enforces uniqueness.
    .index("by_workspaceId_and_campaignId_and_canonicalDomain", [
      "workspaceId",
      "campaignId",
      "canonicalDomain",
    ])
    // Company-name search. Equality filters are applied INSIDE
    // `withSearchIndex`; search mode never combines with due ranges or date
    // sorting, and empty text falls back to the ordinary list (§4.3).
    .searchIndex("search_company_name", {
      searchField: "companyName",
      filterFields: [
        "workspaceId",
        "salesStage",
        "campaignId",
        "ownerIdentityKey",
      ],
    }),

  leadEvents: defineTable(leadEventFields)
    .index("by_prospectId_and_createdAt", ["prospectId", "createdAt"])
    // Unique (workspaceId, operationKey) — the idempotency lookup a replayed
    // CRM mutation reads before writing; uniqueness is enforced in that same
    // transaction.
    .index("by_workspaceId_and_operationKey", ["workspaceId", "operationKey"]),

  bookings: defineTable(bookingFields)
    .index("by_prospectId_and_createdAt", ["prospectId", "createdAt"])
    // The at-most-one-active check: `proposed` and `confirmed` rows for one
    // lead, read inside the proposing/confirming transaction.
    .index("by_prospectId_and_state", ["prospectId", "state"])
    .index("by_workspaceId_and_state_and_startsAt", [
      "workspaceId",
      "state",
      "startsAt",
    ])
    .index("by_workspaceId_and_ownerIdentityKey_and_startsAt", [
      "workspaceId",
      "ownerIdentityKey",
      "startsAt",
    ]),

  evidence: defineTable(evidenceFields).index("by_prospectId_and_createdAt", [
    "prospectId",
    "createdAt",
  ]),

  /* §4.3 — correspondence (P10) */

  conversations: defineTable(conversationFields)
    .index("by_workspaceId_and_state_and_lastMessageAt", [
      "workspaceId",
      "state",
      "lastMessageAt",
    ])
    .index("by_workspaceId_and_humanTakeover_and_lastMessageAt", [
      "workspaceId",
      "humanTakeover",
      "lastMessageAt",
    ])
    // Unique (inboxRef, providerThreadRef) mapping when the thread ref is
    // assigned — enforced transactionally (§4.3 invariant).
    .index("by_inboxRef_and_providerThreadRef", [
      "inboxRef",
      "providerThreadRef",
    ])
    // Two DISJOINT exact ranges for the bounded attention count: unassigned
    // threads, and open threads under takeover. Summing the plain takeover
    // index would double-count, because every unassigned thread is also under
    // takeover; scoping the second bucket to `state: "open"` removes the
    // overlap without post-filtering a truncated page (§5).
    .index("by_workspaceId_and_state_and_humanTakeover", [
      "workspaceId",
      "state",
      "humanTakeover",
    ])
    .index("by_prospectId", ["prospectId"]),

  conversationNotes: defineTable(conversationNoteFields).index(
    "by_conversationId_and_createdAt",
    ["conversationId", "createdAt"],
  ),

  drafts: defineTable(draftFields)
    // Unique (conversationId, revision) pair, enforced transactionally.
    .index("by_conversationId_and_revision", ["conversationId", "revision"])
    .index("by_missionId", ["missionId"])
    // requestId dedupe for revise/createRevision retries.
    .index("by_workspaceId_and_requestId", ["workspaceId", "requestId"]),

  approvals: defineTable(approvalFields)
    .index("by_draftId", ["draftId"])
    // One resolution per (workspaceId, requestId), enforced transactionally.
    .index("by_workspaceId_and_requestId", ["workspaceId", "requestId"]),

  sendAttempts: defineTable(sendAttemptFields)
    .index("by_draftId", ["draftId"])
    // The §8.3 across-revisions guard: queries reserved|requesting|uncertain
    // per conversation inside the reservation mutation.
    .index("by_conversationId_and_state", ["conversationId", "state"])
    // Chronological audit listing — the unfiltered conversation view is
    // newest-first, not state-bucketed.
    .index("by_conversationId_and_createdAt", ["conversationId", "createdAt"])
    .index("by_replacementDecisionId", ["replacementDecisionId"])
    .index("by_workspaceId_and_state_and_updatedAt", [
      "workspaceId",
      "state",
      "updatedAt",
    ])
    // Workspace-agnostic sweeps: stale `requesting` rows and parked
    // `reserved` rows whose recorded wake time has passed.
    .index("by_state_and_updatedAt", ["state", "updatedAt"])
    .index("by_state_and_nextPermittedAt", ["state", "nextPermittedAt"])
    // Stable logical-send key; uniqueness enforced transactionally.
    .index("by_workspaceId_and_operationKey", ["workspaceId", "operationKey"])
    .index("by_providerMessageRef", ["providerMessageRef"]),

  suppressions: defineTable(suppressionFields)
    // Unique (workspaceId, kind, normalizedValue), enforced transactionally.
    .index("by_workspaceId_and_kind_and_normalizedValue", [
      "workspaceId",
      "kind",
      "normalizedValue",
    ]),

  emailEventReceipts: defineTable(emailEventReceiptFields)
    // Unique provider event delivery, enforced transactionally.
    .index("by_providerEventId", ["providerEventId"])
    // Unique application handling key, enforced transactionally.
    .index("by_workspaceId_and_applicationKey", [
      "workspaceId",
      "applicationKey",
    ])
    // Delivery-fact lookup when the send attempt records its message ref.
    .index("by_providerMessageRef", ["providerMessageRef"])
    // The drain's exact range: one half of the mail path, still pending,
    // older than the cutoff, oldest first. `direction` leads so the sweep
    // never pages through the other half's permanently-pending rows (§5 — a
    // post-filtered page is not a filtered result).
    .index("by_direction_and_handlingState_and_receivedAt", [
      "direction",
      "handlingState",
      "receivedAt",
    ]),

  quarantinedEmailEvents: defineTable(quarantinedEmailEventFields)
    // One row per provider event, enforced transactionally.
    .index("by_providerEventId", ["providerEventId"])
    // The replay range: everything still held for one inbox, oldest first.
    .index("by_inboxRef_and_state", ["inboxRef", "state"])
    // Bounded operator listing across inboxes.
    .index("by_state_and_receivedAt", ["state", "receivedAt"]),

  /* §4.4 — usage (P10) */

  usageBuckets: defineTable(usageBucketFields)
    // Unique bucket per (workspaceId, scopeKey, metric, periodKey), enforced
    // transactionally in usage.reserve.
    .index("by_workspaceId_and_scopeKey_and_metric_and_periodKey", [
      "workspaceId",
      "scopeKey",
      "metric",
      "periodKey",
    ]),

  usageReservations: defineTable(usageReservationFields)
    // One debit lifecycle per logical operation/bucket, enforced
    // transactionally.
    .index("by_workspaceId_and_operationKey_and_bucketId", [
      "workspaceId",
      "operationKey",
      "bucketId",
    ])
    .index("by_bucketId_and_state", ["bucketId", "state"]),

  providerOperations: defineTable(providerOperationFields)
    // The dedupe lookup: one operation per (workspace, provider, key),
    // enforced transactionally inside the reserving mutation.
    .index("by_workspaceId_and_provider_and_operationKey", [
      "workspaceId",
      "provider",
      "operationKey",
    ])
    // Callback correlation for a provider that answers asynchronously.
    .index("by_provider_and_componentRequestRef", [
      "provider",
      "componentRequestRef",
    ])
    // The per-prospect page cap: this prospect's non-failed operations.
    .index("by_workspaceId_and_prospectId_and_state", [
      "workspaceId",
      "prospectId",
      "state",
    ])
    // The stale-operation sweep: still `requested`/`accepted` past its age.
    .index("by_state_and_updatedAt", ["state", "updatedAt"]),
});
