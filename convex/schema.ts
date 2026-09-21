/** Field maps are shared by schema and return validators. Timestamps use UTC epoch milliseconds.
 * Indexes are not unique; mutations enforce uniqueness transactionally. */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vAgentAutopilot,
  vAgentGoal,
  vAgentIcp,
  vAgentMode,
  vAgentRun,
  vGenerationStatus,
  vAgentStatus,
  vAgentTone,
  vAnalysisStatus,
  vApprovalActor,
  vApprovalVerdict,
  vBookingProposal,
  vBookingState,
  vConfirmationSource,
  vConversationNoteKind,
  vConversationState,
  vDraftState,
  vEmailEventDirection,
  vEmailEventHandlingState,
  vEndpointOperation,
  vEvidenceConfidence,
  vInboxConnection,
  vLeadApproval,
  vLeadCompany,
  vLeadEmailStatus,
  vLeadEventActor,
  vLeadEventDetails,
  vLeadEventKind,
  vLeadFilterOption,
  vLeadFilters,
  vLeadLocation,
  vLeadOrigin,
  vLeadResearch,
  vLeadStage,
  vMessageSource,
  vOnboardingStep,
  vOperationError,
  vProviderDataRef,
  vProviderKind,
  vProviderOperationSettlement,
  vProviderOperationState,
  vQuarantineReason,
  vQuarantineState,
  vReplyDisposition,
  vSecretProvider,
  vSecretStatus,
  vSendAttemptState,
  vSignalKind,
  vStrategySource,
  vSuppressionKind,
  vSuppressionReason,
  vTakeoverReason,
  vUsageMetric,
  vUsageReservationState,
  vOrgPlan,
} from "./lib/validators";

export const orgFields = {
  name: v.string(),
  /**
   * The Hexclave organization this row belongs to — the tenant key (PLAN §4).
   * The signed token's active-org claim is matched against it on every
   * request, so it is what decides whose data a caller sees. Exactly one row
   * per Hexclave org, enforced transactionally on `by_hexclaveOrgId`.
   */
  hexclaveOrgId: v.string(),
  /**
   * `tokenIdentifier` (`iss|sub`) of whoever initialised this row. Audit, and
   * the one-trial-per-user rule: only the FIRST org a verified user
   * initialises is granted trial credits (PLAN §6).
   */
  createdByIdentityKey: v.string(),
  /** IANA timezone, validated on write. */
  timezone: v.string(),
  /** One plan, granted at creation with its credit buckets (PLAN §6). */
  plan: vOrgPlan,
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
  /** How the sending inbox is attached (PLAN §9.4). */
  inboxConnection: vInboxConnection,
  /**
   * Opaque path token of this org's inbound webhook route
   * (`/agentmail/webhook/<token>`). Generated at creation, never derived from
   * the org id, and rotated by a reconnect — it is the only thing that
   * resolves an inbound request to an org, so it is a secret.
   */
  webhookToken: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  /** AgentMail inbox reference; unique when present, claimed transactionally. */
  inboxRef: v.optional(v.string()),
  /** The provider mailbox address is distinct from inboxRef and is used to recognize our own messages. */
  inboxAddress: v.optional(v.string()),
  /** The webhook this org registered on the user's own account. */
  agentmailWebhookId: v.optional(v.string()),
  /**
   * When the inbox was connected. The reply gate answers nothing older than
   * this, so it is a permission boundary rather than a display timestamp.
   */
  connectedAt: v.optional(v.number()),
  pauseReason: v.optional(v.string()),
  // Settings → Outreach: the org's default outreach instructions, used
  // by the writer when the agent has none of its own (PLAN §1 "templates as
  // one instructions field"). Absent = none set.
  defaultInstructions: v.optional(v.string()),
};

export const businessProfileFields = {
  orgId: v.id("orgs"),
  /** Absent for the "I don't have a website" path (PLAN §5). */
  websiteUrl: v.optional(v.string()),
  companyName: v.string(),
  industry: v.string(),
  description: v.string(),
  keyFeatures: v.array(v.string()),
  socialProof: v.array(v.string()),
  painPoints: v.string(),
  analysisStatus: vAnalysisStatus,
  /**
   * Whether the free first analysis has been consumed. Only a SUCCESSFUL run
   * sets it, so a blocked site costs the user nothing (PLAN §5).
   */
  firstRunUsed: v.boolean(),
  version: v.number(),
  updatedAt: v.number(),
};

/** One agent per org, enforced transactionally. Revision changes fence off queued work and drafts
 * created under old instructions, tone, goal, ICP or mode. */
