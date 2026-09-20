/**
 * Lead validators: the person-level lead the agent works — pipeline stage,
 * email status, approval, origin, research and company/location facts — plus
 * the lead-event and research-evidence vocabulary written alongside it.
 *
 * Contract only: these validators and bounds are the single site for the lead
 * vocabulary — no module may re-declare a parallel one.
 */
import { boundedString, EMAIL_DOMAIN, invalid, vOperationError } from "./shared";
import { v } from "convex/values";
import type { Infer } from "convex/values";

/**
 * The lead pipeline (PLAN §7). `stage` plus `nextActionAt` IS the state
 * machine — the cron picks up whatever is due, so nothing else encodes
 * progress.
 *
 * Order is load-bearing: an automatic transition may only move a lead
 * forward (`advancedLeadStage`). The three stages outside the ordered
 * pipeline are deliberate:
 *   `rejected`      — the user said no; only a user re-approval leaves it.
 *   `closed_lost`   — the conversation ended; a human call.
 *   `needs_attention` — a step failed its retry ladder and parked the lead
 *                     with a Retry button (PLAN §9.1).
 */
export const LEAD_PIPELINE_STAGES = [
  "found",
  "researched",
  "queued",
  "contacted",
  "replied",
  "interested",
  "meeting_proposed",
  "meeting_booked",
] as const;

export const LEAD_STAGES = [
  ...LEAD_PIPELINE_STAGES,
  "closed_lost",
  "rejected",
  "needs_attention",
] as const;

export const vLeadStage = v.union(
  v.literal("found"),
  v.literal("researched"),
  v.literal("queued"),
  v.literal("contacted"),
  v.literal("replied"),
  v.literal("interested"),
  v.literal("meeting_proposed"),
  v.literal("meeting_booked"),
  v.literal("closed_lost"),
  v.literal("rejected"),
  v.literal("needs_attention"),
);

export type LeadStage = (typeof LEAD_STAGES)[number];

export type LeadPipelineStage = (typeof LEAD_PIPELINE_STAGES)[number];

/** Stages an automatic transition never enters or leaves. */
export const TERMINAL_LEAD_STAGES: readonly LeadStage[] = [
  "closed_lost",
  "rejected",
];

/** Position in the ordered pipeline, or `-1` for a stage outside it. */
export function leadStageRank(stage: LeadStage): number {
  return (LEAD_PIPELINE_STAGES as readonly string[]).indexOf(stage);
}

/**
 * The stage an AUTOMATIC transition may land on, or the current one.
 *
 * Returning the current stage rather than throwing is deliberate: a step that
 * re-runs on an already-contacted lead should record its finding, not fail.
 * A lead parked in `needs_attention` is not silently un-parked either — only
 * an explicit retry moves it, which is what makes the Retry button honest.
 * Human corrections do not come through here.
 */
export function advancedLeadStage(
  current: LeadStage,
  target: LeadPipelineStage,
): LeadStage {
  if (TERMINAL_LEAD_STAGES.includes(current)) return current;
  if (current === "needs_attention") return current;
  return leadStageRank(target) > leadStageRank(current) ? target : current;
}

/**
 * Whether we have the lead's address (PLAN §7). `locked` is the honest
 * starting state: a sourced row carries no address at all until the user
 * spends the credits to find it, and `not_found` records that we paid and
 * the provider had none — never an invented address.
 */
export const vLeadEmailStatus = v.union(
  v.literal("locked"),
  v.literal("revealing"),
  v.literal("found"),
  v.literal("not_found"),
);

export type LeadEmailStatus = "locked" | "revealing" | "found" | "not_found";

/**
 * Lead approval — "yes, contact this person" (PLAN §9.3). Deliberately NOT
 * email approval, which is a verdict on one draft and lives in `approvals`.
 */
export const vLeadApproval = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);

export type LeadApproval = "pending" | "approved" | "rejected";

