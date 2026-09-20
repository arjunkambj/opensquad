/**
 * OpenIntent schema — PLAN §7. Workspace and configuration tables, the agent
 * and its search strategies, the person-level lead store, the correspondence
 * tables and the usage/provider-accounting tables.
 * Component-owned mail/crawl tables never enter this schema. Every table is
 * declared exactly once: a module that writes rows imports the `*Fields` map,
 * it does not re-declare the table.
 *
 * Notation: `ms` timestamps are integer UTC epoch milliseconds. Indexes use
 * application timestamp fields; uniqueness invariants are enforced inside the
 * mutating transaction, not by the index itself (Convex has no unique index).
 *
 * The exported `*Fields` maps are the single source of truth for both
 * `defineTable` and per-module `returns` doc validators.
 */
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
  vLeadLegacy,
  vLeadLocation,
  vLeadOrigin,
  vLeadResearch,
  vLeadStage,
  vMembershipStatus,
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
  vRole,
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
  vWorkspacePlan,
} from "./lib/validators";

export const workspaceFields = {
  name: v.string(),
  /** `tokenIdentifier` (`iss|sub`) of the provisioning owner. */
  ownerIdentityKey: v.string(),
  /** IANA timezone, validated on write. */
  timezone: v.string(),
  /** One plan, granted at creation with its credit buckets (PLAN §6). */
  plan: vWorkspacePlan,
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
   * Opaque path token of this workspace's inbound webhook route
   * (`/agentmail/webhook/<token>`). Generated at creation, never derived from
   * the workspace id, and rotated by a reconnect — it is the only thing that
   * resolves an inbound request to a workspace, so it is a secret.
   */
  webhookToken: v.string(),
  /**
   * Whether a verified open event has ever been observed for this workspace
   * (PLAN §9.6). Until it flips the Agent card shows no "Opened" column at
   * all — no zero, no dash.
   */
  opensObserved: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
  /** AgentMail inbox reference; unique when present, claimed transactionally. */
  inboxRef: v.optional(v.string()),
  /** The webhook this workspace registered on the user's own account. */
  agentmailWebhookId: v.optional(v.string()),
  /**
   * When the inbox was connected. The reply gate answers nothing older than
   * this, so it is a permission boundary rather than a display timestamp.
   */
  connectedAt: v.optional(v.number()),
  pauseReason: v.optional(v.string()),
  // Settings → Outreach: the workspace's default outreach instructions, used
  // by the writer when the agent has none of its own (PLAN §1 "templates as
  // one instructions field"). Absent = none set.
  defaultInstructions: v.optional(v.string()),
};

export const membershipFields = {
  workspaceId: v.id("workspaces"),
  identityKey: v.string(),
  role: vRole,
  status: vMembershipStatus,
  createdAt: v.number(),
  updatedAt: v.number(),
};

/**
 * The company we are selling FOR — filled by website analysis at onboarding
 * dot 1 and fully editable afterwards (PLAN §7, §11 M1).
 *
 * `analysisStatus` is a variant, not a boolean pair: "never analyzed",
 * "analyzing now", "ready" and "failed with a mapped code" are four different
 * screens, and the failure code is OURS — provider wording never reaches it.
 */
export const businessProfileFields = {
  workspaceId: v.id("workspaces"),
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
  /** identityKey of the last editor. */
  updatedBy: v.string(),
};

/**
 * The agent — one per workspace (PLAN §7), replacing pre-pivot `campaigns`.
 *
 * One agent per workspace is enforced in the create mutation (read the
 * workspace's agents, refuse if one exists), not by an index: Convex has no
 * unique index, and mutations are serializable, so the read-then-write in one
 * transaction is the constraint.
 *
 * `revision` is the fence every queued step and draft records itself against
 * (PLAN §9.1 "Revision fencing"): it increments whenever instructions, tone,
 * goal, ICP or mode change, and work written under an older revision is
 * superseded rather than sent.
 */
export const agentFields = {
  workspaceId: v.id("workspaces"),
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
  /** Traceability for an agent folded out of a pre-pivot campaign. */
  legacyCampaignId: v.optional(v.id("legacyCampaigns")),
  // Onboarding generations (absent = never run). The UI renders loading /
  // retry from these; the generated values land on `icp`, `strategies` rows
  // and `suggestedKeywords`.
  icpGeneration: v.optional(vGenerationStatus),
  strategyGeneration: v.optional(vGenerationStatus),
  suggestedKeywords: v.optional(v.array(v.string())),
};