export const agentFields = {
  orgId: v.id("orgs"),
  /** Generated from the ICP ("Title · Region · Industry"), editable. */
  name: v.string(),
  status: vAgentStatus,
  mode: vAgentMode,
  onboardingStep: vOnboardingStep,
  icp: vAgentIcp,
  goal: vAgentGoal,
  tone: vAgentTone,
  keywords: v.array(v.string()),
  /** Per-run ceilings; the run loop never exceeds them (PLAN §9.2). */
  dailyLeadCap: v.number(),
  dailyResearchCap: v.number(),
  autoRevealDailyCap: v.number(),
  /** Autopilot approves leads at or above this score (PLAN §9.3). */
  autoApproveMinScore: v.number(),
  /** Days after the previous message a follow-up goes out, in order. */
  followUpDays: v.array(v.number()),
  revision: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  /** Deal size for the dashboard's pipeline figure; absent until set. */
  dealSize: v.optional(v.number()),
  instructions: v.optional(v.string()),
  bookingUrl: v.optional(v.string()),
  /** Single-flight lease; absent when no run holds it (PLAN §9.1). */
  run: v.optional(vAgentRun),
  /** Present only while Autopilot consent stands (PLAN §9.3). */
  autopilot: v.optional(vAgentAutopilot),
  /** When the cron should pick this agent up. Absent means "not scheduled". */
  nextRunAt: v.optional(v.number()),
  lastRunAt: v.optional(v.number()),
  /** Count run-loop research separately from website analysis, using the organization's local day. */
  researchDay: v.optional(
    v.object({ periodKey: v.string(), count: v.number() }),
  ),
  // Onboarding generations (absent = never run). The UI renders loading /
  // retry from these; the generated values land on `icp`, `strategies` rows
  // and `suggestedKeywords`.
  icpGeneration: v.optional(vGenerationStatus),
  strategyGeneration: v.optional(vGenerationStatus),
  suggestedKeywords: v.optional(v.array(v.string())),
};

/** Persist nextPage to avoid buying the same search page twice. */
export const strategyFields = {
  orgId: v.id("orgs"),
  agentId: v.id("agents"),
  title: v.string(),
  signalKind: vSignalKind,
  rationale: v.string(),
  filters: vLeadFilters,
  excludeFilters: vLeadFilters,
  matchCount: v.number(),
  // The provider's own flag for `matchCount` (spikes §3: read it, never infer
  // it from a threshold). Absent = exact.
  matchCountIsApproximate: v.optional(v.boolean()),
  enabled: v.boolean(),
  source: vStrategySource,
  nextPage: v.number(),
  leadsFound: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastRunAt: v.optional(v.number()),
  /** Invalid filters park a signal until it is toggled off and on. Absent means healthy. */
  lastError: v.optional(vOperationError),
};

/**
 * The cached allowed values for lead-search filters (PLAN §3 step 2),
 * refreshed weekly. Values are case-sensitive and a typo silently returns
 * zero rows, so the model only ever picks from this list and every value is
 * re-checked against it before a call.
 */
export const leadFilterOptionsFields = {
  options: v.record(v.string(), vLeadFilterOption),
  fetchedAt: v.number(),
};

/**
 * Per-org provider secrets (PLAN §4 "Bring-your-own keys"). AES-GCM
 * under the deployment's `SECRETS_ENCRYPTION_KEY`; decrypted only inside
 * actions and http actions. Client queries see `{ provider, last4, status }`
 * and never the ciphertext.
 */
export const orgSecretFields = {
  orgId: v.id("orgs"),
  provider: vSecretProvider,
  ciphertext: v.string(),
  iv: v.string(),
  /** Last four characters of the key, for the "connected" UI only. */
  last4: v.string(),
  status: vSecretStatus,
  createdAt: v.number(),
  updatedAt: v.number(),
  checkedAt: v.optional(v.number()),
  /**
   * Rotation keeps the previous secret valid for a short overlap so nothing
   * signed with it is lost in between (PLAN §9.4 "Rotation").
   */
  previousCiphertext: v.optional(v.string()),
  previousIv: v.optional(v.string()),
  previousValidUntil: v.optional(v.number()),
};

/** Reserve org and platform capacity in the same transaction to cap total provider spend. */
export const platformBudgetFields = {
  provider: vProviderKind,
  /** `lifetime`, or a UTC day/month key — whatever the budget is stated in. */
  periodKey: v.string(),
  limit: v.number(),
  used: v.number(),
  updatedAt: v.number(),
};