/**
 * Who approved. Autopilot approving is a recorded fact, not an absence of
 * one: PLAN §9.3 requires the same ledger either way, so the actor is stored
 * rather than inferred from the agent's mode at read time.
 */
export const vApprovalActor = v.union(
  v.literal("user"),
  v.literal("autopilot"),
);

export type ApprovalActor = "user" | "autopilot";

/**
 * Where the lead came from (PLAN §7, MIGRATION "Final-schema variants").
 *
 * A discriminated union rather than optional columns: a provider id exists
 * only on a sourced lead, and a folded-in pre-pivot campaign only on a
 * migrated one, so "found by a strategy" and "inherited from a campaign" are
 * different documents rather than the same document with different holes.
 * Dedupe on `sourceLeadId` therefore applies to `kind: "sourced"` alone.
 */
export const vLeadOrigin = v.union(
  v.object({
    kind: v.literal("sourced"),
    /** The lead-data provider's own row id. Neutral name by the white-label
     *  rule — no query that feeds the client returns it. */
    sourceLeadId: v.string(),
    /** Every strategy that matched this person; the "+n signals" badge and
     *  the multi-signal score boost both read it (PLAN §3). */
    strategyIds: v.array(v.id("strategies")),
  }),
  v.object({
    kind: v.literal("legacy"),
    legacyCampaignId: v.id("legacyCampaigns"),
  }),
  v.object({ kind: v.literal("manual") }),
);

export type LeadOrigin = Infer<typeof vLeadOrigin>;

/**
 * What research knows (PLAN §7). A score exists ONLY on a researched lead,
 * so found-but-unresearched and migrated leads are valid documents rather
 * than exceptions. UI and queries switch on the variant; nothing reads a
 * bare `aiScore`.
 */
export const vLeadResearch = v.union(
  v.object({ status: v.literal("not_researched") }),
  v.object({ status: v.literal("researching"), startedAt: v.number() }),
  v.object({
    status: v.literal("researched"),
    aiScore: v.union(v.literal(1), v.literal(2), v.literal(3)),
    aiScoreReason: v.string(),
    summary: v.string(),
    researchedAt: v.number(),
  }),
  v.object({ status: v.literal("failed"), lastError: vOperationError }),
);

export type LeadResearch = Infer<typeof vLeadResearch>;

/** The 1–3 flame score, defined once so no call site re-derives the range. */
export const LEAD_SCORE_MIN = 1;

export const LEAD_SCORE_MAX = 3;

/**
 * The denormalised value behind `prospects.by_workspaceId_and_scoreKey`.
 *
 * Convex indexes a top-level field, and `aiScore` lives inside a union
 * member, so the sortable score is stored beside `research` as `scoreKey`.
 * THE INVARIANT: `scoreKey` is written in the SAME patch as `research` and
 * by nothing else — pass the new `research` value through this function and
 * store both. It is an index key, never the score: readers switch on
 * `research.status === "researched"`.
 */
export function leadScoreKey(research: LeadResearch): number | undefined {
  return research.status === "researched" ? research.aiScore : undefined;
}

/**
 * The denormalised value behind `prospects.by_agentId_and_sourceLeadKey`,
 * under the same rule as `leadScoreKey`: written in the same patch as
 * `origin`, by nothing else, and read only as a dedupe lookup key. The
 * sourcing upsert reads this index to decide insert-or-merge (PLAN §3 step 5).
 */
export function leadSourceKey(origin: LeadOrigin): string | undefined {
  return origin.kind === "sourced" ? origin.sourceLeadId : undefined;
}

/**
 * A lead's company, as the free search preview describes it (spikes §3).
 * Stored under our own names — never the provider's — and every member is
 * optional because the preview row nulls all of them.
 */