/**
 * Read-only copies of pre-pivot campaigns folded into an agent
 * (MIGRATION §1). Nothing writes these outside the migration and nothing
 * schedules work from them; they exist so a campaign's brief and identity are
 * not silently discarded. Empty on the clean-slate path.
 */
export const legacyCampaignFields = {
  workspaceId: v.id("workspaces"),
  title: v.string(),
  brief: v.string(),
  /** The pre-pivot status as it stood at migration time. */
  status: v.string(),
  createdBy: v.string(),
  createdAt: v.number(),
  /** The agent this campaign was folded into. */
  agentId: v.id("agents"),
  foldedAt: v.number(),
};

/**
 * A named, explainable lead search (PLAN §3). Each is the core ICP filters
 * AND one signal; the cards show `matchCount` from a free count call and the
 * model's one-line `rationale`.
 *
 * `nextPage` is the paging cursor the run advances so a second run does not
 * re-buy page 1, and `leadsFound` is what the Agent page's per-signal table
 * reports — both are facts of this strategy, which is why they live here and
 * not on the agent.
 */
export const strategyFields = {
  workspaceId: v.id("workspaces"),
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
 * Per-workspace provider secrets (PLAN §4 "Bring-your-own keys"). AES-GCM
 * under the deployment's `SECRETS_ENCRYPTION_KEY`; decrypted only inside
 * actions and http actions. Client queries see `{ provider, last4, status }`
 * and never the ciphertext.
 */
export const workspaceSecretFields = {
  workspaceId: v.id("workspaces"),
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

/**
 * Platform-wide circuit breakers (PLAN §6). The credit wrapper debits the
 * workspace bucket AND the platform bucket in the same transaction, so the
 * worst case per day is a number we chose rather than a function of how many
 * people sign up. `provider` is server-side vocabulary and never reaches a
 * client payload.
 */
export const platformBudgetFields = {
  provider: vProviderKind,
  /** `lifetime`, or a UTC day/month key — whatever the budget is stated in. */
  periodKey: v.string(),
  limit: v.number(),
  used: v.number(),
  updatedAt: v.number(),
};

/* ------------------------------------------------------------------ */
/* Workspace activity feed                                             */
/* ------------------------------------------------------------------ */

/**
 * Activity events — the workspace-wide append-only feed behind the header
 * bell. Rows are deduped per workspace by `dedupeKey`, which is what makes a
 * replayed mutation record one logical event instead of two.
 */
export const activityEventFields = {
  workspaceId: v.id("workspaces"),
  kind: v.string(),
  summary: v.string(),
  /** identityKey for human actions; `system` otherwise. */
  actor: v.string(),
  createdAt: v.number(),
  /** Unique per workspace; duplicates are dropped transactionally. */
  dedupeKey: v.string(),
  prospectId: v.optional(v.string()),
  conversationId: v.optional(v.string()),
};

/* ------------------------------------------------------------------ */
/* Leads, bookings and evidence                                        */
/*                                                                     */
/* THE single declaration site for `prospects`, `leadEvents`,          */
/* `bookings` and `evidence`.                                          */
/* ------------------------------------------------------------------ */

/**
 * Prospects — the person-level lead (`prospects` is the backend name; the UI
 * says Contacts). PLAN §7.
 *
 * Two unions carry what used to be optional columns, so an incomplete lead is
 * a valid document rather than a row full of holes:
 *   `origin`   — a provider id exists only on a sourced lead.
 *   `research` — a score exists only on a researched one. Nothing reads a
 *                bare `aiScore`; readers switch on `research.status`.
 *
 * `stage` + `nextActionAt` is the whole state machine (PLAN §7): the cron
 * picks up whatever is due, and no other field encodes progress.
 *
 * `scoreKey` and `sourceLeadKey` are DENORMALISED INDEX KEYS. Convex indexes
 * top-level fields and cannot reach into a union member, so these two mirror
 * `research.aiScore` and `origin.sourceLeadId`. The invariant — enforced by
 * writing them through `leadScoreKey`/`leadSourceKey` in the same patch as
 * the union they mirror — is that they are never written alone and never read
 * as the value itself.
 */
export const prospectFields = {
  workspaceId: v.id("workspaces"),
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
  /** Migration-only copy of pre-pivot fields (MIGRATION §5). */
  legacy: v.optional(vLeadLegacy),
};

/**
 * Lead events — the append-only lead history. Rows are never edited or
 * deleted: a stage correction appends a row preserving `fromStage`, it does
 * not rewrite one. Every business update and its event are written in ONE
 * transaction, so the history can never disagree with the lead.
 *
 * `actor` is a discriminated union so "comes from auth or from the agent run"
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
  fromStage: v.optional(vLeadStage),
  toStage: v.optional(vLeadStage),
  bookingId: v.optional(v.id("bookings")),
  details: v.optional(vLeadEventDetails),
};

/**
 * Bookings — meeting records. At most one `proposed` or `confirmed` booking
 * per lead, checked transactionally through `by_prospectId_and_state`. A
 * proposal implies NO confirmation: a sent link, an offered slot or a model's
 * reading of a reply all leave the row `proposed`.
 *
 * `meeting_booked` is set ONLY by the user (PLAN §9.5), which is why
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
 * Evidence — one observation with the source it came from. Excerpts are
 * bounded to 2,000 characters. `retrievedAt` is the source-retrieval
 * timestamp — evidence metadata, never a permission or accounting timestamp.
 * Drafts may link only evidence from the same workspace AND prospect.
 */
export const evidenceFields = {
  workspaceId: v.id("workspaces"),
  prospectId: v.id("prospects"),
  /** Validated public http/https source. */
  sourceUrl: v.string(),
  retrievedAt: v.number(),
  excerpt: v.string(),
  observation: v.string(),
  confidence: vEvidenceConfidence,
  createdAt: v.number(),
};

/* ------------------------------------------------------------------ */
/* Correspondence — conversations, immutable drafts, approvals, send    */
/* attempts, suppressions and provider-event receipts.                  */
/* `prospects`/`leadEvents`/`bookings`/`evidence` in the block above.   */
/* ------------------------------------------------------------------ */

/**
 * Conversations — one mail thread. Drafts, approvals and send attempts all
 * bind `contextVersion`/`currentDraftId` here.
 */
export const conversationFields = {
  workspaceId: v.id("workspaces"),
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
   *  against a lead already in this workspace, never from a provider payload. */
  prospectId: v.optional(v.id("prospects")),
  /**
   * The agent this thread's reply work runs under, FROZEN at association, so
   * a lead later re-pointed at another agent cannot silently retarget
   * in-flight reply work. Written only by `conversations.associateProspect`,
   * which refuses an agent the prospect does not belong to.
   */
  agentId: v.optional(v.id("agents")),
  /**
   * Human owner of this thread (identityKey). Must resolve to an ACTIVE
   * membership before it is stored.
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
   * can show its classification tag without a second read per listed
   * conversation.
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
 * Internal notes on a conversation (P11) — the per-thread audit trail.
 *
 * `kind: "system"` rows are lifecycle records (intake, takeover, association,
 * closure); `kind: "note"` rows are human annotations. Rows are append-only,
 * and a note can NEVER resolve a business approval: this table has no path to
 * approval state.
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
 * place — `drafts.revise`/`draftRevisions.createRevision` insert a new row and move
 * `conversations.currentDraftId`.
 */
export const draftFields = {
  workspaceId: v.id("workspaces"),
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
   *  (workspaceId, requestId) transactionally. */
  requestId: v.optional(v.string()),
};

/**
 * Approvals — one immutable verdict per draft approval, bound to the exact
 * payloadHash + normalizedRecipient + contextVersion. A later edit supersedes
 * applicability, not the record.
 *
 * This is EMAIL approval — "yes, send this text" — never lead approval, which
 * lives on `prospects.approval` (PLAN §9.3). Autopilot does not bypass it: it
 * writes a row here with `actor: "autopilot"` bound to the draft id and
 * revision, and the send goes through the same ledger.
 */
export const approvalFields = {
  workspaceId: v.id("workspaces"),
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
  requestStartedAt: v.optional(v.number()),
  /** When a `reserved` (parked) attempt may dispatch — recorded so the row
   *  self-describes its wake condition and the stale-attempt sweep can
   *  re-drive one whose scheduled wake was lost. */
  nextPermittedAt: v.optional(v.number()),
  /** The replacement attempt that covers THIS uncertain attempt (§8.7).
   *  Coverage is transitive down the chain. */
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
 * `pending` and are folded in by the send-outcome path afterwards. P11 consumes the
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
   * Whether this message came from the live webhook or the 30-day connect
   * backfill (PLAN §9.4). This is the per-message fact the reply gate reads;
   * `mergeMessageSource` decides the winner when both paths race, and a later
   * backfill never downgrades a `live` row.
   */
  source: vMessageSource,
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
/* Usage ledger (PLAN §6) — buckets, reservations, provider operations. */
/* ------------------------------------------------------------------ */

/**
 * Usage buckets — atomic capacity counters. `reserved + committed +
 * uncertain <= limit` is enforced inside the reserving transaction, which is
 * why concurrent calls cannot overspend.
 *
 * `periodKey` is `lifetime` for the granted trial allowances and the
 * workspace-local day for the daily caps (PLAN §6 "Ledger"). No bucket means
 * every paid call refuses — the grant is part of creating the workspace,
 * never implied.
 */
export const usageBucketFields = {
  workspaceId: v.id("workspaces"),
  /** `workspace` for workspace-wide metrics; `agent:<id>` when an agent
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
 * The row is written in the SAME transaction as the `billing.reserve` it owns,
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
  workspaces: defineTable(workspaceFields)
    .index("by_ownerIdentityKey", ["ownerIdentityKey"])
    // One workspace per inbox: a lookup, made a constraint by the claim
    // mutation reading it in the same transaction as the write (PLAN §9.4).
    .index("by_inboxRef", ["inboxRef"])
    // The inbound route's only way from an opaque path token to a workspace.
    .index("by_webhookToken", ["webhookToken"]),

  memberships: defineTable(membershipFields)
    // Unique (workspaceId, identityKey) pair, enforced transactionally.
    .index("by_workspaceId_and_identityKey", ["workspaceId", "identityKey"])
    .index("by_identityKey_and_status", ["identityKey", "status"]),

  businessProfiles: defineTable(businessProfileFields)
    // One current profile per workspace, enforced transactionally.
    .index("by_workspaceId", ["workspaceId"]),

  /* The agent and what it searches with */

  agents: defineTable(agentFields)
    // One agent per workspace — a lookup the create mutation reads before it
    // inserts (PLAN §7); Convex has no unique index.
    .index("by_workspaceId", ["workspaceId"])
    // The run cron's exact range: live agents whose next run is due. `status`
    // leads so draft agents, which have no due time at all, are never paged
    // through (EXECUTION "API hand-offs": T23 writes it, T30 reads it).
    .index("by_status_and_nextRunAt", ["status", "nextRunAt"]),

  legacyCampaigns: defineTable(legacyCampaignFields)
    .index("by_workspaceId", ["workspaceId"])
    .index("by_agentId", ["agentId"]),

  strategies: defineTable(strategyFields)
    // The agent's strategies, and the enabled subset the run iterates.
    .index("by_agentId_and_enabled", ["agentId", "enabled"])
    .index("by_workspaceId", ["workspaceId"]),

  // A singleton cache; the reader takes the newest row and the weekly refresh
  // replaces it.
  leadFilterOptions: defineTable(leadFilterOptionsFields).index(
    "by_fetchedAt",
    ["fetchedAt"],
  ),

  workspaceSecrets: defineTable(workspaceSecretFields)
    // Unique (workspaceId, provider), enforced transactionally.
    .index("by_workspaceId_and_provider", ["workspaceId", "provider"]),

  platformBudgets: defineTable(platformBudgetFields)
    // Unique (provider, periodKey), enforced inside the debiting transaction.
    .index("by_provider_and_periodKey", ["provider", "periodKey"]),

  /* Workspace activity feed */

  activityEvents: defineTable(activityEventFields)
    .index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"])
    .index("by_workspaceId_and_dedupeKey", ["workspaceId", "dedupeKey"]),

  /* Leads, bookings and evidence */

  prospects: defineTable(prospectFields)
    // Dashboard: leads created in a date window, as one exact range.
    .index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"])
    // Contacts, filtered by stage, most recently changed first.
    .index("by_workspaceId_and_stage_and_updatedAt", [
      "workspaceId",
      "stage",
      "updatedAt",
    ])
    // The state machine's due range: whatever the cron must touch next
    // (PLAN §7). Rows with no due time sort below every bound, so an
    // unscheduled lead can never look overdue.
    .index("by_workspaceId_and_nextActionAt", ["workspaceId", "nextActionAt"])
    // Best leads first, for the Contacts sort and the research/reveal order.
    // Indexes the denormalised `scoreKey`, never `research.aiScore` — Convex
    // cannot index into a union member, which is what `scoreKey` exists for.
    .index("by_workspaceId_and_scoreKey", ["workspaceId", "scoreKey"])
    // The sourcing dedupe: has this agent already stored this provider row?
    // Same denormalisation as above, for `origin.sourceLeadId`. The upsert
    // reads this range in the transaction it inserts into, which is what
    // makes the lookup behave as the uniqueness constraint.
    .index("by_agentId_and_sourceLeadKey", ["agentId", "sourceLeadKey"])
    // The per-agent funnel counts the Agent page reports.
    .index("by_agentId_and_stage", ["agentId", "stage"])
    // The approval queue: what is waiting for a yes/no in this workspace.
    .index("by_workspaceId_and_approval", ["workspaceId", "approval"])
    // Contact search. Equality filters are applied INSIDE `withSearchIndex`;
    // search mode never combines with due ranges or date sorting, and empty
    // text falls back to the ordinary list.
    .searchIndex("search_company_name", {
      searchField: "companyName",
      filterFields: ["workspaceId", "stage", "agentId", "approval"],
    }),

  leadEvents: defineTable(leadEventFields)
    .index("by_prospectId_and_createdAt", ["prospectId", "createdAt"])
    // Unique (workspaceId, operationKey) — the idempotency lookup a replayed
    // mutation reads before writing; uniqueness is enforced in that same
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

  /* Correspondence */

  conversations: defineTable(conversationFields)
    // Dashboard: threads whose latest reply falls in a date window.
    .index("by_workspaceId_and_lastInboundAt", ["workspaceId", "lastInboundAt"])
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
    // The invalidation sweep: every draft still current in a conversation.
    .index("by_conversationId_and_state", ["conversationId", "state"])
    // requestId dedupe for revise/createRevision retries.
    .index("by_workspaceId_and_requestId", ["workspaceId", "requestId"])
    // Booking-linked drafts: the invalidation path needs every draft still
    // proposing a booking as one exact range, and a lead can hold several
    // conversations — no conversation-scoped index can find them all.
    .index("by_bookingId", ["bookingId"]),

  approvals: defineTable(approvalFields)
    .index("by_draftId", ["draftId"])
    // One resolution per (workspaceId, requestId), enforced transactionally.
    .index("by_workspaceId_and_requestId", ["workspaceId", "requestId"]),

  sendAttempts: defineTable(sendAttemptFields)
    .index("by_draftId", ["draftId"])
    // The across-revisions guard: queries reserved|requesting|uncertain per
    // conversation inside the reservation mutation.
    .index("by_conversationId_and_state", ["conversationId", "state"])
    // Chronological audit listing — the unfiltered conversation view is
    // newest-first, not state-bucketed.
    .index("by_conversationId_and_createdAt", ["conversationId", "createdAt"])
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
    // PLAN §9.4's message identity: (workspaceId, inboxId, providerMessageId).
    // Provider message ids are unique only within an account, so the triple —
    // not the id alone — is what the single-writer upsert looks up before it
    // inserts or merges. `by_providerMessageRef` below stays for the
    // outbound delivery-fact correlation, which has no inbox in hand.
    .index("by_workspace_inbox_providerMessageId", [
      "workspaceId",
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
    // Bounded operator listing across inboxes.
    .index("by_state_and_receivedAt", ["state", "receivedAt"]),

  /* Usage ledger */

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
    // The per-prospect operation range.
    .index("by_workspaceId_and_prospectId_and_state", [
      "workspaceId",
      "prospectId",
      "state",
    ])
    // The stale-operation sweep: still `requested`/`accepted` past its age.
    .index("by_state_and_updatedAt", ["state", "updatedAt"]),
});