/**
 * Activity events — the org-wide append-only feed behind the header
 * bell. Rows are deduped per org by `dedupeKey`, which is what makes a
 * replayed mutation record one logical event instead of two.
 */
export const activityEventFields = {
  orgId: v.id("orgs"),
  kind: v.string(),
  summary: v.string(),
  /** identityKey for human actions; `system` otherwise. */
  actor: v.string(),
  createdAt: v.number(),
  /** Unique per org; duplicates are dropped transactionally. */
  dedupeKey: v.string(),
  prospectId: v.optional(v.string()),
  conversationId: v.optional(v.string()),
};

/** stage and nextActionAt drive the run loop. scoreKey and sourceLeadKey mirror research and origin
 * for indexing; update each key atomically with its source value. */
export const prospectFields = {
  orgId: v.id("orgs"),
  agentId: v.id("agents"),
  origin: vLeadOrigin,
  /** Mirrors `origin.sourceLeadId` for the dedupe index. See above. */
  sourceLeadKey: v.optional(v.string()),
  research: vLeadResearch,
  /** Mirrors `research.aiScore` for the sort index. See above. */
  scoreKey: v.optional(v.number()),
  stage: vLeadStage,
  approval: vLeadApproval,
  emailStatus: vLeadEmailStatus,
  /** Free pre-rank computed in plain code at sourcing time (PLAN §9.2). */
  preRank: v.number(),
  /** Follow-ups already sent in this thread, against `agents.followUpDays`. */
  followUpsSent: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  /** Who approved; absent while the lead is `pending` (PLAN §9.3). */
  approvedBy: v.optional(vApprovalActor),
  /** When the state machine should next touch this lead. */
  nextActionAt: v.optional(v.number()),
  /** The last failed step; drives the retry ladder (PLAN §9.1). */
  lastError: v.optional(vOperationError),
  /** Count failures per step so one step cannot exhaust another's retry budget. */
  stepAttempts: v.optional(
    v.object({
      research: v.optional(v.number()),
      outreach: v.optional(v.number()),
    }),
  ),
  /* --- person, as the free search preview describes them ------------- */
  firstName: v.optional(v.string()),
  /** Masked until the reveal is paid for — stored exactly as returned. */
  lastName: v.optional(v.string()),
  jobTitle: v.optional(v.string()),
  jobFunction: v.optional(v.string()),
  jobLevel: v.optional(v.string()),
  headline: v.optional(v.string()),
  linkedinUrl: v.optional(v.string()),
  location: v.optional(vLeadLocation),
  skills: v.optional(v.array(v.string())),
  /** Present only once `emailStatus` is `found`; never manufactured. */
  email: v.optional(v.string()),
  /* --- their company -------------------------------------------------- */
  companyName: v.optional(v.string()),
  /** Normalized host — the research target and the company-level dedupe. */
  canonicalDomain: v.optional(v.string()),
  company: v.optional(vLeadCompany),
  /* --- derived facts --------------------------------------------------- */
  /** Set from a send ACCEPTANCE fact, not from drafting. */
  lastContactedAt: v.optional(v.number()),
  /** Set from a verified inbound reply. */
  lastReplyAt: v.optional(v.number()),
  /** Stated basis for the current stage; required for human corrections. */
  stageReason: v.optional(v.string()),
};

/** Append history in the same transaction as the lead update.
 * Derive actors from auth or the run, never model output or email content. */
export const leadEventFields = {
  orgId: v.id("orgs"),
  prospectId: v.id("prospects"),
  kind: vLeadEventKind,
  actor: vLeadEventActor,
  summary: v.string(),
  createdAt: v.number(),
  /** Idempotency key; unique per org, enforced transactionally. */
  operationKey: v.string(),
  fromStage: v.optional(vLeadStage),
  toStage: v.optional(vLeadStage),
  bookingId: v.optional(v.id("bookings")),
  details: v.optional(vLeadEventDetails),
};

/** At most one live proposal or confirmed booking per lead, enforced transactionally.
 * Only a person confirms a meeting, with time, timezone and evidence; this does not create a calendar event. */