export const vLeadCompany = v.object({
  linkedinUrl: v.optional(v.string()),
  logoUrl: v.optional(v.string()),
  headline: v.optional(v.string()),
  industry: v.optional(v.string()),
  employeeCount: v.optional(v.number()),
  employeeGrowthRate: v.optional(v.number()),
  revenueBucket: v.optional(v.string()),
  foundedYear: v.optional(v.string()),
  monthlyTraffic: v.optional(v.number()),
  totalFunding: v.optional(v.number()),
  lastFundingType: v.optional(v.string()),
  lastFundingDate: v.optional(v.string()),
  specialties: v.optional(v.string()),
  headquarters: v.optional(
    v.object({
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      country: v.optional(v.string()),
    }),
  ),
});

export type LeadCompany = Infer<typeof vLeadCompany>;

/** Where the person is, as the preview row states it. */
export const vLeadLocation = v.object({
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  country: v.optional(v.string()),
});

export type LeadLocation = Infer<typeof vLeadLocation>;

/**
 * What a migration copied off a lead before the final schema dropped it
 * (MIGRATION §5: a forward step keeps a `legacy` copy until the rollback
 * window closes). Closed shape — never an open bag of pre-pivot keys — and
 * absent on every lead this application creates.
 */
export const vLeadLegacy = v.object({
  migratedAt: v.number(),
  salesStage: v.optional(v.string()),
  qualification: v.optional(v.string()),
  fitReason: v.optional(v.string()),
  ownerIdentityKey: v.optional(v.string()),
  contactEmail: v.optional(v.string()),
  sourceRefCount: v.optional(v.number()),
});

export type LeadLegacy = Infer<typeof vLeadLegacy>;

export const PROSPECT_COMPANY_NAME_MAX_LENGTH = 200;

export const PROSPECT_STAGE_REASON_MAX_LENGTH = 500;

export const PROVIDER_RECORD_ID_MAX_LENGTH = 200;

export const CANONICAL_DOMAIN_MAX_LENGTH = 253;

export const LEAD_PERSON_NAME_MAX_LENGTH = 200;

export const LEAD_HEADLINE_MAX_LENGTH = 500;

export const LEAD_SUMMARY_MAX_LENGTH = 4_000;

export const LEAD_SCORE_REASON_MAX_LENGTH = 1_000;

export const LEAD_SKILLS_MAX = 25;

/**
 * Canonical company domain for research and dedupe. Accepts a bare host or an
 * http(s) URL and extracts the host through the URL parser (so a path, query
 * or credentials cannot leak into the key), lowercases, drops a trailing root
 * dot and drops a leading `www.` — the one subdomain that never identifies a
 * different business. Every OTHER subdomain is preserved.
 *
 * Plain-host only: the shared dotted-domain floor ends in `[a-z]{2,63}`, so a
 * punycode TLD (`xn--p1ai`) is rejected rather than stored.
 *
 * This is a syntax-and-host floor, NOT public-suffix awareness: no suffix list
 * is bundled, so `a.co.uk` and `b.co.uk` stay distinct (correct) but a
 * registrable base cannot be computed. Deepen it HERE so every writer shares
 * one key.
 */
export function normalizeCanonicalDomain(
  value: string,
  field = "canonicalDomain",
): string {
  const trimmed = boundedString(value, field, { min: 1, max: 2048 });
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  // Reject a non-http(s) scheme outright rather than parsing it for a host —
  // `ftp://evil.com` is not a company website and must not become a dedupe key.
  if (scheme !== null && !/^https?$/i.test(scheme[1])) {
    throw invalid(`${field} must be a domain or an http(s) URL`);
  }
  const withScheme = scheme === null ? `https://${trimmed}` : trimmed;
  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    throw invalid(`${field} must be a domain or an http(s) URL`);
  }
  const normalized = host
    .toLowerCase()
    .replace(/\.+$/, "")
    .replace(/^www\./, "");
  if (!EMAIL_DOMAIN.test(normalized)) {
    throw invalid(`${field} must be a valid dotted public domain`);
  }
  return boundedString(normalized, field, {
    min: 3,
    max: CANONICAL_DOMAIN_MAX_LENGTH,
  });
}