export const bookingFields = {
  orgId: v.id("orgs"),
  prospectId: v.id("prospects"),
  /** identityKey of the responsible member of the organization. */
  ownerIdentityKey: v.string(),
  state: vBookingState,
  version: v.number(),
  proposal: vBookingProposal,
  createdAt: v.number(),
  updatedAt: v.number(),
  conversationId: v.optional(v.id("conversations")),
  /** The exact proposal draft whose acceptance may advance the lead. */
  draftId: v.optional(v.id("drafts")),
  startsAt: v.optional(v.number()),
  endsAt: v.optional(v.number()),
  /** IANA zone of the confirmed meeting, distinct from the proposal's zone. */
  timezone: v.optional(v.string()),
  confirmationSource: v.optional(vConfirmationSource),
  /** identityKey of the authenticated human who asserted the agreed time. */
  confirmedBy: v.optional(v.string()),
  confirmedAt: v.optional(v.number()),
  /** Short basis, e.g. "prospect confirmed by reply". */
  confirmationNote: v.optional(v.string()),
};

/**
 * Evidence — one observation with the source it came from. Excerpts are
 * bounded to 2,000 characters. `retrievedAt` is the source-retrieval
 * timestamp — evidence metadata, never a permission or accounting timestamp.
 * Drafts may link only evidence from the same org AND prospect.
 */
export const evidenceFields = {
  orgId: v.id("orgs"),
  prospectId: v.id("prospects"),
  /** Validated public http/https source. */
  sourceUrl: v.string(),
  retrievedAt: v.number(),
  excerpt: v.string(),
  observation: v.string(),
  confidence: vEvidenceConfidence,
  createdAt: v.number(),
};

/* Correspondence — conversations, immutable drafts, approvals, send    */
/* attempts, suppressions and provider-event receipts.                  */
/* `prospects`/`leadEvents`/`bookings`/`evidence` in the block above.   */

/**
 * Conversations — one mail thread. Drafts, approvals and send attempts all
 * bind `contextVersion`/`currentDraftId` here.
 */
export const conversationFields = {
  orgId: v.id("orgs"),
  /** AgentMail inbox reference this conversation lives on. */
  inboxRef: v.string(),
  state: vConversationState,
  /**
   * How this thread first reached us (PLAN §7). The per-message fact lives on
   * `emailEventReceipts.source`; this is the thread-level summary the Inbox
   * reads, merged through `mergeMessageSource` so `live` always wins.
   */
  source: vMessageSource,
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
  /** Association target for `conversations.associateProspect`.
   *  Internally produced — the association is made by an authorized operator
   *  against a lead already in this org, never from a provider payload. */
  prospectId: v.optional(v.id("prospects")),
  /**
   * The agent this thread's reply work runs under, FROZEN at association, so
   * a lead later re-pointed at another agent cannot silently retarget
   * in-flight reply work. Written only by `conversations.associateProspect`,
   * which refuses an agent the prospect does not belong to.
   */
  agentId: v.optional(v.id("agents")),
  /** Why automation is frozen. Present whenever `humanTakeover` is true. */
  takeoverReason: v.optional(vTakeoverReason),
  /** identityKey of the operator who froze it, or `"system"`. */
  takeoverBy: v.optional(v.string()),
  /** When the current hold started — "held since", and stale-hold ordering. */
  takeoverAt: v.optional(v.number()),
  /**
   * Product-level meaning of the most recent inbound reply, so the inbox row
   * can show its classification tag without a second read per listed
   * conversation.
   */
  lastDisposition: v.optional(vReplyDisposition),
  lastDispositionAt: v.optional(v.number()),
  /** Untrusted sender data may block resume on mismatch; it never chooses a tenant, thread or recipient. */
  lastInboundFrom: v.optional(v.string()),
  /** Per-inbox provider thread id (AgentMail thread ids are per-inbox). */
  providerThreadRef: v.optional(v.string()),
  currentDraftId: v.optional(v.id("drafts")),
  lastInboundMessageRef: v.optional(v.string()),
  lastInboundAt: v.optional(v.number()),
  lastMessageAt: v.optional(v.number()),
};

/** Append-only annotations and lifecycle records. Notes neither resolve approvals nor bump contextVersion. */
export const conversationNoteFields = {
  orgId: v.id("orgs"),
  conversationId: v.id("conversations"),
  kind: vConversationNoteKind,
  /** identityKey of the author, or `"system"`. */
  actor: v.string(),
  body: v.string(),
  createdAt: v.number(),
};

/** Draft payloads are immutable. Editing inserts a revision and moves currentDraftId;
 * payloadHash binds all send fields, including the recipient and reply target. */