/**
 * Append-only lead history kinds. Unlike `activityEvents.kind` — a bounded
 * string feeding a workspace receipts timeline — this is a closed union,
 * because a lead event is the audit record a stage change, an approval and a
 * booking transition are proved by.
 */
export const LEAD_EVENT_KINDS = [
  "stage_changed",
  "note_added",
  "research_applied",
  "email_revealed",
  "approval_changed",
  "send_accepted",
  "reply_received",
  "booking_proposed",
  "booking_confirmed",
  "booking_rescheduled",
  "booking_cancelled",
  "booking_outcome_recorded",
] as const;

export const vLeadEventKind = v.union(
  v.literal("stage_changed"),
  v.literal("note_added"),
  v.literal("research_applied"),
  v.literal("email_revealed"),
  v.literal("approval_changed"),
  v.literal("send_accepted"),
  v.literal("reply_received"),
  v.literal("booking_proposed"),
  v.literal("booking_confirmed"),
  v.literal("booking_rescheduled"),
  v.literal("booking_cancelled"),
  v.literal("booking_outcome_recorded"),
);

export type LeadEventKind = (typeof LEAD_EVENT_KINDS)[number];

/**
 * Who caused the event. A discriminated union rather than
 * `activityEvents.actor`'s bare string, because the provenance is
 * structural: only a `human` actor carries an `identityKey`, and it comes from
 * `ctx.auth` — never from model output or email content. `workflow` is the
 * agent run; `system` is a backend sweep with no human behind it.
 */
export const vLeadEventActor = v.union(
  v.object({ source: v.literal("human"), identityKey: v.string() }),
  v.object({ source: v.literal("workflow") }),
  v.object({ source: v.literal("system") }),
);

export type LeadEventActor = Infer<typeof vLeadEventActor>;

export const LEAD_EVENT_SUMMARY_MAX_LENGTH = 500;

export const LEAD_EVENT_NOTE_MAX_LENGTH = 4_000;

export const LEAD_EVENT_REASON_MAX_LENGTH = 1_000;

/**
 * Structured previous/new values an event preserves. Every member is
 * optional because one event kind uses a few of them, but the shape is
 * closed — a lead event never carries an open bag of model-chosen keys.
 * `fromStage`/`toStage` are top-level columns and are deliberately absent here.
 */
export const vLeadEventDetails = v.object({
  fromApproval: v.optional(vLeadApproval),
  toApproval: v.optional(vLeadApproval),
  /** Who approved — `autopilot` is a recorded actor, not a missing one. */
  approvalActor: v.optional(vApprovalActor),
  fromEmailStatus: v.optional(vLeadEmailStatus),
  toEmailStatus: v.optional(vLeadEmailStatus),
  /** The 1-3 score a `research_applied` event concluded. */
  aiScore: v.optional(v.number()),
  previousStartsAt: v.optional(v.number()),
  previousEndsAt: v.optional(v.number()),
  previousTimezone: v.optional(v.string()),
  /** Stated basis for a human correction, a cancellation or a rejection. */
  reason: v.optional(v.string()),
  /** Body of a `note_added` event — a note, never a synthesized message. */
  note: v.optional(v.string()),
});

export type LeadEventDetails = Infer<typeof vLeadEventDetails>;

/**
 * §4.3/§4.5 research confidence. `hypothesis` must be labeled rather than
 * asserted — an unlabeled guess stored as `supported` is the failure this
 * union exists to prevent.
 */
export const vEvidenceConfidence = v.union(
  v.literal("supported"),
  v.literal("hypothesis"),
  v.literal("unknown"),
);

export type EvidenceConfidence = "supported" | "hypothesis" | "unknown";

/** §4.5 research caps. */
export const EVIDENCE_EXCERPT_MAX_LENGTH = 2_000;

export const EVIDENCE_OBSERVATION_MAX_LENGTH = 1_000;

export const RESEARCH_OBSERVATIONS_MAX = 12;

/**
 * The reserved marker put in front of a topic when the finding is a guess
 * rather than something the page states. §4.5 requires "hypotheses labeled";
 * this is the label, and it is the ONLY way an observation can be stored as
 * `hypothesis`.
 *
 * Matched case-insensitively on the trimmed topic. Nothing else about the
 * model's wording contributes to `confidence` — see `evidence.ts`.
 */
export const EVIDENCE_HYPOTHESIS_MARKER = "hypothesis:";

/**
 * How many observations one research result may hand the synthesis site
 * before the payload itself is refused. Distinct from
 * `RESEARCH_OBSERVATIONS_MAX`, which bounds how many become evidence ROWS:
 * a chatty model must not fail the whole research result, so the overflow is
 * reported as rejected rather than thrown, and only a payload past this bound
 * (which would buy unbounded work inside the caller's transaction) is refused.
 */
export const RESEARCH_OBSERVATION_INPUT_MAX = 50;

/**
 * One reported observation. `sourceUrl` stays optional: an observation
 * without one is not evidence (§4.5), which is a rule about what gets STORED,
 * not about what may be reported.
 */
export const vResearchObservation = v.object({
  topic: v.string(),
  finding: v.string(),
  sourceUrl: v.optional(v.string()),
});

export type ResearchObservation = Infer<typeof vResearchObservation>;

export const EVIDENCE_TOPIC_MAX_LENGTH = 200;

/**
 * Bound one stored `evidence.observation`. The first caller of
 * `EVIDENCE_OBSERVATION_MAX_LENGTH`, which P20 declared with no enforcement.
 * The topic is carried into the observation rather than dropped, so a stored
 * row still says what the finding is ABOUT; the hypothesis marker is stripped
 * because it is a host control token, not part of the observation's text.
 */
export function assertEvidenceObservation(
  topic: string,
  finding: string,
  field = "observation",
): string {
  const bare = stripHypothesisMarker(topic);
  const boundedTopic = boundedString(bare, `${field}.topic`, {
    min: 1,
    max: EVIDENCE_TOPIC_MAX_LENGTH,
  });
  const boundedFinding = boundedString(finding, `${field}.finding`, {
    min: 1,
    max: EVIDENCE_OBSERVATION_MAX_LENGTH,
  });
  return boundedString(`${boundedTopic}: ${boundedFinding}`, field, {
    min: 1,
    max: EVIDENCE_OBSERVATION_MAX_LENGTH,
  });
}

/** True when the model labelled this observation a hypothesis (§4.5). */
export function isHypothesisTopic(topic: string): boolean {
  return topic.trimStart().toLowerCase().startsWith(EVIDENCE_HYPOTHESIS_MARKER);
}

/** The topic with the host's hypothesis marker removed. */
export function stripHypothesisMarker(topic: string): string {
  const trimmed = topic.trim();
  return isHypothesisTopic(trimmed)
    ? trimmed.slice(EVIDENCE_HYPOTHESIS_MARKER.length).trim()
    : trimmed;
}

/**
 * Bound one stored `evidence.excerpt` — a span of the page the BACKEND
 * retrieved, re-sliced from the Firecrawl wrapper's 4,000-char excerpt down
 * to `EVIDENCE_EXCERPT_MAX_LENGTH`. Writing `markdownExcerpt` straight
 * through is out of bounds (§4.5), and so is storing an empty excerpt: a page
 * that yielded no text is a page there is nothing to cite, which must surface
 * as a rejected observation rather than as evidence with nothing behind it.
 */
export function assertEvidenceExcerpt(
  pageExcerpt: string,
  field = "excerpt",
): string {
  return boundedString(pageExcerpt.slice(0, EVIDENCE_EXCERPT_MAX_LENGTH), field, {
    min: 1,
    max: EVIDENCE_EXCERPT_MAX_LENGTH,
  });
}