export const draftFields = {
  orgId: v.id("orgs"),
  conversationId: v.id("conversations"),
  /** Sender inbox the payload will go out through (provider inbox id). */
  inboxRef: v.string(),
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
  /**
   * `agents.revision` the content was written under (PLAN §7/§9.1). A draft
   * whose agent has since changed instructions, tone, goal, ICP or mode is
   * superseded and rewritten rather than sent.
   */
  agentRevision: v.number(),
  policyVersion: v.number(),
  /** See `vDraftState`: `superseded` exactly when `supersededAt` is set. */
  state: vDraftState,
  /**
   * §4.3 evidence links. Bounded label strings until a backend step resolves
   * them to `evidence` rows.
   */
  evidenceIds: v.array(v.string()),
  /** identityKey for human edits; `system` for pipeline-proposed drafts. */
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
   *  (orgId, requestId) transactionally. */
  requestId: v.optional(v.string()),
};

/** Email approval binds the exact draft, recipient and context version.
 * Autopilot records the same approval; lead approval is separate. */
export const approvalFields = {
  orgId: v.id("orgs"),
  actor: vApprovalActor,
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
  /** Client retry key — (orgId, requestId) dedupe makes a replayed
   *  resolve return the recorded row. */
  requestId: v.string(),
};

/** Commit reserved intent before network I/O. requesting cannot be retracted locally.
 * Delivery facts come only from verified webhooks. */
export const sendAttemptFields = {
  orgId: v.id("orgs"),
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
  requestStartedAt: v.optional(v.number()),
  /** When a `reserved` (parked) attempt may dispatch — recorded so the row
   *  self-describes its wake condition and the stale-attempt sweep can
   *  re-drive one whose scheduled wake was lost. */
  nextPermittedAt: v.optional(v.number()),

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
  orgId: v.id("orgs"),
  kind: vSuppressionKind,
  normalizedValue: v.string(),
  reason: vSuppressionReason,
  createdAt: v.number(),
  sourceConversationId: v.optional(v.id("conversations")),
};

/** providerEventId dedupes delivery; applicationKey dedupes business effects.
 * Delivery events wait pending until a send records its message ref. Bodies remain in component storage. */
export const emailEventReceiptFields = {
  orgId: v.id("orgs"),
  inboxRef: v.string(),
  providerEventId: v.string(),
  applicationKey: v.string(),
  providerMessageRef: v.string(),
  eventType: v.string(),
  receivedAt: v.number(),
  /**
   * Whether this message came from the live webhook or the 30-day connect
   * backfill (PLAN §9.4). This is the per-message fact the reply gate reads;
   * `mergeMessageSource` decides the winner when both paths race, and a later
   * backfill never downgrades a `live` row.
   */
  source: vMessageSource,
  /** Derive direction from applicationKey so stranded outbound receipts cannot fill the inbound drain window. */
  direction: vEmailEventDirection,
  handlingState: vEmailEventHandlingState,
  /** Bounded projection of the verified event (≤4 KiB enforced on write). */
  providerFacts: v.record(v.string(), v.any()),
  providerThreadRef: v.optional(v.string()),
  handledAt: v.optional(v.number()),
  error: v.optional(v.string()),
};

/** Keep verified events for unclaimed inboxes so assignment can replay them later.
 * The component has already deduped delivery, so provider retries cannot recover them. Store identifiers only. */
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
  releasedTo: v.optional(v.id("orgs")),
  /** A bounded reason written by the application; never provider text. */
  note: v.optional(v.string()),
};

/** Reserve atomically under reserved + committed + uncertain <= limit.
 * Daily caps use the org-local day. A missing bucket refuses paid work. */
export const usageBucketFields = {
  orgId: v.id("orgs"),
  /** `org` for org-wide metrics; `agent:<id>` when an agent
   *  carries its own allowance. */
  scopeKey: v.string(),
  metric: vUsageMetric,
  periodKey: v.string(),
  limit: v.number(),
  reserved: v.number(),
  committed: v.number(),
  uncertain: v.number(),
  updatedAt: v.number(),
};

/** Claim the trial by tokenIdentifier in the granting transaction, preventing concurrent orgs
 * from funding the same identity twice. MAX_TRIAL_ORGS counts claims, not organizations. Email is not identity. */
export const trialGrantFields = {
  /** `tokenIdentifier` (`iss|sub`) of the identity this grant belongs to. */
  identityKey: v.string(),
  /** The org the one grant funded. */
  orgId: v.id("orgs"),
};

/** One debit lifecycle per logical operation/bucket (§4.4). */
export const usageReservationFields = {
  orgId: v.id("orgs"),
  bucketId: v.id("usageBuckets"),
  operationKey: v.string(),
  quantity: v.number(),
  state: vUsageReservationState,
  createdAt: v.number(),
  updatedAt: v.number(),
  providerReference: v.optional(v.string()),
};

/** Record provider operations and their reservations in one transaction before contacting the provider.
 * Retries reuse the record; ambiguous outcomes keep capacity reserved until reconciled. */
export const providerOperationFields = {
  orgId: v.id("orgs"),
  provider: vProviderKind,
  /** Stable semantic invocation id. A repeat returns the recorded result or
   *  status instead of forwarding a second paid request. */
  operationKey: v.string(),
  /** sha256 of the canonical {provider, tool, arguments}. A reused
   *  operationKey carrying different arguments is a CONFLICT, never a
   *  replay. */
  requestDigest: v.string(),
  /** The usage reservations this operation took, settled together. */
  reservationIds: v.array(v.id("usageReservations")),
  state: vProviderOperationState,
  /** How the reservation this row owns was settled. Absent while the
   *  operation is still in flight. `state` does not imply it: a post-fetch
   *  redirect refusal is `failed` and `commit`-settled, because the fetch
   *  happened and was billed even though its page is refused. */
  settlement: v.optional(vProviderOperationSettlement),
  createdAt: v.number(),
  updatedAt: v.number(),
  prospectId: v.optional(v.id("prospects")),
  /** The provider's own reference for the request — the backend receipt. */
  componentRequestRef: v.optional(v.string()),
  resultRef: v.optional(vProviderDataRef),
  resultDigest: v.optional(v.string()),
  error: v.optional(v.object({ code: v.string(), message: v.string() })),
};

export default defineSchema({
  orgs: defineTable(orgFields)
    // The tenant lookup: one row per Hexclave org, made a constraint by
    // `ensureOrg` reading this range in the same transaction as the insert.
    .index("by_hexclaveOrgId", ["hexclaveOrgId"])
    // One org per inbox: a lookup, made a constraint by the claim
    // mutation reading it in the same transaction as the write (PLAN §9.4).
    .index("by_inboxRef", ["inboxRef"])
    // The inbound route's only way from an opaque path token to an org.
    .index("by_webhookToken", ["webhookToken"]),

  businessProfiles: defineTable(businessProfileFields)
    // One current profile per org, enforced transactionally.
    .index("by_orgId", ["orgId"]),

  /* The agent and what it searches with */

  agents: defineTable(agentFields)
    // One agent per org — a lookup the create mutation reads before it
    // inserts (PLAN §7); Convex has no unique index.
    .index("by_orgId", ["orgId"])
    // The run cron's exact range: live agents whose next run is due. `status`
    // leads so draft agents, which have no due time at all, are never paged
    // through (EXECUTION "API hand-offs": T23 writes it, T30 reads it).
    .index("by_status_and_nextRunAt", ["status", "nextRunAt"]),

  strategies: defineTable(strategyFields)
    // The agent's strategies, and the enabled subset the run iterates.
    .index("by_agentId_and_enabled", ["agentId", "enabled"])
    .index("by_orgId", ["orgId"]),

  // A singleton cache; the reader takes the newest row and the weekly refresh
  // replaces it.
  leadFilterOptions: defineTable(leadFilterOptionsFields).index(
    "by_fetchedAt",
    ["fetchedAt"],
  ),

  orgSecrets: defineTable(orgSecretFields)
    // Unique (orgId, provider), enforced transactionally.
    .index("by_orgId_and_provider", ["orgId", "provider"]),

  platformBudgets: defineTable(platformBudgetFields)
    // Unique (provider, periodKey), enforced inside the debiting transaction.
    .index("by_provider_and_periodKey", ["provider", "periodKey"]),

  /* Org activity feed */

  activityEvents: defineTable(activityEventFields)
    .index("by_orgId_and_createdAt", ["orgId", "createdAt"])
    .index("by_orgId_and_dedupeKey", ["orgId", "dedupeKey"]),

  /* Leads, bookings and evidence */

  prospects: defineTable(prospectFields)
    // Dashboard: leads created in a date window, as one exact range.
    .index("by_orgId_and_createdAt", ["orgId", "createdAt"])
    // Contacts, filtered by stage, most recently changed first.
    .index("by_orgId_and_stage_and_updatedAt", [
      "orgId",
      "stage",
      "updatedAt",
    ])
    // The state machine's due range: whatever the cron must touch next
    // (PLAN §7). Rows with no due time sort below every bound, so an
    // unscheduled lead can never look overdue.
    .index("by_orgId_and_nextActionAt", ["orgId", "nextActionAt"])
    // Best leads first, for the Contacts sort and the research/reveal order.
    // Indexes the denormalised `scoreKey`, never `research.aiScore` — Convex
    // cannot index into a union member, which is what `scoreKey` exists for.
    .index("by_orgId_and_scoreKey", ["orgId", "scoreKey"])
    // The sourcing dedupe: has this agent already stored this provider row?
    // Same denormalisation as above, for `origin.sourceLeadId`. The upsert
    // reads this range in the transaction it inserts into, which is what
    // makes the lookup behave as the uniqueness constraint.
    .index("by_agentId_and_sourceLeadKey", ["agentId", "sourceLeadKey"])
    // The per-agent funnel counts the Agent page reports.
    .index("by_agentId_and_stage", ["agentId", "stage"])
    // The approval queue: what is waiting for a yes/no in this org.
    .index("by_orgId_and_approval", ["orgId", "approval"])
    // Contacts: leads whose email can still be revealed, best score first.
    .index("by_orgId_and_emailStatus_and_scoreKey", [
      "orgId",
      "emailStatus",
      "scoreKey",
    ])
    // Contact search. Equality filters are applied INSIDE `withSearchIndex`;
    // search mode never combines with due ranges or date sorting, and empty
    // text falls back to the ordinary list.
    .searchIndex("search_company_name", {
      searchField: "companyName",
      filterFields: ["orgId", "stage", "agentId", "approval"],
    }),

  leadEvents: defineTable(leadEventFields)
    .index("by_prospectId_and_createdAt", ["prospectId", "createdAt"])
    // Unique (orgId, operationKey) — the idempotency lookup a replayed
    // mutation reads before writing; uniqueness is enforced in that same
    // transaction.
    .index("by_orgId_and_operationKey", ["orgId", "operationKey"]),

  bookings: defineTable(bookingFields)
    .index("by_prospectId_and_createdAt", ["prospectId", "createdAt"])
    // The at-most-one-active check: `proposed` and `confirmed` rows for one
    // lead, read inside the proposing/confirming transaction.
    .index("by_prospectId_and_state", ["prospectId", "state"])
    .index("by_orgId_and_state_and_startsAt", [
      "orgId",
      "state",
      "startsAt",
    ])
    .index("by_orgId_and_ownerIdentityKey_and_startsAt", [
      "orgId",
      "ownerIdentityKey",
      "startsAt",
    ]),

  evidence: defineTable(evidenceFields).index("by_prospectId_and_createdAt", [
    "prospectId",
    "createdAt",
  ]),

  /* Correspondence */

  conversations: defineTable(conversationFields)
    // Dashboard: threads whose latest reply falls in a date window.
    .index("by_orgId_and_lastInboundAt", ["orgId", "lastInboundAt"])
    .index("by_orgId_and_state_and_lastMessageAt", [
      "orgId",
      "state",
      "lastMessageAt",
    ])
    // Unique (inboxRef, providerThreadRef) mapping when the thread ref is
    // assigned — enforced transactionally.
    .index("by_inboxRef_and_providerThreadRef", [
      "inboxRef",
      "providerThreadRef",
    ])
    // Two DISJOINT exact ranges for the bounded attention count: unassigned
    // threads, and open threads under takeover. Summing the plain takeover
    // index would double-count, because every unassigned thread is also under
    // takeover; scoping the second bucket to `state: "open"` removes the
    // overlap without post-filtering a truncated page.
    .index("by_orgId_and_state_and_humanTakeover", [
      "orgId",
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
    // The invalidation sweep: every draft still current in a conversation.
    .index("by_conversationId_and_state", ["conversationId", "state"])
    // requestId dedupe for revise/createRevision retries.
    .index("by_orgId_and_requestId", ["orgId", "requestId"]),

  approvals: defineTable(approvalFields)
    .index("by_draftId", ["draftId"])
    // One resolution per (orgId, requestId), enforced transactionally.
    .index("by_orgId_and_requestId", ["orgId", "requestId"]),

  sendAttempts: defineTable(sendAttemptFields)
    .index("by_draftId", ["draftId"])
    // The across-revisions guard: queries reserved|requesting|uncertain per
    // conversation inside the reservation mutation.
    .index("by_conversationId_and_state", ["conversationId", "state"])
    // Chronological audit listing — the unfiltered conversation view is
    // newest-first, not state-bucketed.
    .index("by_conversationId_and_createdAt", ["conversationId", "createdAt"])
    .index("by_orgId_and_state_and_updatedAt", [
      "orgId",
      "state",
      "updatedAt",
    ])
    // Org-agnostic sweeps: stale `requesting` rows and parked
    // `reserved` rows whose recorded wake time has passed.
    .index("by_state_and_updatedAt", ["state", "updatedAt"])
    .index("by_state_and_nextPermittedAt", ["state", "nextPermittedAt"])
    // Stable logical-send key; uniqueness enforced transactionally.
    .index("by_orgId_and_operationKey", ["orgId", "operationKey"])
    .index("by_providerMessageRef", ["providerMessageRef"]),

  suppressions: defineTable(suppressionFields)
    // Unique (orgId, kind, normalizedValue), enforced transactionally.
    .index("by_orgId_and_kind_and_normalizedValue", [
      "orgId",
      "kind",
      "normalizedValue",
    ]),

  emailEventReceipts: defineTable(emailEventReceiptFields)
    // Unique provider event delivery, enforced transactionally.
    .index("by_providerEventId", ["providerEventId"])
    // Unique application handling key, enforced transactionally.
    .index("by_orgId_and_applicationKey", [
      "orgId",
      "applicationKey",
    ])
    // PLAN §9.4's message identity: (orgId, inboxId, providerMessageId).
    // Provider message ids are unique only within an account, so the triple —
    // not the id alone — is what the single-writer upsert looks up before it
    // inserts or merges. `by_providerMessageRef` below stays for the
    // outbound delivery-fact correlation, which has no inbox in hand.
    .index("by_org_inbox_providerMessageId", [
      "orgId",
      "inboxRef",
      "providerMessageRef",
    ])
    // Delivery-fact lookup when the send attempt records its message ref.
    .index("by_providerMessageRef", ["providerMessageRef"])
    // The drain's exact range: one half of the mail path, still pending,
    // older than the cutoff, oldest first. `direction` leads so the sweep
    // never pages through the other half's permanently-pending rows.
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
    .index("by_releasedTo", ["releasedTo"]),

  /* Usage ledger */

  usageBuckets: defineTable(usageBucketFields)
    // Unique bucket per (orgId, scopeKey, metric, periodKey), enforced
    // transactionally in usage.reserve.
    .index("by_orgId_and_scopeKey_and_metric_and_periodKey", [
      "orgId",
      "scopeKey",
      "metric",
      "periodKey",
    ]),

  trialGrants: defineTable(trialGrantFields)
    // One claim per identity, read AND written inside the granting
    // transaction so a second concurrent grant conflicts and retries. Also
    // the table `MAX_TRIAL_ORGS` counts, because the cap bounds funded
    // trials rather than rows in `orgs`.
    .index("by_identityKey", ["identityKey"]),

  usageReservations: defineTable(usageReservationFields)
    // One debit lifecycle per logical operation/bucket, enforced
    // transactionally.
    .index("by_orgId_and_operationKey_and_bucketId", [
      "orgId",
      "operationKey",
      "bucketId",
    ])
    // Usage tab: one credits bucket, newest first. `createdAt` is the
    // keyset the page walks, so the query never collects the whole ledger.
    .index("by_bucketId_and_createdAt", ["bucketId", "createdAt"]),

  providerOperations: defineTable(providerOperationFields)
    // The dedupe lookup: one operation per (org, provider, key),
    // enforced transactionally inside the reserving mutation.
    .index("by_orgId_and_provider_and_operationKey", [
      "orgId",
      "provider",
      "operationKey",
    ])
    // "Has this org ever been BILLED for this action?" — the first-run-free
    // question, answered EXACTLY by one range read rather than a bounded
    // scan: `settlement` pins the commits and `operationKey` carries the
    // `<action>:` prefix the wrapper composes, so a single `.first()`
    // decides it however many operations the org has accumulated.
    .index("by_orgId_and_settlement_and_operationKey", [
      "orgId",
      "settlement",
      "operationKey",
    ])
    // The stale-operation sweep: `requested`/`accepted` rows oldest first,
    // which is what decides whether one may be parked at all.
    .index("by_state_and_updatedAt", ["state", "updatedAt"])
    // The recovery sweep's reconcile pass. `settlement: "markUncertain"` plus
    // an `<action>:` prefix on the key is EXACTLY the set of holds one pass
    // can settle, so no other action's old holds share the window and crowd
    // it out; age is then read from the rows themselves, which is safe
    // because the range holds nothing else (`agents/recovery.ts`).
    .index("by_settlement_and_operationKey", ["settlement", "operationKey"]),
});
