/**
 * Shared domain validators for OpenSquad backend functions.
 *
 * Convex `v.*` validators describe wire/storage shape; they cannot express
 * length or syntax rules, so every `v.string()` that carries a bound is paired
 * with a runtime check here. Call the `assert*`/`normalize*` helpers inside
 * handlers before trusting or storing a value.
 */
import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";

export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID";

export function domainError(code: DomainErrorCode, message: string): ConvexError<{
  code: DomainErrorCode;
  message: string;
}> {
  return new ConvexError({ code, message });
}

export function invalid(message: string): ConvexError<{
  code: DomainErrorCode;
  message: string;
}> {
  return domainError("INVALID", message);
}

/* ------------------------------------------------------------------ */
/* Bounded strings                                                     */
/* ------------------------------------------------------------------ */

/**
 * Validate that `value` is a string of `min..max` characters after trimming.
 * Returns the trimmed value. All free-text fields pass through this so stored
 * records and public args stay bounded.
 *
 * Fields carved out of `v.any()` payloads (worker result/input/config
 * envelopes) are `unknown` at runtime — a non-string must be an INVALID
 * rejection, not an uncaught TypeError.
 */
export function boundedString(
  value: string,
  field: string,
  options: { min?: number; max: number },
): string {
  if (typeof value !== "string") {
    throw invalid(`${field} must be a string`);
  }
  const trimmed = value.trim();
  const min = options.min ?? 0;
  if (trimmed.length < min) {
    throw invalid(`${field} must be at least ${min} characters`);
  }
  if (trimmed.length > options.max) {
    throw invalid(`${field} must be at most ${options.max} characters`);
  }
  return trimmed;
}

/** Validate a list of bounded strings with a bounded length. */
export function boundedStringList(
  value: string[],
  field: string,
  options: { maxItems: number; itemMax: number },
): string[] {
  if (value.length > options.maxItems) {
    throw invalid(`${field} allows at most ${options.maxItems} entries`);
  }
  return value.map((entry, index) =>
    boundedString(entry, `${field}[${index}]`, { max: options.itemMax }),
  );
}

/* ------------------------------------------------------------------ */
/* URLs                                                                */
/* ------------------------------------------------------------------ */

/**
 * Validate and normalize a public `http`/`https` URL. Rejects other schemes,
 * credential-bearing URLs and values the URL parser cannot read. Returns the
 * normalized serialization.
 */
export function normalizeHttpUrl(value: string, field: string): string {
  const trimmed = boundedString(value, field, { min: 1, max: 2048 });
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalid(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalid(`${field} must use http or https`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw invalid(`${field} must not contain credentials`);
  }
  return parsed.toString();
}

/* ------------------------------------------------------------------ */
/* Timezones                                                           */
/* ------------------------------------------------------------------ */

/**
 * Validate an IANA timezone name using the runtime's Intl database.
 * Returns the canonical IANA name; throws `INVALID` for unknown zones.
 */
export function assertIanaTimezone(value: string, field = "timezone"): string {
  const trimmed = boundedString(value, field, { min: 1, max: 100 });
  try {
    // Throws RangeError for names outside the IANA database. The resolved
    // name is canonical ("america/new_york" → "America/New_York") so stored
    // values compare equal across case variants.
    return new Intl.DateTimeFormat("en-US", { timeZone: trimmed })
      .resolvedOptions().timeZone;
  } catch {
    throw invalid(`${field} must be a valid IANA timezone`);
  }
}

/* ------------------------------------------------------------------ */
/* Numbers, pagination                                                 */
/* ------------------------------------------------------------------ */

export function boundedInt(
  value: number,
  field: string,
  options: { min: number; max: number },
): number {
  if (!Number.isInteger(value)) {
    throw invalid(`${field} must be an integer`);
  }
  if (value < options.min || value > options.max) {
    throw invalid(`${field} must be between ${options.min} and ${options.max}`);
  }
  return value;
}

/* Calendar window for stored application timestamps. A seconds-resolution
 * value or a provider-supplied garbage number is out of range here, so it
 * cannot be stored as a due date, retrieval time or meeting start. */
export const EPOCH_MS_MIN = 1_000_000_000_000;
export const EPOCH_MS_MAX = 4_102_444_800_000;

/** Validate an integer UTC epoch-millisecond timestamp (§4 notation). */
export function assertEpochMs(value: number, field: string): number {
  return boundedInt(value, field, { min: EPOCH_MS_MIN, max: EPOCH_MS_MAX });
}

export const DEFAULT_LIST_LIMIT = 25;
export const MAX_LIST_LIMIT = 50;

/** Clamp an optional client-supplied limit to the standard bounded range. */
export function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIST_LIMIT;
  }
  return boundedInt(limit, "limit", { min: 1, max: MAX_LIST_LIMIT });
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

export const vRole = v.union(
  v.literal("owner"),
  v.literal("operator"),
  v.literal("viewer"),
);

export const vMembershipStatus = v.union(
  v.literal("active"),
  v.literal("revoked"),
);

/* ------------------------------------------------------------------ */
/* Employee capability policy                                          */
/* ------------------------------------------------------------------ */

/**
 * Host-enforced capability IDs. A workspace prompt can only ever narrow this
 * set; capability IDs outside this union are rejected, not silently dropped.
 * Apollo send/sequence enrollment, direct Firecrawl MCP access and arbitrary
 * shell/network tools are intentionally absent (architecture §9).
 */
export const CAPABILITY_IDS = [
  "apollo.company_search",
  "apollo.contact_enrichment",
  "opensquad.web_research",
  "opensquad.draft_compose",
  "opensquad.reply_classify",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export const vCapabilityId = v.union(
  v.literal("apollo.company_search"),
  v.literal("apollo.contact_enrichment"),
  v.literal("opensquad.web_research"),
  v.literal("opensquad.draft_compose"),
  v.literal("opensquad.reply_classify"),
);

export const vEmployeeTemplate = v.union(
  v.literal("scout"),
  v.literal("researcher"),
  v.literal("outreach"),
);

export type EmployeeTemplate = "scout" | "researcher" | "outreach";

/** Maximum capability set each employee template may ever hold. */
export const HOST_CAPABILITY_POLICY: Readonly<
  Record<EmployeeTemplate, readonly CapabilityId[]>
> = {
  scout: ["apollo.company_search", "apollo.contact_enrichment"],
  researcher: ["opensquad.web_research"],
  outreach: ["opensquad.draft_compose", "opensquad.reply_classify"],
};

/**
 * Intersect a requested capability preference with the enforced host policy
 * for the template. Unknown IDs are already excluded by `vCapabilityId`;
 * valid-but-not-permitted IDs fail loudly rather than being dropped.
 */
export function intersectCapabilities(
  template: EmployeeTemplate,
  requested: CapabilityId[],
): CapabilityId[] {
  const allowed = new Set<CapabilityId>(HOST_CAPABILITY_POLICY[template]);
  const denied = requested.filter((cap) => !allowed.has(cap));
  if (denied.length > 0) {
    throw invalid(
      `capabilities ${denied.join(", ")} are not permitted for ${template}`,
    );
  }
  return [...new Set(requested)];
}

/* ------------------------------------------------------------------ */
/* Campaign source plans                                               */
/* ------------------------------------------------------------------ */

export const vCampaignStatus = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("completed"),
);

export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export const CAMPAIGN_LEAD_LIMIT_MIN = 1;
export const CAMPAIGN_LEAD_LIMIT_MAX = 5;
export const CAMPAIGN_ENRICHMENT_LIMIT_MIN = 0;
export const CAMPAIGN_ENRICHMENT_LIMIT_MAX = 10;
export const SOURCE_PLAN_MAX_SOURCES = 3;
export const SOURCE_MAX_RESULTS_MAX = 25;

const vEmployeeCountRange = v.object({
  min: v.number(),
  max: v.number(),
});

/**
 * Apollo company discovery filters: location/category filters plus a bounded
 * employee-count range (architecture §4.1).
 */
export const vApolloSource = v.object({
  source: v.literal("apollo"),
  filters: v.object({
    locations: v.optional(v.array(v.string())),
    categories: v.optional(v.array(v.string())),
    employeeCount: v.optional(vEmployeeCountRange),
  }),
  maxResults: v.optional(v.number()),
});

/** YC directory filters; the selected batch is recorded where applicable. */
export const vYcSource = v.object({
  source: v.literal("yc"),
  filters: v.object({
    batch: v.optional(v.string()),
    categories: v.optional(v.array(v.string())),
    locations: v.optional(v.array(v.string())),
  }),
  maxResults: v.optional(v.number()),
});

/**
 * TrustMRR revenue bounds always carry an explicit metric name, ISO 4217
 * currency and reporting period.
 */
export const vTrustmrrSource = v.object({
  source: v.literal("trustmrr"),
  filters: v.object({
    metric: v.string(),
    currency: v.string(),
    period: v.union(v.literal("monthly"), v.literal("annual")),
    min: v.optional(v.number()),
    max: v.optional(v.number()),
  }),
  maxResults: v.optional(v.number()),
});

export const vSourceConfig = v.union(vApolloSource, vYcSource, vTrustmrrSource);

/**
 * The interpreted source plan stored on a campaign. `instruction` preserves
 * the original operator text separately from the typed interpretation.
 * `confirmed*` fields are stamped once by `campaigns.confirmSourcePlan` and
 * are immutable afterwards.
 */
export const vSourcePlan = v.object({
  instruction: v.string(),
  sources: v.array(vSourceConfig),
  confirmedBy: v.optional(v.string()),
  confirmedAt: v.optional(v.number()),
  confirmedBriefVersion: v.optional(v.number()),
});

/** Domain type derived from the wire validator — never a hand-copied shape. */
export type SourceConfig = Infer<typeof vSourceConfig>;

/**
 * Source routes currently enabled for execution. YC and TrustMRR keep typed
 * contracts but stay disabled until their extraction gates pass (plan §1);
 * confirming a plan containing one fails with an explicit reason.
 */
export const ENABLED_SOURCES = ["apollo"] as const;

/** Runtime checks shared by campaign create/confirm paths. */
export function assertValidSourceConfigs(sources: SourceConfig[]): void {
  if (sources.length === 0) {
    throw invalid("sourcePlan.sources must name at least one source");
  }
  if (sources.length > SOURCE_PLAN_MAX_SOURCES) {
    throw invalid(
      `sourcePlan.sources allows at most ${SOURCE_PLAN_MAX_SOURCES} sources`,
    );
  }
  const seen = new Set<string>();
  for (const config of sources) {
    if (seen.has(config.source)) {
      throw invalid(`source ${config.source} is listed more than once`);
    }
    seen.add(config.source);
    if (config.maxResults !== undefined) {
      boundedInt(config.maxResults, "maxResults", {
        min: 1,
        max: SOURCE_MAX_RESULTS_MAX,
      });
    }
    switch (config.source) {
      case "apollo": {
        const filters = config.filters;
        if (filters.locations !== undefined) {
          boundedStringList(filters.locations, "apollo.locations", {
            maxItems: 10,
            itemMax: 100,
          });
        }
        if (filters.categories !== undefined) {
          boundedStringList(filters.categories, "apollo.categories", {
            maxItems: 10,
            itemMax: 100,
          });
        }
        if (filters.employeeCount !== undefined) {
          const { min, max } = filters.employeeCount;
          boundedInt(min, "apollo.employeeCount.min", { min: 1, max: 100000 });
          boundedInt(max, "apollo.employeeCount.max", { min: 1, max: 100000 });
          if (min > max) {
            throw invalid("apollo.employeeCount.min must not exceed max");
          }
        }
        break;
      }
      case "yc": {
        const filters = config.filters;
        if (filters.batch !== undefined) {
          boundedString(filters.batch, "yc.batch", { min: 1, max: 32 });
        }
        if (filters.categories !== undefined) {
          boundedStringList(filters.categories, "yc.categories", {
            maxItems: 10,
            itemMax: 100,
          });
        }
        if (filters.locations !== undefined) {
          boundedStringList(filters.locations, "yc.locations", {
            maxItems: 10,
            itemMax: 100,
          });
        }
        break;
      }
      case "trustmrr": {
        const filters = config.filters;
        boundedString(filters.metric, "trustmrr.metric", {
          min: 1,
          max: 32,
        });
        if (!/^[A-Z]{3}$/.test(filters.currency)) {
          throw invalid(
            "trustmrr.currency must be a three-letter ISO 4217 code",
          );
        }
        if (filters.min !== undefined && filters.min < 0) {
          throw invalid("trustmrr.min must be nonnegative");
        }
        if (filters.max !== undefined && filters.max < 0) {
          throw invalid("trustmrr.max must be nonnegative");
        }
        if (
          filters.min !== undefined &&
          filters.max !== undefined &&
          filters.min > filters.max
        ) {
          throw invalid("trustmrr.min must not exceed trustmrr.max");
        }
        break;
      }
    }
  }
}

/** Reject sources whose extraction gate has not passed yet. */
export function assertSourcesEnabled(sources: SourceConfig[]): void {
  const enabled = new Set<string>(ENABLED_SOURCES);
  const disabled = [
    ...new Set(
      sources.map((config) => config.source).filter((s) => !enabled.has(s)),
    ),
  ];
  if (disabled.length > 0) {
    throw invalid(
      `source ${disabled.join(", ")} is not enabled yet; its extraction gate is still pending`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Missions, runs, decisions and activity (P06 — architecture §4.2/§6)  */
/* ------------------------------------------------------------------ */

export const vMissionKind = v.union(
  v.literal("sales_campaign"),
  v.literal("reply"),
  v.literal("follow_up"),
);

export type MissionKind = "sales_campaign" | "reply" | "follow_up";

/**
 * Mission states (§4.2/§6). `waiting_for_user` means a required open decision
 * blocks the workflow; `waiting_for_runtime` means reconnect/capacity
 * uncertainty needs attention — both render in Needs you but never pose as
 * each other.
 */
export const vMissionState = v.union(
  v.literal("queued"),
  v.literal("active"),
  v.literal("waiting_for_user"),
  v.literal("waiting_for_runtime"),
  v.literal("paused"),
  v.literal("failed"),
  v.literal("completed"),
  v.literal("cancelled"),
);

export type MissionState =
  | "queued"
  | "active"
  | "waiting_for_user"
  | "waiting_for_runtime"
  | "paused"
  | "failed"
  | "completed"
  | "cancelled";

/**
 * Mission Control board columns (§6 table). Order is Backlog, Needs you,
 * In flight, Done.
 */
export const vBoardColumn = v.union(
  v.literal("backlog"),
  v.literal("needs_you"),
  v.literal("in_flight"),
  v.literal("done"),
);

export type BoardColumn = "backlog" | "needs_you" | "in_flight" | "done";

export const BOARD_COLUMN_ORDER: readonly BoardColumn[] = [
  "backlog",
  "needs_you",
  "in_flight",
  "done",
];

/** Direct state → column mapping from the architecture §6 table. */
export const MISSION_STATE_BOARD: Readonly<Record<MissionState, BoardColumn>> = {
  queued: "backlog",
  active: "in_flight",
  waiting_for_user: "needs_you",
  waiting_for_runtime: "needs_you",
  paused: "backlog",
  failed: "needs_you",
  completed: "done",
  cancelled: "backlog",
};

/**
 * The effective board column for a mission row (§6): `requiredDecisionCount`
 * above zero places actionable work in Needs you even while the workflow
 * still owns execution — except for paused/cancelled/completed missions,
 * whose explicit badges win.
 */
export function boardColumnForMission(
  state: MissionState,
  requiredDecisionCount: number,
): BoardColumn {
  if (state === "paused" || state === "cancelled" || state === "completed") {
    return MISSION_STATE_BOARD[state];
  }
  if (requiredDecisionCount > 0) {
    return "needs_you";
  }
  return MISSION_STATE_BOARD[state];
}

/**
 * Legal state transitions (§6). `paused` resumes through `missions.resume`,
 * which picks the concrete target state by re-reading open asks; `failed`
 * may only be cancelled (archive path) until an explicit retry flow lands.
 * The workflow's internal transitions use the same table.
 *
 * `queued → failed`, `paused → failed` and `paused → completed` exist for
 * the terminal reconcile paths (`failMission`/`completeMissionTx` via
 * `onMissionWorkflowComplete`): the owning workflow can die before the
 * dispatch gate runs (still `queued`) or land its terminal callback after a
 * `pause` committed (`paused`). An onComplete error is swallowed by the
 * workpool, so an illegal-transition throw here would wedge the mission in
 * a non-terminal state with a dead workflow.
 */
export const MISSION_TRANSITIONS: Readonly<
  Record<MissionState, readonly MissionState[]>
> = {
  queued: ["active", "paused", "cancelled", "failed"],
  active: [
    "waiting_for_user",
    "waiting_for_runtime",
    "paused",
    "failed",
    "completed",
    "cancelled",
  ],
  waiting_for_user: ["active", "paused", "failed", "completed", "cancelled"],
  waiting_for_runtime: [
    "active",
    "paused",
    "failed",
    "completed",
    "cancelled",
  ],
  paused: [
    "queued",
    "active",
    "waiting_for_user",
    "failed",
    "completed",
    "cancelled",
  ],
  failed: ["cancelled"],
  completed: [],
  cancelled: [],
};

export function assertMissionTransition(
  from: MissionState,
  to: MissionState,
): void {
  if (!MISSION_TRANSITIONS[from].includes(to)) {
    throw domainError(
      "CONFLICT",
      `mission cannot move from ${from} to ${to}`,
    );
  }
}

export const vMissionPriority = v.union(
  v.literal("normal"),
  v.literal("high"),
);

export const vMissionVisibility = v.union(
  v.literal("visible"),
  v.literal("archived"),
);

export type MissionVisibility = "visible" | "archived";

/**
 * Frozen inputs recorded at dispatch (§4.2): confirmed brief/source plan,
 * business-profile version + relevant text, employee instruction versions,
 * policy version and the requested outcome. Bound to 64 KiB serialized.
 */
export const INPUT_SNAPSHOT_MAX_BYTES = 64 * 1024;

export const vInputSnapshot = v.object({
  campaignTitle: v.string(),
  campaignBrief: v.string(),
  briefVersion: v.number(),
  sourcePlan: vSourcePlan,
  businessProfile: v.optional(
    v.object({
      version: v.number(),
      websiteUrl: v.string(),
      offer: v.string(),
      idealCustomer: v.string(),
      tone: v.string(),
      exclusions: v.array(v.string()),
    }),
  ),
  employeeInstructions: v.array(
    v.object({
      employeeId: v.id("employees"),
      template: vEmployeeTemplate,
      name: v.string(),
      instructionVersion: v.number(),
    }),
  ),
  policyVersion: v.number(),
  requestedOutcome: v.string(),
});

export type InputSnapshot = Infer<typeof vInputSnapshot>;

/** Enforce the §4.2 64 KiB serialized bound on a stored input snapshot. */
export function assertInputSnapshotSize(snapshot: InputSnapshot): void {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
  if (bytes > INPUT_SNAPSHOT_MAX_BYTES) {
    throw invalid(
      `inputSnapshot is ${bytes} bytes; the bound is ${INPUT_SNAPSHOT_MAX_BYTES}`,
    );
  }
}

export const vRunState = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("uncertain"),
);

export type RunState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "uncertain";

export const vDecisionKind = v.union(
  v.literal("draft_approval"),
  v.literal("missing_information"),
  v.literal("connection_required"),
  v.literal("delivery_uncertain"),
);

export type DecisionKind =
  | "draft_approval"
  | "missing_information"
  | "connection_required"
  | "delivery_uncertain";

export const vDecisionState = v.union(
  v.literal("open"),
  v.literal("resolved"),
  v.literal("superseded"),
  v.literal("cancelled"),
);

export type DecisionState = "open" | "resolved" | "superseded" | "cancelled";

/**
 * The human answer recorded on a decision. `fields` carries the values for a
 * `missing_information` ask, `approved`+`body` carry approve/reject/reason for
 * approval-flavored asks. Exact draft-approval binding (revision, payload
 * hash, approvals table) is P10; P06 stores the honest answer generically.
 */
export const vDecisionAnswer = v.object({
  body: v.optional(v.string()),
  approved: v.optional(v.boolean()),
  fields: v.optional(v.record(v.string(), v.string())),
});

export type DecisionAnswer = Infer<typeof vDecisionAnswer>;

export function assertDecisionAnswer(answer: DecisionAnswer): void {
  if (
    answer.body === undefined &&
    answer.approved === undefined &&
    (answer.fields === undefined || Object.keys(answer.fields).length === 0)
  ) {
    throw invalid("answer must carry a body, an approved flag or fields");
  }
  if (answer.body !== undefined) {
    boundedString(answer.body, "answer.body", { min: 1, max: 4000 });
  }
  if (answer.fields !== undefined) {
    const entries = Object.entries(answer.fields);
    if (entries.length > 20) {
      throw invalid("answer.fields allows at most 20 entries");
    }
    for (const [key, value] of entries) {
      boundedString(key, "answer.fields key", { min: 1, max: 100 });
      boundedString(value, `answer.fields[${key}]`, { max: 2000 });
    }
  }
}

/**
 * Per-prospect branch outcomes (§4.2 `missionProspects.outcome`, §6.1):
 * the explicit terminal results a parent aggregates — approved/delivered
 * work completed, contact still needed, intentionally rejected, deliberately
 * skipped, technical failure or cancellation.
 */
export const vMissionProspectOutcome = v.union(
  v.literal("completed"),
  v.literal("contact_needed"),
  v.literal("rejected"),
  v.literal("skipped"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export type MissionProspectOutcome =
  | "completed"
  | "contact_needed"
  | "rejected"
  | "skipped"
  | "failed"
  | "cancelled";

/**
 * Terminal parent outcomes (§6.1 step 9 / P06 card): `completed` when every
 * promised deliverable exists, `partial` when some branches completed and
 * others ended rejected/contact-needed/skipped, `contact_needed` when work
 * is done but contacts are still owed, `skipped` when everything was
 * deliberately skipped, `failed`/`cancelled` for the technical paths.
 */
export const vMissionOutcome = v.union(
  v.literal("completed"),
  v.literal("partial"),
  v.literal("contact_needed"),
  v.literal("skipped"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export type MissionOutcome =
  | "completed"
  | "partial"
  | "contact_needed"
  | "skipped"
  | "failed"
  | "cancelled";

/** Aggregate explicit child outcomes into the terminal parent outcome. */
export function aggregateMissionOutcome(
  outcomes: readonly MissionProspectOutcome[],
): MissionOutcome {
  if (outcomes.length === 0) {
    return "completed";
  }
  const count = (kind: MissionProspectOutcome) =>
    outcomes.filter((outcome) => outcome === kind).length;
  const failed = count("failed");
  const cancelled = count("cancelled");
  if (failed === outcomes.length) {
    return "failed";
  }
  if (cancelled === outcomes.length) {
    return "cancelled";
  }
  if (count("completed") === outcomes.length) {
    return "completed";
  }
  if (count("skipped") === outcomes.length) {
    return "skipped";
  }
  if (count("contact_needed") + count("rejected") === outcomes.length) {
    return "contact_needed";
  }
  return "partial";
}

/**
 * Activity event kinds written by the mission machinery. `kind` stays a
 * bounded string in storage so later tasks can add kinds; producers here
 * keep to this list.
 */
export const ACTIVITY_KINDS = [
  "mission_created",
  "mission_state_changed",
  "mission_archived",
  "mission_restored",
  "mission_completed",
  "mission_failed",
  "run_started",
  "run_completed",
  "run_failed",
  "decision_opened",
  "decision_resolved",
  "decision_superseded",
  "decision_cancelled",
  "prospect_branch_started",
  "prospect_branch_completed",
  "comment_added",
  "continuation_delivered",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const vActivityKind = v.union(
  v.literal("mission_created"),
  v.literal("mission_state_changed"),
  v.literal("mission_archived"),
  v.literal("mission_restored"),
  v.literal("mission_completed"),
  v.literal("mission_failed"),
  v.literal("run_started"),
  v.literal("run_completed"),
  v.literal("run_failed"),
  v.literal("decision_opened"),
  v.literal("decision_resolved"),
  v.literal("decision_superseded"),
  v.literal("decision_cancelled"),
  v.literal("prospect_branch_started"),
  v.literal("prospect_branch_completed"),
  v.literal("comment_added"),
  v.literal("continuation_delivered"),
);

/* ------------------------------------------------------------------ */
/* P07 — scoped worker bridge and runtime lifecycle (§4.4/§4.5)         */
/* ------------------------------------------------------------------ */

/**
 * Bridge error codes. `DomainErrorCode` covers the shared meanings; the
 * bridge additionally needs `PAYLOAD_TOO_LARGE` (413), `THROTTLED` (429) and
 * `UNAVAILABLE` (503) for the documented status table. NOT_FOUND is mapped
 * to the same wire shape as INVALID (400) — a foreign or unknown ID must not
 * leak existence across scopes.
 */
export type BridgeErrorCode =
  | DomainErrorCode
  | "PAYLOAD_TOO_LARGE"
  | "THROTTLED"
  | "UNAVAILABLE";

export function bridgeError(
  code: BridgeErrorCode,
  message: string,
): ConvexError<{ code: BridgeErrorCode; message: string }> {
  return new ConvexError({ code, message });
}

export function bridgeInvalid(
  message: string,
): ConvexError<{ code: BridgeErrorCode; message: string }> {
  return bridgeError("INVALID", message);
}

/* ---- structural helpers for untrusted worker payloads ---------------- */

export function asRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw bridgeInvalid(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw bridgeInvalid(`${field} must be an array`);
  }
  return value;
}

/** Serialized-UTF-8 size check; returns the byte count. */
export function jsonBytes(
  value: unknown,
  field: string,
  max: number,
): number {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  if (bytes > max) {
    throw bridgeInvalid(`${field} is ${bytes} bytes; the bound is ${max}`);
  }
  return bytes;
}

/* ---- state machines --------------------------------------------------- */

export const RUNTIME_CONNECTION_STATES = [
  "disconnected",
  "provisioning",
  "connecting",
  "ready",
  "stopping",
  "stopped",
  "error",
] as const;
export const vRuntimeConnectionState = v.union(
  v.literal("disconnected"),
  v.literal("provisioning"),
  v.literal("connecting"),
  v.literal("ready"),
  v.literal("stopping"),
  v.literal("stopped"),
  v.literal("error"),
);
export type RuntimeConnectionState =
  (typeof RUNTIME_CONNECTION_STATES)[number];

export const LIFECYCLE_OPERATIONS = [
  "create",
  "resume",
  "extend_ttl",
  "stop",
  "delete",
] as const;
export const vLifecycleOperation = v.union(
  v.literal("create"),
  v.literal("resume"),
  v.literal("extend_ttl"),
  v.literal("stop"),
  v.literal("delete"),
);
export type LifecycleOperation = (typeof LIFECYCLE_OPERATIONS)[number];

export const LIFECYCLE_OPERATION_STATES = [
  "pending",
  "accepted",
  "uncertain",
  "completed",
  "failed",
] as const;
export const vLifecycleOperationState = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("uncertain"),
  v.literal("completed"),
  v.literal("failed"),
);
export type LifecycleOperationState =
  (typeof LIFECYCLE_OPERATION_STATES)[number];

export const PROVIDER_KINDS = [
  "codex",
  "apollo",
  "firecrawl",
  "agentmail",
] as const;
export const vProviderKind = v.union(
  v.literal("codex"),
  v.literal("apollo"),
  v.literal("firecrawl"),
  v.literal("agentmail"),
);
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const PROVIDER_CONNECTION_STATES = [
  "disconnected",
  "connecting",
  "ready",
  "expired",
  "error",
] as const;
export const vProviderConnectionState = v.union(
  v.literal("disconnected"),
  v.literal("connecting"),
  v.literal("ready"),
  v.literal("expired"),
  v.literal("error"),
);
export type ProviderConnectionState =
  (typeof PROVIDER_CONNECTION_STATES)[number];

/** Bearer-token capability names — checked per bridge route. */
export const WORKER_SCOPES = [
  "claim",
  "control",
  "heartbeat",
  "activity",
  "result",
  "artifact",
] as const;
export const vWorkerScope = v.union(
  v.literal("claim"),
  v.literal("control"),
  v.literal("heartbeat"),
  v.literal("activity"),
  v.literal("result"),
  v.literal("artifact"),
);
export type WorkerScope = (typeof WORKER_SCOPES)[number];

export const CONTROL_COMMANDS = [
  "inspect_account",
  "start_login",
  "cancel_login",
  "logout",
  "interrupt_turn",
] as const;
export const vControlCommand = v.union(
  v.literal("inspect_account"),
  v.literal("start_login"),
  v.literal("cancel_login"),
  v.literal("logout"),
  v.literal("interrupt_turn"),
);
export type ControlCommand = (typeof CONTROL_COMMANDS)[number];

export const CONTROL_REQUEST_STATES = [
  "pending",
  "claimed",
  "completed",
  "failed",
  "expired",
] as const;
export const vControlRequestState = v.union(
  v.literal("pending"),
  v.literal("claimed"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("expired"),
);
export type ControlRequestState = (typeof CONTROL_REQUEST_STATES)[number];

export const WORKER_REQUEST_STATES = [
  "pending",
  "leased",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "uncertain",
] as const;
export const vWorkerRequestState = v.union(
  v.literal("pending"),
  v.literal("leased"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("uncertain"),
);
export type WorkerRequestState = (typeof WORKER_REQUEST_STATES)[number];

export const SLOT_STATES = ["idle", "held", "uncertain"] as const;
export const vSlotState = v.union(
  v.literal("idle"),
  v.literal("held"),
  v.literal("uncertain"),
);
export type SlotState = (typeof SLOT_STATES)[number];

export const WORKER_PHASES = [
  "boot",
  "ready",
  "running",
  "degraded",
  "stopping",
] as const;
export const vWorkerPhase = v.union(
  v.literal("boot"),
  v.literal("ready"),
  v.literal("running"),
  v.literal("degraded"),
  v.literal("stopping"),
);
export type WorkerPhase = (typeof WORKER_PHASES)[number];

/** §4.5 operation discriminators — one per bounded model-work step. */
export const WORKER_OPERATIONS = [
  "discover",
  "research",
  "contact",
  "draft",
  "classify_reply",
] as const;
export const vWorkerOperation = v.union(
  v.literal("discover"),
  v.literal("research"),
  v.literal("contact"),
  v.literal("draft"),
  v.literal("classify_reply"),
);
export type WorkerOperation = (typeof WORKER_OPERATIONS)[number];

export const ARTIFACT_KINDS = [
  "research_brief",
  "crawl",
  "audit",
  "attachment",
] as const;
export const vArtifactKind = v.union(
  v.literal("research_brief"),
  v.literal("crawl"),
  v.literal("audit"),
  v.literal("attachment"),
);
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/* ---- bounded worker payload transport --------------------------------- */

/** Worker input cap — 256 KiB serialized (§4.4 note). */
export const WORKER_INPUT_MAX_BYTES = 256 * 1024;
/** Structured output cap — 128 KiB serialized (§4.4 note). */
export const WORKER_RESULT_MAX_BYTES = 128 * 1024;
/** Artifact upload cap — 5 MiB raw bytes. */
export const ARTIFACT_MAX_BYTES = 5 * 1024 * 1024;
/** Generic bridge JSON body cap — results fit comfortably inside it. */
export const BRIDGE_BODY_MAX_BYTES = 320 * 1024;

export const ARTIFACT_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "application/json",
  "application/pdf",
  "image/png",
  "image/jpeg",
] as const;
export type ArtifactMimeType = (typeof ARTIFACT_MIME_TYPES)[number];

/** Small inline document or a private storage reference. */
export const vWorkerDataRef = v.union(
  v.object({ kind: v.literal("inline"), value: v.any() }),
  v.object({
    kind: v.literal("storage"),
    storageId: v.id("_storage"),
    byteSize: v.number(),
    digest: v.string(),
  }),
);
export type WorkerDataRef = Infer<typeof vWorkerDataRef>;

/* ---- §4.5 worker input envelope (claim response → worker) -------------- */

export const WORKER_INPUT_SCHEMA_VERSION = 1;

export const vWorkerRequestInput = v.object({
  schemaVersion: v.literal(WORKER_INPUT_SCHEMA_VERSION),
  operation: vWorkerOperation,
  /** Fully-rendered bounded instructions for this turn. */
  prompt: v.string(),
  /** Optional bounded context blocks the model may cite. */
  context: v.optional(
    v.array(v.object({ label: v.string(), text: v.string() })),
  ),
  constraints: v.object({
    /** Wall-clock budget for the bounded turn (ms). */
    deadlineMs: v.number(),
    maxToolCalls: v.optional(v.number()),
    model: v.optional(v.string()),
  }),
  session: v.optional(
    v.object({
      scopeKey: v.string(),
      /** Resume this saved Codex thread when present. */
      codexThreadRef: v.optional(v.string()),
    }),
  ),
  /** The structured-output JSON Schema handed to Codex verbatim. */
  outputSchema: v.any(),
});
export type WorkerRequestInput = Infer<typeof vWorkerRequestInput>;

/** Structural + size validation for an input envelope (untrusted at rest). */
export function assertWorkerRequestInput(
  value: unknown,
): asserts value is WorkerRequestInput {
  const input = asRecord(value, "input");
  if (input.schemaVersion !== WORKER_INPUT_SCHEMA_VERSION) {
    throw invalid("input.schemaVersion must be 1");
  }
  if (!WORKER_OPERATIONS.includes(input.operation as WorkerOperation)) {
    throw invalid("input.operation is not a known operation");
  }
  boundedString(input.prompt as string, "input.prompt", {
    min: 1,
    max: 16000,
  });
  if (input.context !== undefined) {
    const context = asArray(input.context, "input.context");
    if (context.length > 16) {
      throw invalid("input.context must be an array of at most 16 blocks");
    }
    context.forEach((block, index) => {
      const b = asRecord(block, `input.context[${index}]`);
      boundedString(b.label as string, `input.context[${index}].label`, {
        min: 1,
        max: 100,
      });
      boundedString(b.text as string, `input.context[${index}].text`, {
        min: 0,
        max: 8000,
      });
    });
  }
  const constraints = asRecord(input.constraints, "input.constraints");
  const deadlineMs = constraints.deadlineMs;
  if (
    typeof deadlineMs !== "number" ||
    !Number.isFinite(deadlineMs) ||
    deadlineMs < 1000 ||
    deadlineMs > 30 * 60 * 1000
  ) {
    throw invalid("input.constraints.deadlineMs must be 1s..30m");
  }
  if (
    constraints.maxToolCalls !== undefined &&
    (typeof constraints.maxToolCalls !== "number" ||
      !Number.isSafeInteger(constraints.maxToolCalls) ||
      constraints.maxToolCalls < 0 ||
      constraints.maxToolCalls > 200)
  ) {
    throw invalid("input.constraints.maxToolCalls must be an integer 0..200");
  }
  if (constraints.model !== undefined) {
    boundedString(constraints.model as string, "input.constraints.model", {
      min: 1,
      max: 100,
    });
  }
  if (input.session !== undefined) {
    const session = asRecord(input.session, "input.session");
    boundedString(session.scopeKey as string, "input.session.scopeKey", {
      min: 1,
      max: 200,
    });
    if (session.codexThreadRef !== undefined) {
      boundedString(
        session.codexThreadRef as string,
        "input.session.codexThreadRef",
        { min: 1, max: 200 },
      );
    }
  }
  jsonBytes(input.outputSchema, "input.outputSchema", 64 * 1024);
  jsonBytes(input, "input", WORKER_INPUT_MAX_BYTES);
}

/* ---- §4.5 worker result envelopes (schemaVersion 1) -------------------- */

const vWorkerUsage = v.object({
  toolCalls: v.optional(v.number()),
  modelCalls: v.optional(v.number()),
  tokens: v.optional(v.number()),
});
export type WorkerUsage = Infer<typeof vWorkerUsage>;

const vEvidenceRef = v.object({
  label: v.string(),
  artifactId: v.optional(v.string()),
  storageId: v.optional(v.string()),
});

export const vDiscoverResult = v.object({
  schemaVersion: v.literal(1),
  operation: v.literal("discover"),
  summary: v.string(),
  candidates: v.array(
    v.object({
      companyName: v.string(),
      domain: v.optional(v.string()),
      industry: v.optional(v.string()),
      size: v.optional(v.string()),
      reason: v.string(),
      source: v.optional(v.string()),
    }),
  ),
  evidenceRefs: v.optional(v.array(vEvidenceRef)),
  usage: v.optional(vWorkerUsage),
});

export const vResearchResult = v.object({
  schemaVersion: v.literal(1),
  operation: v.literal("research"),
  /** `pending` when no durable backend crawl exists (never fabricated). */
  status: v.union(v.literal("complete"), v.literal("pending")),
  summary: v.string(),
  observations: v.array(
    v.object({
      topic: v.string(),
      finding: v.string(),
      sourceUrl: v.optional(v.string()),
    }),
  ),
  artifactIds: v.optional(v.array(v.string())),
  evidenceRefs: v.optional(v.array(vEvidenceRef)),
  usage: v.optional(vWorkerUsage),
});

export const vContactResult = v.object({
  schemaVersion: v.literal(1),
  operation: v.literal("contact"),
  status: v.union(
    v.literal("found"),
    v.literal("not_found"),
    v.literal("ambiguous"),
  ),
  contacts: v.array(
    v.object({
      fullName: v.string(),
      role: v.optional(v.string()),
      email: v.optional(v.string()),
      emailConfidence: v.optional(
        v.union(
          v.literal("high"),
          v.literal("medium"),
          v.literal("low"),
        ),
      ),
      source: v.optional(v.string()),
    }),
  ),
  summary: v.string(),
  evidenceRefs: v.optional(v.array(vEvidenceRef)),
  usage: v.optional(vWorkerUsage),
});

export const vDraftResult = v.object({
  schemaVersion: v.literal(1),
  operation: v.literal("draft"),
  subject: v.string(),
  body: v.string(),
  tone: v.optional(v.string()),
  callToAction: v.optional(v.string()),
  evidenceRefs: v.optional(v.array(vEvidenceRef)),
  usage: v.optional(vWorkerUsage),
});

/**
 * What the worker may answer for a `classify_reply` request. This const is the
 * single definition site: `vClassifyReplyResult.classification` and
 * `parseWorkerResult`'s runtime guard both read it, so the two can never
 * drift apart.
 *
 * `not_now` is a purely ADDITIVE widening (P11 / integrator decision D2). A
 * worker that only ever produces the older subset is unaffected, and the enum
 * handed to the model is built by the backend as the request's `outputSchema`
 * — so the value already has a producer path without touching `worker/src`.
 * The role template that makes the model choose it well is P21's.
 */
export const CLASSIFY_REPLY_CLASSIFICATIONS = [
  "interested",
  "not_interested",
  "not_now",
  "out_of_office",
  "unsubscribe",
  "bounce",
  "question",
  "other",
] as const;

export type ClassifyReplyClassification =
  (typeof CLASSIFY_REPLY_CLASSIFICATIONS)[number];

export const vClassifyReplyResult = v.object({
  schemaVersion: v.literal(1),
  operation: v.literal("classify_reply"),
  classification: v.union(
    v.literal("interested"),
    v.literal("not_interested"),
    v.literal("not_now"),
    v.literal("out_of_office"),
    v.literal("unsubscribe"),
    v.literal("bounce"),
    v.literal("question"),
    v.literal("other"),
  ),
  confidence: v.number(),
  rationale: v.string(),
  suggestedNextStep: v.optional(v.string()),
  evidenceRefs: v.optional(v.array(vEvidenceRef)),
  usage: v.optional(vWorkerUsage),
});

/**
 * The PRODUCT-level meaning of a reply, which is what the inbox row, the
 * reply workflow's branch and `plan/tasks.md` P11 §3 all speak in. It is
 * deliberately not the worker's vocabulary: `out_of_office` and `bounce` both
 * mean *machine-generated*, and the product owes them the same treatment —
 * no draft, no takeover, no inference about interest.
 *
 * A model classification is a signal, never an authority: a `unsubscribe`
 * disposition holds the thread for a human, it does not write a suppression
 * row. The deterministic opt-out rule stops a clear unsubscribe without the
 * model (architecture §8 step 6).
 */
export const REPLY_DISPOSITIONS = [
  "interested",
  "question",
  "not_now",
  "not_interested",
  "unsubscribe",
  "automated",
  "needs_review",
] as const;

export const vReplyDisposition = v.union(
  v.literal("interested"),
  v.literal("question"),
  v.literal("not_now"),
  v.literal("not_interested"),
  v.literal("unsubscribe"),
  v.literal("automated"),
  v.literal("needs_review"),
);

export type ReplyDisposition = (typeof REPLY_DISPOSITIONS)[number];

/**
 * The one total mapping from the worker's answer to the product disposition.
 * The switch is exhaustive with no `default`, so adding a ninth
 * classification is a compile error until its row is written here.
 */
export function replyDispositionFromClassification(
  classification: ClassifyReplyClassification,
): ReplyDisposition {
  switch (classification) {
    case "interested":
      return "interested";
    case "question":
      return "question";
    case "not_now":
      return "not_now";
    case "not_interested":
      return "not_interested";
    case "unsubscribe":
      return "unsubscribe";
    case "out_of_office":
    case "bounce":
      return "automated";
    case "other":
      return "needs_review";
  }
}

export const vWorkerResult = v.union(
  vDiscoverResult,
  vResearchResult,
  vContactResult,
  vDraftResult,
  vClassifyReplyResult,
);
export type WorkerResult = Infer<typeof vWorkerResult>;

/**
 * Worker bearer (`osw_`) and lease (`osl_`) tokens must never ride inside
 * model output — a hostile prompt could instruct the model to echo the
 * worker env or `/proc` environ into a result field. Reject the whole
 * result instead of persisting a live credential.
 */
const CREDENTIAL_PATTERN = /\b(?:osw|osl)_[A-Za-z0-9]{24}\b/;

function assertNoCredentialLeak(value: unknown, depth = 0): void {
  if (depth > 16) {
    return;
  }
  if (typeof value === "string") {
    if (CREDENTIAL_PATTERN.test(value)) {
      throw bridgeInvalid("result contains a worker credential pattern");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoCredentialLeak(item, depth + 1);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      assertNoCredentialLeak(item, depth + 1);
    }
  }
}

/**
 * Runtime-check a result envelope AND enforce the documented bounds. The
 * `v.*` validators above pin the shape for schema/`returns`; this parser is
 * what the bridge trusts — worker output is untrusted JSON.
 */
export function parseWorkerResult(
  value: unknown,
  expectedOperation: WorkerOperation,
): WorkerResult {
  const result = asRecord(value, "result");
  assertNoCredentialLeak(result);
  if (result.schemaVersion !== 1) {
    throw bridgeInvalid("result.schemaVersion must be 1");
  }
  if (result.operation !== expectedOperation) {
    throw bridgeInvalid(
      `result.operation ${String(result.operation)} does not match request operation ${expectedOperation}`,
    );
  }
  // `summary` is contract-required for discover/research/contact; the
  // draft/classify_reply contracts don't declare it — requiring it here
  // would reject every conformant result of those operations. When present
  // it's still bounded.
  if (
    expectedOperation === "discover" ||
    expectedOperation === "research" ||
    expectedOperation === "contact"
  ) {
    boundedString(result.summary as string, "result.summary", {
      min: 0,
      max: 1000,
    });
  } else if (result.summary !== undefined) {
    boundedString(result.summary as string, "result.summary", {
      min: 0,
      max: 1000,
    });
  }
  if (result.evidenceRefs !== undefined) {
    const refs = asArray(result.evidenceRefs, "result.evidenceRefs");
    if (refs.length > 10) {
      throw bridgeInvalid("result.evidenceRefs must be at most 10 entries");
    }
    refs.forEach((ref, index) => {
      const r = asRecord(ref, `result.evidenceRefs[${index}]`);
      boundedString(r.label as string, `result.evidenceRefs[${index}].label`, {
        min: 1,
        max: 200,
      });
      for (const key of ["artifactId", "storageId"] as const) {
        if (r[key] !== undefined) {
          boundedString(
            r[key] as string,
            `result.evidenceRefs[${index}].${key}`,
            { min: 1, max: 100 },
          );
        }
      }
    });
  }
  if (result.usage !== undefined) {
    const usage = asRecord(result.usage, "result.usage");
    for (const key of ["toolCalls", "modelCalls", "tokens"] as const) {
      const n = usage[key];
      if (
        n !== undefined &&
        (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)
      ) {
        throw bridgeInvalid(
          `result.usage.${key} must be a non-negative integer`,
        );
      }
    }
  }
  switch (result.operation) {
    case "discover": {
      const candidates = asArray(result.candidates, "result.candidates");
      if (candidates.length > 5) {
        throw bridgeInvalid("discover result allows at most 5 candidates");
      }
      candidates.forEach((candidate, index) => {
        const c = asRecord(candidate, `result.candidates[${index}]`);
        boundedString(c.companyName as string, `candidates[${index}].companyName`, {
          min: 1,
          max: 200,
        });
        boundedString(c.reason as string, `candidates[${index}].reason`, {
          min: 1,
          max: 500,
        });
        for (const key of ["domain", "industry", "size", "source"] as const) {
          if (c[key] !== undefined) {
            boundedString(c[key] as string, `candidates[${index}].${key}`, {
              min: 1,
              max: 200,
            });
          }
        }
      });
      break;
    }
    case "research": {
      if (result.status !== "complete" && result.status !== "pending") {
        throw bridgeInvalid("research.status must be complete|pending");
      }
      const observations = asArray(result.observations, "result.observations");
      if (observations.length > 12) {
        throw bridgeInvalid("research result allows at most 12 observations");
      }
      observations.forEach((observation, index) => {
        const o = asRecord(observation, `result.observations[${index}]`);
        boundedString(o.topic as string, `observations[${index}].topic`, {
          min: 1,
          max: 200,
        });
        boundedString(o.finding as string, `observations[${index}].finding`, {
          min: 1,
          max: 1000,
        });
        if (o.sourceUrl !== undefined) {
          boundedString(o.sourceUrl as string, `observations[${index}].sourceUrl`, {
            min: 1,
            max: 500,
          });
        }
      });
      if (result.artifactIds !== undefined) {
        const ids = asArray(result.artifactIds, "result.artifactIds");
        if (ids.length > 10) {
          throw bridgeInvalid("research result allows at most 10 artifactIds");
        }
        ids.forEach((id, index) =>
          boundedString(id as string, `result.artifactIds[${index}]`, {
            min: 1,
            max: 100,
          }),
        );
      }
      break;
    }
    case "contact": {
      if (
        result.status !== "found" &&
        result.status !== "not_found" &&
        result.status !== "ambiguous"
      ) {
        throw bridgeInvalid("contact.status must be found|not_found|ambiguous");
      }
      const contacts = asArray(result.contacts, "result.contacts");
      if (contacts.length > 5) {
        throw bridgeInvalid("contact result allows at most 5 contacts");
      }
      contacts.forEach((contact, index) => {
        const c = asRecord(contact, `result.contacts[${index}]`);
        boundedString(c.fullName as string, `contacts[${index}].fullName`, {
          min: 1,
          max: 200,
        });
        for (const key of ["role", "email", "source"] as const) {
          if (c[key] !== undefined) {
            boundedString(c[key] as string, `contacts[${index}].${key}`, {
              min: 1,
              max: 200,
            });
          }
        }
        if (
          c.emailConfidence !== undefined &&
          !["high", "medium", "low"].includes(c.emailConfidence as string)
        ) {
          throw bridgeInvalid(
            `contacts[${index}].emailConfidence must be high|medium|low`,
          );
        }
      });
      break;
    }
    case "draft": {
      boundedString(result.subject as string, "result.subject", {
        min: 1,
        max: 200,
      });
      boundedString(result.body as string, "result.body", {
        min: 1,
        max: 12000,
      });
      if (result.tone !== undefined) {
        boundedString(result.tone as string, "result.tone", {
          min: 1,
          max: 100,
        });
      }
      if (result.callToAction !== undefined) {
        boundedString(result.callToAction as string, "result.callToAction", {
          min: 1,
          max: 500,
        });
      }
      break;
    }
    case "classify_reply": {
      if (
        !(CLASSIFY_REPLY_CLASSIFICATIONS as readonly string[]).includes(
          result.classification as string,
        )
      ) {
        throw bridgeInvalid("classify_reply.classification is not recognized");
      }
      if (
        typeof result.confidence !== "number" ||
        !Number.isFinite(result.confidence) ||
        result.confidence < 0 ||
        result.confidence > 1
      ) {
        throw bridgeInvalid("classify_reply.confidence must be 0..1");
      }
      boundedString(result.rationale as string, "result.rationale", {
        min: 1,
        max: 1000,
      });
      if (result.suggestedNextStep !== undefined) {
        boundedString(
          result.suggestedNextStep as string,
          "result.suggestedNextStep",
          { min: 1, max: 500 },
        );
      }
      break;
    }
    default:
      throw bridgeInvalid("result.operation is not a known operation");
  }
  jsonBytes(result, "result", WORKER_RESULT_MAX_BYTES);
  return result as unknown as WorkerResult;
}

/* ---- deterministic digests + token minting ----------------------------- */

/**
 * Deterministic JSON serialization (sorted keys, undefined-elided) shared
 * with the worker — keep `worker/src/contracts.ts`'s copy byte-identical.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** SHA-256 hex digest — WebCrypto (available in Convex mutations/actions). */
export async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Same digest over raw bytes (artifact uploads). */
export async function sha256HexBytes(
  data: Uint8Array,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(data),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** `sha256:<hex>` over the canonical result serialization. */
export async function computeResultDigest(result: unknown): Promise<string> {
  return `sha256:${await sha256Hex(canonicalJson(result))}`;
}

function randomToken(prefix: string): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  // Fixed alphabet keeps tokens URL/header-safe (no +/= edge cases).
  let body = "";
  for (const byte of bytes) {
    body += alphabet[byte % alphabet.length];
  }
  return `${prefix}${body}`;
}

/** `osw_…` — scoped worker bearer token (hashed at rest). */
export function mintWorkerToken(): string {
  return randomToken("osw_");
}

/** `osl_…` — per-claim lease token (hashed at rest). */
export function mintLeaseToken(): string {
  return randomToken("osl_");
}

/** `wrq_…` — bridge poll/result correlation IDs. */
export function mintBridgeRequestId(): string {
  return randomToken("wrq_");
}

/* ---- runtime timing constants ------------------------------------------ */

export const WORKER_LEASE_TTL_MS = 60_000;
export const CONTROL_REQUEST_TTL_MS = 10 * 60_000;
export const LOGIN_CHALLENGE_TTL_MS = 15 * 60_000;
export const WORKER_CREDENTIAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** §4.4: at most one routine activity update per request per 5 s. */
export const WORKER_ACTIVITY_MIN_INTERVAL_MS = 5_000;
/** Minimum interval between bridge polls on one credential (anti-hammer). */
export const BRIDGE_MIN_POLL_INTERVAL_MS = 250;
/** Minimum interval between lease heartbeats for one request. */
export const HEARTBEAT_MIN_INTERVAL_MS = 2_000;
/** A runtime is "live" only with a fresh heartbeat (§6.1 live indicators). */
export const RUNTIME_LIVE_WINDOW_MS = 90_000;

/* ---- lifecycle requestConfig validation --------------------------------- */

/**
 * `requestConfig` holds neutral provisioning settings and secure injection
 * REFERENCES only — a raw credential value here is a contract violation.
 */
export type LifecycleRequestConfig = {
  ttlSeconds: number;
  image?: string;
  /** Env names the provisioning action injects; values come from sealed
   *  credential rows, never from this config. */
  envNames: string[];
  setup?: string;
};

const ALLOWED_CONFIG_KEYS = new Set([
  "ttlSeconds",
  "image",
  "envNames",
  "setup",
]);

export function assertLifecycleRequestConfig(
  value: unknown,
): asserts value is LifecycleRequestConfig {
  const config = asRecord(value, "requestConfig");
  for (const key of Object.keys(config)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      throw invalid(`requestConfig.${key} is not an allowed neutral setting`);
    }
  }
  const ttlSeconds = config.ttlSeconds;
  if (
    typeof ttlSeconds !== "number" ||
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 60 ||
    ttlSeconds > 30 * 24 * 60 * 60
  ) {
    throw invalid("requestConfig.ttlSeconds must be an integer 60s..30d");
  }
  if (config.image !== undefined) {
    boundedString(config.image as string, "requestConfig.image", {
      min: 1,
      max: 200,
    });
  }
  const envNames = asArray(config.envNames, "requestConfig.envNames");
  if (envNames.length > 16) {
    throw invalid("requestConfig.envNames must be at most 16 names");
  }
  envNames.forEach((name, index) => {
    const envName = boundedString(
      name as string,
      `requestConfig.envNames[${index}]`,
      { min: 1, max: 100 },
    );
    if (!/^[A-Z][A-Z0-9_]*$/.test(envName)) {
      throw invalid(`requestConfig.envNames[${index}] is not an env name`);
    }
  });
  if (config.setup !== undefined) {
    boundedString(config.setup as string, "requestConfig.setup", {
      min: 1,
      max: 500,
    });
  }
  jsonBytes(config, "requestConfig", 8 * 1024);
}

/* ---- login challenge admission ------------------------------------------ */

/** Provider-allowlisted hosts for Codex device-code verification URLs. */
const LOGIN_VERIFICATION_HOSTS = new Set([
  "auth.openai.com",
  "chatgpt.com",
  "openai.com",
]);

/** The only user-code shapes Codex device auth emits (e.g. `XXXX-XXXX`). */
const USER_CODE_PATTERN = /^[A-Z0-9]{4,12}(-[A-Z0-9]{4,12}){0,2}$/;

export function assertLoginVerificationUrl(raw: string): string {
  const url = boundedString(raw, "verificationUrl", { min: 8, max: 500 });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw bridgeInvalid("verificationUrl is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw bridgeInvalid("verificationUrl must be https");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    !LOGIN_VERIFICATION_HOSTS.has(host) &&
    ![...LOGIN_VERIFICATION_HOSTS].some((allowed) =>
      host.endsWith(`.${allowed}`),
    )
  ) {
    throw bridgeInvalid(
      `verificationUrl host ${host} is not on the provider allowlist`,
    );
  }
  return parsed.toString();
}

export function assertLoginUserCode(raw: string): string {
  const code = boundedString(raw, "userCode", { min: 4, max: 32 });
  if (!USER_CODE_PATTERN.test(code)) {
    throw bridgeInvalid("userCode has an unexpected shape");
  }
  return code;
}

/** Allowlisted worker→activity event kinds (runtime-origin only). */
export const WORKER_ACTIVITY_KINDS = ["worker_progress"] as const;
export type WorkerActivityKind = (typeof WORKER_ACTIVITY_KINDS)[number];

/**
 * Durable completion payload delivered to the awaiting workflow when a
 * worker request reaches a terminal/uncertain state. Like
 * `vDecisionContinuation`, the workflow treats it as a hint — the
 * continuation step re-reads the workerRequest row before applying.
 */
export const vWorkerRequestCompletion = v.object({
  workerRequestId: v.id("workerRequests"),
  missionId: v.id("missions"),
  runId: v.id("runs"),
  /** Attempt generation of the completed request. */
  generation: v.number(),
  /** Mission workflowGeneration the request was dispatched under. */
  workflowGeneration: v.number(),
  outcome: v.union(
    v.literal("succeeded"),
    v.literal("failed"),
    v.literal("cancelled"),
    v.literal("uncertain"),
  ),
  /** Bounded failure/reason detail for non-success outcomes. */
  detail: v.optional(v.string()),
});
export type WorkerRequestCompletion = Infer<typeof vWorkerRequestCompletion>;

/* ------------------------------------------------------------------ */
/* Correspondence, sending and usage (P10 — architecture §4.3/§4.4/§8)  */
/* ------------------------------------------------------------------ */

/**
 * Activity kinds produced by the P10 correspondence/send modules. `kind` is a
 * bounded string in storage; producers keep to this list so P11/P13 can
 * formalize them later without a data migration.
 */
export const ACTIVITY_KINDS_P10 = [
  "draft_created",
  "draft_revised",
  "approval_recorded",
  "send_attempt_reserved",
  "send_attempt_dispatched",
  "send_attempt_acknowledged",
  "send_attempt_failed",
  "send_attempt_uncertain",
  "send_attempt_cancelled",
  "send_attempt_reconciled",
  "suppression_added",
  "suppression_removed",
  "delivery_receipt_applied",
  "delivery_receipt_parked",
  "conversation_thread_link_missed",
] as const;

export type ActivityKindP10 = (typeof ACTIVITY_KINDS_P10)[number];

/**
 * Activity kinds produced by the P11 inbound/reply modules. Same rule as the
 * P10 list: `kind` is a bounded string in storage and producers keep to this
 * list, which is the single definition site.
 *
 * A conversation with no mission can hold NO activity row at all
 * (`activityEventFields.missionId` is a required `v.id("missions")`), so these
 * kinds appear only once a reply mission exists. Conversation lifecycle facts
 * that happen without a mission — unassigned intake, takeover, association,
 * closure — are recorded on the conversation row and in `conversationNotes`
 * instead.
 */
export const ACTIVITY_KINDS_P11 = ["reply_classified"] as const;

export type ActivityKindP11 = (typeof ACTIVITY_KINDS_P11)[number];

/* ----- conversation/draft/approval/send-attempt state unions -------- */

export const vConversationState = v.union(
  v.literal("open"),
  v.literal("closed"),
  v.literal("unassigned"),
);

export type ConversationState = "open" | "closed" | "unassigned";

/**
 * Why automation is frozen on a conversation (`conversations.takeoverReason`).
 *
 * `humanTakeover` alone cannot tell an operator's deliberate hold from one the
 * system placed, and V16/V17 need that distinction *before* offering Resume —
 * an unassigned thread has no mission, so it can carry no activity row to
 * explain itself (see `ACTIVITY_KINDS_P11`). The reason therefore lives on the
 * conversation row.
 *
 * - `unassigned_inbound` — verified mail on a known inbox matched no thread.
 * - `operator` — a human pressed Take over.
 * - `ambiguous_opt_out` — the reply may be an opt-out; a human decides.
 * - `awaiting_resume` — a lead was associated, or a closed thread reopened;
 *   automation stays frozen until `conversations.resume` re-runs the policy.
 * - `needs_review` — classification could not be trusted.
 */
export const TAKEOVER_REASONS = [
  "unassigned_inbound",
  "operator",
  "ambiguous_opt_out",
  "awaiting_resume",
  "needs_review",
] as const;

export const vTakeoverReason = v.union(
  v.literal("unassigned_inbound"),
  v.literal("operator"),
  v.literal("ambiguous_opt_out"),
  v.literal("awaiting_resume"),
  v.literal("needs_review"),
);

export type TakeoverReason = (typeof TAKEOVER_REASONS)[number];

/**
 * `conversationNotes.kind`. `note` is a human annotation; `system` is a
 * lifecycle record the backend wrote. Neither can ever resolve a business
 * approval — the same invariant `activity.ts` states for `missionComments`.
 */
export const CONVERSATION_NOTE_KINDS = ["note", "system"] as const;

export const vConversationNoteKind = v.union(
  v.literal("note"),
  v.literal("system"),
);

export type ConversationNoteKind = (typeof CONVERSATION_NOTE_KINDS)[number];

/**
 * The inbox tabs `plan/ux.md` §48 puts in the URL. Each one is a single exact
 * index range on `conversations`; there is no post-filtered tab, because a
 * post-filtered truncated page is not a filtered result (architecture §5).
 */
export const CONVERSATION_TABS = [
  "open",
  "unassigned",
  "takeover",
  "closed",
] as const;

export const vConversationTab = v.union(
  v.literal("open"),
  v.literal("unassigned"),
  v.literal("takeover"),
  v.literal("closed"),
);

export type ConversationTab = (typeof CONVERSATION_TABS)[number];

/** Bound on one `conversationNotes.body`. */
export const CONVERSATION_NOTE_BODY_MAX_LENGTH = 4_000;

/**
 * How much inbound text the deterministic opt-out rule scans. The scan runs on
 * the reply's own text, never on the quoted history — a reply that quotes our
 * own footer must not suppress the recipient we just mailed.
 */
export const INBOUND_BODY_SCAN_MAX_LENGTH = 4_000;

/**
 * How much inbound text may ride into a worker request as labelled untrusted
 * context. Email bodies are the prompt-injection vector: they are data, never
 * instruction, and they are never concatenated into the instruction itself.
 */
export const INBOUND_BODY_CONTEXT_MAX_LENGTH = 8_000;

/**
 * How much of a message body a thread view returns. Plain text only — `html`
 * is never projected, which removes raw-HTML injection and remote
 * tracking-image loads at the source rather than at the renderer.
 */
export const THREAD_BODY_MAX_LENGTH = 20_000;

/** Provider endpoint an attempt targets (integrations.md §G3 step 5). */
export const vEndpointOperation = v.union(
  v.literal("send"),
  v.literal("reply"),
);

export type EndpointOperation = "send" | "reply";

/**
 * §4.3 `sendAttempts.state`. `acknowledged` means the provider accepted the
 * message ("Sent") — never "Delivered"; delivery facts arrive only through
 * verified provider events.
 */
export const vSendAttemptState = v.union(
  v.literal("reserved"),
  v.literal("requesting"),
  v.literal("acknowledged"),
  v.literal("uncertain"),
  v.literal("definitively_failed"),
  v.literal("cancelled"),
);

export type SendAttemptState =
  | "reserved"
  | "requesting"
  | "acknowledged"
  | "uncertain"
  | "definitively_failed"
  | "cancelled";

/**
 * Attempt states that block ANY new send on the conversation across all
 * draft revisions (§8.3). `reserved`/`requesting` can never be covered by a
 * replacement decision; `uncertain` is coverable only through the recorded
 * delivery_uncertain decision exception (§8.7).
 */
export const UNRESOLVED_ATTEMPT_STATES: readonly SendAttemptState[] = [
  "reserved",
  "requesting",
  "uncertain",
];

/** The immutable content verdict recorded on an `approvals` row. */
export const vApprovalVerdict = v.union(
  v.literal("approved"),
  v.literal("rejected"),
);

export type ApprovalVerdict = "approved" | "rejected";

/**
 * How a `draft_approval` decision was resolved — carried on the decision
 * answer's `fields.draftResolution` so the waiting workflow can tell a
 * redraft request from a deliberate rejection. `approved` is the only value
 * that produces an `approved` approvals row.
 */
export const DRAFT_RESOLUTIONS = [
  "approved",
  "changes_requested",
  "rejected",
] as const;

export type DraftResolution = (typeof DRAFT_RESOLUTIONS)[number];

/* ----- suppressions -------------------------------------------------- */

export const vSuppressionKind = v.union(
  v.literal("email"),
  v.literal("domain"),
);

export type SuppressionKind = "email" | "domain";

export const vSuppressionReason = v.union(
  v.literal("unsubscribe"),
  v.literal("manual"),
  v.literal("bounce"),
  v.literal("provider"),
);

export type SuppressionReason = "unsubscribe" | "manual" | "bounce" | "provider";

/* ----- email normalization ------------------------------------------- */

export const EMAIL_ADDRESS_MAX_LENGTH = 320;
export const EMAIL_LOCAL_PART = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
export const EMAIL_DOMAIN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Canonical recipient identity for approvals, suppressions and payload
 * hashing: trimmed, ASCII-lowercased `local@domain`, one `@`, a dot-ful
 * domain. Normalization is deliberately small and deterministic — no plus
 * stripping or provider-specific rewriting, so the address sent is the
 * address approved.
 */
export function normalizeEmailAddress(
  value: string,
  field = "recipient",
): string {
  const trimmed = boundedString(value, field, {
    min: 3,
    max: EMAIL_ADDRESS_MAX_LENGTH,
  }).toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at !== trimmed.indexOf("@") || at === trimmed.length - 1) {
    throw invalid(`${field} must be a single email address`);
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!EMAIL_LOCAL_PART.test(local)) {
    throw invalid(`${field} has an invalid local part`);
  }
  if (!EMAIL_DOMAIN.test(domain)) {
    throw invalid(`${field} has an invalid domain`);
  }
  return `${local}@${domain}`;
}

/**
 * Normalize a bare domain for `kind: "domain"` suppressions: trims a leading
 * `@` or `mailto:`-style noise, lowercases, requires at least one dot so a
 * bare TLD/host label can never suppress an entire suffix.
 */
export function normalizeDomain(value: string, field = "domain"): string {
  const trimmed = boundedString(value, field, { min: 1, max: 253 })
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\.+$/, "");
  if (!EMAIL_DOMAIN.test(trimmed)) {
    throw invalid(`${field} must be a valid dotted domain`);
  }
  return trimmed;
}

/** The domain part of an already-normalized email address. */
export function domainOfNormalizedEmail(normalizedEmail: string): string {
  return normalizedEmail.slice(normalizedEmail.lastIndexOf("@") + 1);
}

/* ----- deterministic opt-out detection -------------------------------- */

/**
 * How strongly an inbound message asks to be left alone (architecture §8
 * step 6: "evaluate an explicit deterministic opt-out rule before any new
 * send; ambiguous opt-out intent pauses outreach for review. Do not wait for
 * an optional model classification to stop a clear unsubscribe.").
 *
 * Three values, and the middle one is the point of the whole design:
 *
 * - `explicit` — an unambiguous opt-out sentence. Suppresses immediately,
 *   without waiting for any model.
 * - `ambiguous` — the words are there but the request is not. Automation
 *   STOPS and a human decides. It writes NO suppression row:
 *   `vSuppressionReason` is a closed union of `unsubscribe | manual | bounce
 *   | provider` and there is deliberately no "something guessed so".
 * - `none` — no opt-out language at all.
 *
 * This is a rule over text, never a classifier. It runs on the reply's own
 * words and it errs toward `ambiguous`, because an `explicit` false positive
 * silently ends a real conversation while an `ambiguous` false positive only
 * asks a human to look.
 */
export const OPT_OUT_SIGNALS = ["none", "ambiguous", "explicit"] as const;

export const vOptOutSignal = v.union(
  v.literal("none"),
  v.literal("ambiguous"),
  v.literal("explicit"),
);

export type OptOutSignal = (typeof OPT_OUT_SIGNALS)[number];

/** Rank so the strongest signal across subject and body wins. */
const OPT_OUT_RANK: Record<OptOutSignal, number> = {
  none: 0,
  ambiguous: 1,
  explicit: 2,
};

/**
 * Cut an inbound body down to the reply's OWN words, dropping quoted history
 * and the sender's signature block.
 *
 * Without this, every reply that quotes our outbound footer would read as an
 * unsubscribe request and suppress the recipient we had just mailed — the
 * scan would be matching our own text. Cutting at the signature delimiter
 * matters for the same reason in the other direction: a corporate auto-footer
 * is boilerplate, not a request.
 *
 * Deliberately conservative. Cutting too early can only WEAKEN a signal, and a
 * weakened signal means a human looks at the message.
 */
export function stripQuotedReply(text: string): string {
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (
      // A quoted line, in every client that marks them.
      trimmed.startsWith(">") ||
      // RFC 3676 signature delimiter.
      trimmed === "--" ||
      // "On <date>, <someone> wrote:" — the attribution above a quote.
      /\bwrote:\s*$/i.test(trimmed) ||
      /^-{2,}\s*original message\s*-{2,}$/i.test(trimmed) ||
      /^-{3,}\s*forwarded message\s*-{3,}$/i.test(trimmed) ||
      // Outlook's horizontal rule above the quoted header block.
      /^_{10,}$/.test(trimmed)
    ) {
      break;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

/** Lowercase, collapse whitespace, fold smart quotes — nothing else. */
function normalizeScanText(value: string): string {
  return value
    .slice(0, INBOUND_BODY_SCAN_MAX_LENGTH)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** The whole message, once trailing punctuation is discounted. */
function bareText(scan: string): string {
  return scan.replace(/[.!?,;:\s]+$/, "");
}

type OptOutRule = { rule: string; matches: (scan: string) => boolean };

/**
 * Unambiguous opt-out sentences. Each one is a request addressed to us; none
 * of them can be satisfied by a passing mention of the word.
 *
 * `opt out` on its own is NOT here — "we decided to opt out of the
 * conference" is a normal sentence — so it ranks ambiguous instead.
 */
const EXPLICIT_OPT_OUT_RULES: readonly OptOutRule[] = [
  { rule: "unsubscribe_me", matches: (s) => s.includes("unsubscribe me") },
  {
    rule: "please_unsubscribe",
    matches: (s) => s.includes("please unsubscribe"),
  },
  { rule: "unsubscribe_bare", matches: (s) => bareText(s) === "unsubscribe" },
  {
    rule: "remove_from_list",
    matches: (s) =>
      /\bremove (?:me|us) from (?:your|this|the|our)[a-z ]{0,24}\blist\b/.test(s),
  },
  {
    rule: "take_off_list",
    matches: (s) =>
      /\btake (?:me|us) off (?:of )?(?:your|this|the|our)[a-z ]{0,24}\blist\b/.test(
        s,
      ),
  },
  {
    rule: "stop_emailing",
    matches: (s) =>
      /\bstop (?:emailing|e-mailing|contacting|messaging) (?:me|us)\b/.test(s) ||
      /\bstop sending (?:me|us)\b/.test(s),
  },
  {
    rule: "do_not_contact",
    matches: (s) =>
      /\b(?:do not|don't|dont) (?:contact|email|e-mail|message) (?:me|us)\b/.test(
        s,
      ),
  },
  { rule: "opt_me_out", matches: (s) => /\bopt (?:me|us) out\b/.test(s) },
];

/**
 * Language that MIGHT be an opt-out. Every one of these stops automation and
 * asks a human; none of them writes a suppression row.
 *
 * `not interested` and `no thanks` are deliberately absent. They are
 * classifications, not opt-outs — freezing them here would take the reply away
 * from the classifier that exists to handle them.
 */
const AMBIGUOUS_OPT_OUT_RULES: readonly OptOutRule[] = [
  { rule: "mentions_unsubscribe", matches: (s) => s.includes("unsubscribe") },
  { rule: "opt_out_phrase", matches: (s) => /\bopt(?:ing|ed)? out\b/.test(s) },
  { rule: "remove_me", matches: (s) => /\bremove (?:me|us)\b/.test(s) },
  { rule: "take_me_off", matches: (s) => /\btake (?:me|us) off\b/.test(s) },
  { rule: "bare_stop", matches: (s) => bareText(s) === "stop" },
];

function scanOptOut(scan: string): { signal: OptOutSignal; rule?: string } {
  if (scan.length === 0) {
    return { signal: "none" };
  }
  for (const candidate of EXPLICIT_OPT_OUT_RULES) {
    if (candidate.matches(scan)) {
      return { signal: "explicit", rule: candidate.rule };
    }
  }
  for (const candidate of AMBIGUOUS_OPT_OUT_RULES) {
    if (candidate.matches(scan)) {
      return { signal: "ambiguous", rule: candidate.rule };
    }
  }
  return { signal: "none" };
}

/**
 * The deterministic opt-out rule, run over an inbound message's own text.
 *
 * Body text is `extracted_text` when AgentMail supplied it (its own
 * reply extraction) and `stripQuotedReply(text)` otherwise. `html` is never
 * scanned — markup would let the same words hide behind tags.
 *
 * An inbound `List-Unsubscribe` header is NOT consulted, here or anywhere: it
 * is the sender's own footer advertising how to leave THEIR list, not a
 * request addressed to us. Nothing in the return value is derived from a
 * header.
 *
 * The result travels onward as an enum plus the name of the rule that fired —
 * never a slice of the message. The operator reads the message itself in the
 * thread view; a second copy of it in an app table is what §4.3 rules out.
 */
export function evaluateOptOutText(args: {
  subject?: unknown;
  text?: unknown;
  extractedText?: unknown;
}): { signal: OptOutSignal; rule?: string } {
  const body =
    typeof args.extractedText === "string" && args.extractedText.length > 0
      ? args.extractedText
      : typeof args.text === "string"
        ? stripQuotedReply(args.text)
        : "";
  const scans = [
    typeof args.subject === "string" ? normalizeScanText(args.subject) : "",
    normalizeScanText(body),
  ];
  let best: { signal: OptOutSignal; rule?: string } = { signal: "none" };
  for (const scan of scans) {
    const found = scanOptOut(scan);
    if (OPT_OUT_RANK[found.signal] > OPT_OUT_RANK[best.signal]) {
      best = found;
    }
  }
  return best;
}

/** Longest inbound `From` header this will even look at. */
export const INBOUND_SENDER_MAX_LENGTH = 1_000;

/**
 * Read a single normalized address out of an inbound `From` header, or
 * nothing.
 *
 * The header is written by whoever sent the mail, so this is a parser for
 * untrusted data and never an identity check. Two properties matter:
 *
 * - it NEVER throws, unlike `normalizeEmailAddress`. The inbound callbacks it
 *   feeds cannot survive a throw (Workpool does not retry mutations), so a
 *   malformed header must degrade to "unknown sender", not lose the event;
 * - it REFUSES rather than guesses. A header listing several addresses, or one
 *   whose address does not normalize, yields `undefined`. Downstream that is a
 *   refusal — `conversations.resume` blocks on `sender_unverified` — so
 *   refusing is always the safe answer.
 *
 * The result is stored as data. It never selects a workspace or conversation
 * and never becomes a send recipient; at most it must MATCH an address the
 * application already resolved, and a mismatch blocks.
 */
export function parseInboundSender(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > INBOUND_SENDER_MAX_LENGTH) {
    return undefined;
  }
  // `Display Name <a@b.com>` — take the angle-bracket address when the header
  // carries exactly one, else the whole trimmed header.
  const angles = trimmed.match(/<[^<>]*>/g);
  if (angles !== null && angles.length > 1) {
    return undefined;
  }
  const candidate = (
    angles === null ? trimmed : angles[0].slice(1, -1)
  ).trim();
  try {
    return normalizeEmailAddress(candidate, "sender");
  } catch {
    return undefined;
  }
}

/* ----- draft payload hashing ------------------------------------------ */

export const DRAFT_SUBJECT_MAX_LENGTH = 200;
export const DRAFT_BODY_MAX_LENGTH = 12_000;
export const DRAFT_EVIDENCE_MAX_ITEMS = 25;
export const DRAFT_EVIDENCE_ID_MAX_LENGTH = 128;
export const PROVIDER_REF_MAX_LENGTH = 400;

/**
 * The exact fields a send commits to (§8 "Exact draft approval"): sender
 * inbox, normalized recipient, subject, body, the reply parent and which
 * provider endpoint carries it. Evidence links and context versions are
 * approval inputs, not send payload — they live on the draft row and on the
 * approvals record instead of inside the hash.
 */
export type DraftPayloadFingerprint = {
  endpointOperation: EndpointOperation;
  inboxRef: string;
  normalizedRecipient: string;
  subject: string;
  body: string;
  replyToMessageRef: string | null;
};

/** SHA-256 hex of the canonical fingerprint — the stored `payloadHash`. */
export async function computePayloadHash(
  payload: DraftPayloadFingerprint,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(payload)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/* ----- usage accounting ------------------------------------------------ */

export const vUsageMetric = v.union(
  v.literal("sends"),
  v.literal("apollo_enrichments"),
  v.literal("model_runs"),
  v.literal("research_pages"),
  v.literal("research_searches"),
);

export type UsageMetric =
  | "sends"
  | "apollo_enrichments"
  | "model_runs"
  | "research_pages"
  | "research_searches";

export const vUsageReservationState = v.union(
  v.literal("reserved"),
  v.literal("committed"),
  v.literal("released"),
  v.literal("uncertain"),
);

export type UsageReservationState =
  | "reserved"
  | "committed"
  | "released"
  | "uncertain";

/* ----- provider event receipts ------------------------------------------ */

export const vEmailEventHandlingState = v.union(
  v.literal("pending"),
  v.literal("handled"),
  v.literal("failed"),
);

export type EmailEventHandlingState = "pending" | "handled" | "failed";

/**
 * Which half of the mail path a receipt belongs to.
 *
 * It exists so the inbound drain can RANGE over inbound rows rather than
 * filter a fixed page after taking it. The two halves reach a terminal
 * `handlingState` by completely different routes — an inbound row through
 * `inbox.applyInboundMessage`, an outbound one only once a send attempt
 * carries its `providerMessageRef` — so an outbound receipt that never
 * matches an attempt stays `pending` forever. Scanning `handlingState` alone,
 * oldest first, therefore hands the inbound sweep a page made entirely of
 * those rows, and the recovery path for a lost inbound callback stops running
 * with no error to say so.
 */
export const vEmailEventDirection = v.union(
  v.literal("inbound"),
  v.literal("outbound"),
);

export type EmailEventDirection = "inbound" | "outbound";

/** Prefix of every inbound application key. */
export const INBOUND_APPLICATION_KEY_PREFIX = "incoming:";

/**
 * Derive a receipt's direction from its application key — TOTAL, and
 * deliberately biased to `outbound` for anything that is not recognisably an
 * inbound key, because `outbound` is the half the inbound drain never feeds
 * to `applyInboundMessage`.
 */
export function directionForApplicationKey(
  applicationKey: string,
): EmailEventDirection {
  return applicationKey.startsWith(INBOUND_APPLICATION_KEY_PREFIX)
    ? "inbound"
    : "outbound";
}

/**
 * Application handling key for inbound messages
 * (`incoming:<inbox>:<message>`) — a second provider event ID for the same
 * message can never start a second reply mission (§4.3 note). Outbound
 * delivery events use `outbound:<messageRef>:<eventType>` instead.
 */
export function inboundApplicationKey(inboxRef: string, messageRef: string) {
  return `${INBOUND_APPLICATION_KEY_PREFIX}${inboxRef}:${messageRef}`;
}

export function outboundApplicationKey(
  messageRef: string,
  eventType: string,
) {
  return `outbound:${messageRef}:${eventType}`;
}

/** `missions.create` bounds `requestId` to 100; reply missions match it. */
export const MISSION_REQUEST_ID_MAX_LENGTH = 100;

/**
 * The reply mission's dedupe key for ONE inbound message — the second gate
 * on the same stable identity the receipt's `applicationKey` already uses.
 *
 * The receipt key stops a second event ID for one message from advancing the
 * conversation twice; this one stops a second *caller* — ingest and an
 * operator's `conversations.resume` both reach the same message — from
 * starting a second reply mission for it.
 *
 * `missions.requestId` is a 100-character key and a provider inbox plus a
 * Message-ID can exceed that, so an over-long natural key degrades to a
 * digest of the SAME string. Both forms are deterministic per message and
 * their prefixes differ, so one message always maps to exactly one key.
 */
export async function replyMissionRequestId(
  inboxRef: string,
  messageRef: string,
): Promise<string> {
  const natural = inboundApplicationKey(inboxRef, messageRef);
  if (natural.length <= MISSION_REQUEST_ID_MAX_LENGTH) {
    return natural;
  }
  return `incoming#${(await sha256Hex(natural)).slice(0, 48)}`;
}

/* ----- structured-output schemas handed to the model -------------------- */

/**
 * The JSON Schema for a `classify_reply` turn, built from
 * `CLASSIFY_REPLY_CLASSIFICATIONS` so the enum the model is given and the
 * enum `parseWorkerResult` accepts can never disagree. This is the producer
 * path integrator decision D2 relies on: widening the const widens the
 * schema handed to Codex with no `worker/src` change, because the worker
 * relays `input.outputSchema` verbatim.
 *
 * P21 owns the role template that makes the model *choose well*; this owns
 * only what it is allowed to say.
 */
export function classifyReplyOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "operation",
      "classification",
      "confidence",
      "rationale",
    ],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      operation: { type: "string", enum: ["classify_reply"] },
      classification: {
        type: "string",
        enum: [...CLASSIFY_REPLY_CLASSIFICATIONS],
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      rationale: { type: "string", maxLength: 1000 },
      suggestedNextStep: { type: "string", maxLength: 500 },
    },
  };
}

/**
 * The JSON Schema for a `draft` turn. It deliberately has NO recipient
 * field: the address a draft is written to is resolved by the application
 * (`conversations.resolveOutboundRecipient`) and never by the model, so
 * there is nothing for a hostile inbound body to redirect.
 */
export function draftOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "operation", "subject", "body"],
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      operation: { type: "string", enum: ["draft"] },
      subject: { type: "string", maxLength: DRAFT_SUBJECT_MAX_LENGTH },
      body: { type: "string", maxLength: DRAFT_BODY_MAX_LENGTH },
      tone: { type: "string", maxLength: 100 },
      callToAction: { type: "string", maxLength: 500 },
    },
  };
}

/* ----- send window / local-day helpers (IANA timezone) ------------------ */

/**
 * Local wall-clock parts of `atMs` in `timezone`, read through `Intl`.
 * `weekday` is the civil weekday (0 = Sunday … 6 = Saturday); `minuteOfDay`
 * is minutes after local midnight.
 */
export function localDayParts(
  atMs: number,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minuteOfDay: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(atMs));
  const read = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = (
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
  ).indexOf(read("weekday") as "Sun");
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));
  const result = {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    weekday,
    minuteOfDay: hour * 60 + minute,
  };
  if (
    weekday < 0 ||
    !Number.isFinite(result.year) ||
    !Number.isFinite(result.month) ||
    !Number.isFinite(result.day) ||
    !Number.isFinite(result.minuteOfDay)
  ) {
    throw invalid(`timezone ${timezone} produced unreadable local time`);
  }
  return result;
}

/** `YYYY-MM-DD` local date of `atMs` in `timezone` — the sends period key. */
export function localDayKey(atMs: number, timezone: string): string {
  const parts = localDayParts(atMs, timezone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * Best-effort UTC instant for a civil local date + minute-of-day in
 * `timezone`, without a timezone database library: guess the civil time as
 * UTC, measure the zone's offset at the guess and correct. Converges in two
 * or three iterations; across a DST "gap" (a local time that never occurs)
 * it lands on a boundary instant — acceptable for a wait-until hint because
 * the send window is re-validated before dispatch.
 */
export function localCivilToUtc(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timezone: string,
): number {
  const desired =
    Date.UTC(year, month - 1, day) + minuteOfDay * 60_000;
  let guess = desired;
  for (let i = 0; i < 4; i++) {
    const actual = localDayParts(guess, timezone);
    const actualMs =
      Date.UTC(actual.year, actual.month - 1, actual.day) +
      actual.minuteOfDay * 60_000;
    const diff = desired - actualMs;
    if (diff === 0) {
      break;
    }
    guess += diff;
  }
  return guess;
}

export type SendWindowStatus =
  | { permitted: true; localDayKey: string }
  | { permitted: false; localDayKey: string; nextPermittedAt: number };

/**
 * Evaluate the workspace's IANA send window at `atMs`. When outside the
 * window, returns the next UTC instant the window opens (§8.2 — the caller
 * waits durably, then re-runs the whole preflight).
 */
export function sendWindowStatus(
  workspace: {
    timezone: string;
    sendWindow: { weekdays: number[]; startMinute: number; endMinute: number };
  },
  atMs: number,
): SendWindowStatus {
  const { timezone, sendWindow } = workspace;
  const todayKey = localDayKey(atMs, timezone);
  const now = localDayParts(atMs, timezone);
  const withinToday =
    sendWindow.weekdays.includes(now.weekday) &&
    now.minuteOfDay >= sendWindow.startMinute &&
    now.minuteOfDay < sendWindow.endMinute;
  if (withinToday) {
    return { permitted: true, localDayKey: todayKey };
  }
  // Scan civil days forward from "today" in the workspace timezone. Weekday
  // is a property of the civil date, so it is timezone-independent.
  for (let offset = 0; offset <= 8; offset++) {
    const civil = new Date(
      Date.UTC(now.year, now.month - 1, now.day + offset),
    );
    const year = civil.getUTCFullYear();
    const month = civil.getUTCMonth() + 1;
    const day = civil.getUTCDate();
    const weekday = civil.getUTCDay();
    if (!sendWindow.weekdays.includes(weekday)) {
      continue;
    }
    const startUtc = localCivilToUtc(
      year,
      month,
      day,
      sendWindow.startMinute,
      timezone,
    );
    const endUtc = localCivilToUtc(
      year,
      month,
      day,
      sendWindow.endMinute,
      timezone,
    );
    if (offset === 0 && atMs >= endUtc) {
      continue; // today's window already closed
    }
    if (atMs < startUtc) {
      return {
        permitted: false,
        localDayKey: todayKey,
        nextPermittedAt: startUtc,
      };
    }
    // offset === 0 && within was handled above; offset > 0 always opens in
    // the future.
    if (offset > 0) {
      return {
        permitted: false,
        localDayKey: todayKey,
        nextPermittedAt: startUtc,
      };
    }
  }
  // weekdays is validated non-empty (1–7 entries), so a permitted day always
  // exists within eight days; reaching this means the window opens on a
  // further day — report the same instant bounded at +8 days for safety.
  const civil = new Date(Date.UTC(now.year, now.month - 1, now.day + 8));
  return {
    permitted: false,
    localDayKey: todayKey,
    nextPermittedAt: localCivilToUtc(
      civil.getUTCFullYear(),
      civil.getUTCMonth() + 1,
      civil.getUTCDate(),
      sendWindow.startMinute,
      timezone,
    ),
  };
}

/* ----- delivery-uncertain replacement answer (§8.7) --------------------- */

/**
 * Field keys a resolved `delivery_uncertain` decision's `answer.fields` must
 * carry to authorize ONE replacement attempt covering a still-`uncertain`
 * send. `body` holds the human-readable reason; `resolvedBy`/`resolvedAt` on
 * the decision supply actor/time.
 */
export const REPLACEMENT_ANSWER_FIELDS = {
  unresolvedAttemptId: "unresolvedAttemptId",
  replacementDraftId: "replacementDraftId",
  replacementPayloadHash: "replacementPayloadHash",
  contextVersion: "contextVersion",
  acknowledgement: "acknowledgement",
  reason: "reason",
} as const;

/** The only acknowledgement string that satisfies §8.7. */
export const REPLACEMENT_ACKNOWLEDGEMENT = "duplicate_delivery_accepted";

export type ReplacementAnswer = {
  unresolvedAttemptId: string;
  replacementDraftId: string;
  replacementPayloadHash: string;
  contextVersion: number;
  reason: string;
};

/**
 * Extract and validate the §8.7 replacement binding from a resolved
 * `delivery_uncertain` decision's answer. Throws `INVALID` naming the exact
 * missing/wrong field — a generic or stale approval can never stand in for
 * this record.
 */
export function readReplacementAnswer(
  answer: DecisionAnswer | undefined,
): ReplacementAnswer {
  const fields = answer?.fields;
  if (fields === undefined) {
    throw invalid(
      "replacement decision answer must carry fields binding the uncertain attempt and the replacement draft",
    );
  }
  const F = REPLACEMENT_ANSWER_FIELDS;
  const unresolvedAttemptId = boundedString(
    fields[F.unresolvedAttemptId] ?? "",
    `answer.fields.${F.unresolvedAttemptId}`,
    { min: 1, max: 100 },
  );
  const replacementDraftId = boundedString(
    fields[F.replacementDraftId] ?? "",
    `answer.fields.${F.replacementDraftId}`,
    { min: 1, max: 100 },
  );
  const replacementPayloadHash = boundedString(
    fields[F.replacementPayloadHash] ?? "",
    `answer.fields.${F.replacementPayloadHash}`,
    { min: 1, max: 128 },
  );
  const contextVersionRaw = fields[F.contextVersion] ?? "";
  const contextVersion = Number(contextVersionRaw);
  if (!Number.isInteger(contextVersion) || contextVersion < 0) {
    throw invalid(
      `answer.fields.${F.contextVersion} must be the recorded context version`,
    );
  }
  const acknowledgement = fields[F.acknowledgement] ?? "";
  if (acknowledgement !== REPLACEMENT_ACKNOWLEDGEMENT) {
    throw invalid(
      `answer.fields.${F.acknowledgement} must be "${REPLACEMENT_ACKNOWLEDGEMENT}" — the reviewer must acknowledge possible duplicate delivery`,
    );
  }
  const reason = boundedString(fields[F.reason] ?? "", `answer.fields.${F.reason}`, {
    min: 1,
    max: 500,
  });
  return {
    unresolvedAttemptId,
    replacementDraftId,
    replacementPayloadHash,
    contextVersion,
    reason,
  };
}

/* ------------------------------------------------------------------ */
/* Leads, bookings and evidence (P20 — §4.3/§4.5/§8 CRM and booking)   */
/*                                                                     */
/* Contract only: these validators and bounds are the single           */
/* definition P09, P11, P19 and P21 import. Widening a union here is a  */
/* deliberate edit at one site — none of those cards may re-declare a   */
/* parallel vocabulary.                                                */
/* ------------------------------------------------------------------ */

/**
 * The ordered sales pipeline (§4.3). Order is load-bearing twice: a later
 * scrape may never move a lead backwards, and cancelling a booking falls back
 * to "the last supported earlier stage". `won`/`lost` close the pipeline and
 * are never inferred from mail acceptance or a booked meeting.
 */
export const SALES_STAGES = [
  "discovered",
  "researched",
  "qualified",
  "contact_needed",
  "draft_ready",
  "contacted",
  "replied",
  "booking_proposed",
  "booked",
  "won",
  "lost",
] as const;

export const vSalesStage = v.union(
  v.literal("discovered"),
  v.literal("researched"),
  v.literal("qualified"),
  v.literal("contact_needed"),
  v.literal("draft_ready"),
  v.literal("contacted"),
  v.literal("replied"),
  v.literal("booking_proposed"),
  v.literal("booked"),
  v.literal("won"),
  v.literal("lost"),
);

export type SalesStage = (typeof SALES_STAGES)[number];

/** Closed outcomes — an automatic transition never leaves or enters these. */
export const TERMINAL_SALES_STAGES: readonly SalesStage[] = ["won", "lost"];

/** Position in `SALES_STAGES`; the basis for the no-regression comparison. */
export function salesStageRank(stage: SalesStage): number {
  return SALES_STAGES.indexOf(stage);
}

/**
 * Qualification is orthogonal to `salesStage` and to contact availability: a
 * missing email must not erase fit evidence, and a qualified lead with no
 * address is `contact_needed`, not `rejected` (§4.3).
 */
export const vQualification = v.union(
  v.literal("pending"),
  v.literal("qualified"),
  v.literal("rejected"),
  v.literal("needs_review"),
);

export type Qualification =
  | "pending"
  | "qualified"
  | "rejected"
  | "needs_review";

/**
 * Provenance origin of a source reference or contact — the §4.1 source-plan
 * vocabulary, because a prospect exists only because a confirmed source
 * produced it (§4.5 `discover`: selected/confirmed sources only). Manual
 * operator entry would be a deliberate widening here.
 */
export const vProspectSource = v.union(
  v.literal("apollo"),
  v.literal("yc"),
  v.literal("trustmrr"),
);

/** Derived, never restated: a source a campaign can confirm is a source a
 *  prospect can cite. Widening `vSourceConfig` without widening
 *  `vProspectSource` is then a compile error here rather than a runtime
 *  INVALID on a valid discover result. */
export type ProspectSource = SourceConfig["source"];

const _prospectSourceCoversSourcePlan: ProspectSource =
  null as unknown as Infer<typeof vProspectSource>;
void _prospectSourceCoversSourcePlan;

/**
 * Observed metric metadata carried on a source reference. Always explicit
 * name/currency/period like the §4.1 TrustMRR bounds — a bare number would
 * let "$40k" and "40k signups" merge. `currency`/`period` stay optional so a
 * non-revenue metric is not forced to invent them (§4.5: no invented metrics).
 */
export const vObservedMetric = v.object({
  name: v.string(),
  value: v.number(),
  currency: v.optional(v.string()),
  period: v.optional(v.union(v.literal("monthly"), v.literal("annual"))),
});

/**
 * One source reference: which source, the profile URL it was read from, the
 * provider record ID where the provider exposes one, when it was retrieved
 * and any observed metric. Re-discovery MERGES these; provenance is never
 * overwritten, and companies are never merged by display name alone (§4.3).
 */
export const vProspectSourceRef = v.object({
  source: vProspectSource,
  profileUrl: v.string(),
  providerRecordId: v.optional(v.string()),
  retrievedAt: v.number(),
  metric: v.optional(vObservedMetric),
});

export type ProspectSourceRef = Infer<typeof vProspectSourceRef>;

export const PROSPECT_SOURCE_REFS_MAX = 10;
export const PROSPECT_COMPANY_NAME_MAX_LENGTH = 200;
export const PROSPECT_FIT_REASON_MAX_LENGTH = 2_000;
export const PROSPECT_STAGE_REASON_MAX_LENGTH = 500;
export const PROVIDER_RECORD_ID_MAX_LENGTH = 200;
export const CANONICAL_DOMAIN_MAX_LENGTH = 253;

/**
 * Canonical dedupe domain for `by_workspaceId_and_campaignId_and_canonicalDomain`.
 * Accepts a bare host or an http(s) URL and extracts the host through the URL
 * parser (so a path, query or credentials cannot leak into the key),
 * lowercases, drops a trailing root dot and drops a leading `www.` — the one
 * subdomain that never identifies a different business. Every OTHER subdomain
 * is preserved, per §4.3.
 *
 * ASCII hosts only: the shared dotted-domain floor ends in `[a-z]{2,63}`, so a
 * punycode TLD (`xn--p1ai`) is rejected rather than stored. IDN support is part
 * of the same P09 deepening as the public-suffix work below.
 *
 * This is a syntax-and-host floor, NOT public-suffix awareness: no suffix list
 * is bundled, so `a.co.uk` and `b.co.uk` stay distinct (correct) but a registrable
 * base cannot be computed. P09 owns deepening this when it implements Apollo
 * dedupe; deepen it HERE so both writers share one key.
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
 * Bound and de-duplicate a prospect's source references. Distinctness is by
 * (source, provider record ID) and falls back to the normalized profile URL
 * when the provider exposes no ID, so re-discovering the same Apollo record
 * merges instead of consuming one of the ten slots. Returns the normalized
 * list to store.
 */
export function assertSourceRefs(
  refs: ProspectSourceRef[],
  field = "sourceRefs",
): ProspectSourceRef[] {
  if (refs.length === 0) {
    throw invalid(`${field} must carry at least one actual source reference`);
  }
  // Cheap guard before the normalize/dedupe pass: distinctness can only shrink
  // the list, so anything past the cap in RAW length can never fit, and paying
  // a URL parse per element first lets an oversized payload buy unbounded work
  // inside the caller's transaction.
  if (refs.length > PROSPECT_SOURCE_REFS_MAX) {
    throw invalid(
      `${field} allows at most ${PROSPECT_SOURCE_REFS_MAX} source references`,
    );
  }
  const seen = new Set<string>();
  const normalized = refs.map((ref, index) => {
    const at = `${field}[${index}]`;
    const profileUrl = normalizeHttpUrl(ref.profileUrl, `${at}.profileUrl`);
    const providerRecordId =
      ref.providerRecordId === undefined
        ? undefined
        : boundedString(ref.providerRecordId, `${at}.providerRecordId`, {
            min: 1,
            max: PROVIDER_RECORD_ID_MAX_LENGTH,
          });
    const identity = `${ref.source}:${providerRecordId ?? profileUrl}`;
    if (seen.has(identity)) {
      return null;
    }
    seen.add(identity);
    return {
      source: ref.source,
      profileUrl,
      ...(providerRecordId === undefined ? {} : { providerRecordId }),
      retrievedAt: assertEpochMs(ref.retrievedAt, `${at}.retrievedAt`),
      ...(ref.metric === undefined
        ? {}
        : { metric: assertObservedMetric(ref.metric, `${at}.metric`) }),
    } satisfies ProspectSourceRef;
  });
  const distinct = normalized.filter(
    (ref): ref is ProspectSourceRef => ref !== null,
  );
  if (distinct.length > PROSPECT_SOURCE_REFS_MAX) {
    throw invalid(
      `${field} allows at most ${PROSPECT_SOURCE_REFS_MAX} distinct source references`,
    );
  }
  return distinct;
}

/** Bound one observed metric; `name` is always explicit (§4.1). */
export function assertObservedMetric(
  metric: Infer<typeof vObservedMetric>,
  field: string,
): Infer<typeof vObservedMetric> {
  if (!Number.isFinite(metric.value)) {
    throw invalid(`${field}.value must be a finite number`);
  }
  return {
    name: boundedString(metric.name, `${field}.name`, { min: 1, max: 100 }),
    value: metric.value,
    ...(metric.currency === undefined
      ? {}
      : {
          currency: boundedString(metric.currency, `${field}.currency`, {
            min: 3,
            max: 3,
          }).toUpperCase(),
        }),
    ...(metric.period === undefined ? {} : { period: metric.period }),
  };
}

/**
 * The provider's own assessment of the address it returned. Deliberately NOT
 * the worker wire vocabulary (`vContactResult.emailConfidence`) and
 * deliberately NOT send eligibility: suppressions and sending policy decide
 * whether OpenSquad may write to an address (§4.3). `unknown` is the honest
 * value when the provider states nothing.
 */
export const vProviderEmailStatus = v.union(
  v.literal("verified"),
  v.literal("guessed"),
  v.literal("unavailable"),
  v.literal("unknown"),
);

export type ProviderEmailStatus =
  | "verified"
  | "guessed"
  | "unavailable"
  | "unknown";

export const CONTACT_SELECTION_REASON_MAX_LENGTH = 500;

/**
 * MVP `contact` — exactly one selected business person, not a list (§4.3).
 * `email` is absent unless the provider returned one; an address is never
 * manufactured, so absence plus a preserved `providerEmailStatus` is the
 * correct representation of "we could not get one".
 */
export const vProspectContact = v.object({
  source: vProspectSource,
  providerRef: v.string(),
  fullName: v.string(),
  role: v.optional(v.string()),
  email: v.optional(v.string()),
  providerEmailStatus: vProviderEmailStatus,
  retrievedAt: v.number(),
  selectionReason: v.string(),
});

export type ProspectContact = Infer<typeof vProspectContact>;

/** Bound and normalize a selected contact before storing it. */
export function assertProspectContact(
  contact: ProspectContact,
  field = "contact",
): ProspectContact {
  const email =
    contact.email === undefined
      ? undefined
      : normalizeEmailAddress(contact.email, `${field}.email`);
  if (email === undefined && contact.providerEmailStatus === "verified") {
    throw invalid(
      `${field}.providerEmailStatus cannot be "verified" without a provider-returned address`,
    );
  }
  if (email !== undefined && contact.providerEmailStatus === "unavailable") {
    throw invalid(
      `${field}.providerEmailStatus "unavailable" contradicts the supplied address`,
    );
  }
  return {
    source: contact.source,
    providerRef: boundedString(contact.providerRef, `${field}.providerRef`, {
      min: 1,
      max: PROVIDER_RECORD_ID_MAX_LENGTH,
    }),
    fullName: boundedString(contact.fullName, `${field}.fullName`, {
      min: 1,
      max: 200,
    }),
    ...(contact.role === undefined
      ? {}
      : {
          role: boundedString(contact.role, `${field}.role`, {
            min: 1,
            max: 200,
          }),
        }),
    ...(email === undefined ? {} : { email }),
    providerEmailStatus: contact.providerEmailStatus,
    retrievedAt: assertEpochMs(contact.retrievedAt, `${field}.retrievedAt`),
    selectionReason: boundedString(
      contact.selectionReason,
      `${field}.selectionReason`,
      { min: 1, max: CONTACT_SELECTION_REASON_MAX_LENGTH },
    ),
  };
}

/**
 * Next-action kinds. §4.3 requires "a bounded description plus action kind"
 * but enumerates no members, so this list is derived from the §5 CRM/booking
 * entry points and the §8 "CRM and booking transitions" rules. P19's picker
 * renders exactly these;
 * a new kind is a deliberate widening here, never a free-form string.
 */
export const NEXT_ACTION_KINDS = [
  "follow_up_email",
  "call",
  "await_reply",
  "research",
  "enrich_contact",
  "propose_booking",
  "confirm_booking",
  "review",
] as const;

export const vNextActionKind = v.union(
  v.literal("follow_up_email"),
  v.literal("call"),
  v.literal("await_reply"),
  v.literal("research"),
  v.literal("enrich_contact"),
  v.literal("propose_booking"),
  v.literal("confirm_booking"),
  v.literal("review"),
);

export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];

export const NEXT_ACTION_DESCRIPTION_MAX_LENGTH = 500;

/**
 * `nextAction` is the work itself; `prospects.nextActionDueAt` is a separate
 * optional UTC epoch-ms field. An absent due time is the explicit
 * "unscheduled" state — never a far-future sentinel date (§4.3).
 */
export const vNextAction = v.object({
  kind: vNextActionKind,
  description: v.string(),
});

export type NextAction = Infer<typeof vNextAction>;

/** Bound a next action's free text before storing it. */
export function assertNextAction(
  action: NextAction,
  field = "nextAction",
): NextAction {
  return {
    kind: action.kind,
    description: boundedString(action.description, `${field}.description`, {
      min: 1,
      max: NEXT_ACTION_DESCRIPTION_MAX_LENGTH,
    }),
  };
}

/* ----- lead events ----------------------------------------------------- */

/**
 * Append-only CRM history kinds (§4.3: status / owner / note / next-action /
 * booking history, plus the §8 research and enrichment updates). Unlike
 * `activityEvents.kind` — a bounded string feeding a receipts timeline — this
 * is a closed union, because a lead event is the audit record a human stage
 * correction and a booking transition are proved by.
 */
export const LEAD_EVENT_KINDS = [
  "stage_changed",
  "owner_assigned",
  "note_added",
  "next_action_set",
  "next_action_cleared",
  "research_applied",
  "contact_enriched",
  "booking_proposed",
  "booking_confirmed",
  "booking_rescheduled",
  "booking_cancelled",
  "booking_outcome_recorded",
] as const;

export const vLeadEventKind = v.union(
  v.literal("stage_changed"),
  v.literal("owner_assigned"),
  v.literal("note_added"),
  v.literal("next_action_set"),
  v.literal("next_action_cleared"),
  v.literal("research_applied"),
  v.literal("contact_enriched"),
  v.literal("booking_proposed"),
  v.literal("booking_confirmed"),
  v.literal("booking_rescheduled"),
  v.literal("booking_cancelled"),
  v.literal("booking_outcome_recorded"),
);

export type LeadEventKind = (typeof LEAD_EVENT_KINDS)[number];

/**
 * Who caused the event. A discriminated union rather than
 * `activityEvents.actor`'s bare string, because §4.3 makes the provenance
 * structural: only a `human` actor carries an `identityKey`, and it comes from
 * `ctx.auth` — never from model output or email content. `workflow` is the
 * internal pipeline; `system` is a backend sweep with no human behind it. The
 * originating run stays in `leadEvents.runId`.
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
 * Structured previous/new values §8 "CRM and booking transitions" requires
 * an event to preserve. Every
 * member is optional because one event kind uses a few of them, but the shape
 * is closed — a lead event never carries an open bag of model-chosen keys.
 * `fromStage`/`toStage` are top-level columns and are deliberately absent here.
 */
export const vLeadEventDetails = v.object({
  fromOwnerIdentityKey: v.optional(v.string()),
  toOwnerIdentityKey: v.optional(v.string()),
  fromQualification: v.optional(vQualification),
  toQualification: v.optional(vQualification),
  fromNextAction: v.optional(vNextAction),
  toNextAction: v.optional(vNextAction),
  fromNextActionDueAt: v.optional(v.number()),
  toNextActionDueAt: v.optional(v.number()),
  previousStartsAt: v.optional(v.number()),
  previousEndsAt: v.optional(v.number()),
  previousTimezone: v.optional(v.string()),
  /** Stated basis for a human correction, cancellation or won/lost call. */
  reason: v.optional(v.string()),
  /** Body of a `note_added` event — a note, never a synthesized message. */
  note: v.optional(v.string()),
});

export type LeadEventDetails = Infer<typeof vLeadEventDetails>;

/* ----- bookings -------------------------------------------------------- */

export const vBookingState = v.union(
  v.literal("proposed"),
  v.literal("confirmed"),
  v.literal("cancelled"),
  v.literal("completed"),
  v.literal("no_show"),
);

export type BookingState =
  | "proposed"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show";

/** States that occupy the at-most-one-active slot per lead (§4.3). */
export const BOOKING_ACTIVE_STATES: readonly BookingState[] = [
  "proposed",
  "confirmed",
];

/** States that REQUIRE `startsAt`, `endsAt` and `timezone` (§4.3). */
export const BOOKING_TIMED_STATES: readonly BookingState[] = [
  "confirmed",
  "completed",
  "no_show",
];

/**
 * How a meeting time became authoritative. `manual` is an authenticated
 * human's assertion. `provider` keeps a typed contract but is UNAVAILABLE
 * until a validated calendar connector verifies the event — the same
 * declared-but-gated shape as `ENABLED_SOURCES`; no model may fabricate an
 * external event ID (§4.3, §8 "CRM and booking transitions").
 */
export const vConfirmationSource = v.union(
  v.literal("manual"),
  v.literal("provider"),
);

export type ConfirmationSource = "manual" | "provider";

/** Confirmation sources currently permitted on a write. */
export const ENABLED_CONFIRMATION_SOURCES = ["manual"] as const;

/**
 * Reject a confirmation basis whose verification path does not exist yet.
 * `provider` stays declared but unwritable until a validated calendar
 * connector can supply a real event — §4.3 forbids standing one in for a
 * human assertion, and §8 forbids fabricating external event IDs.
 */
export function assertConfirmationSourceEnabled(
  source: ConfirmationSource,
): void {
  const enabled = new Set<string>(ENABLED_CONFIRMATION_SOURCES);
  if (!enabled.has(source)) {
    throw invalid(
      `confirmationSource ${source} is not available; a validated calendar connector must verify the event first`,
    );
  }
}

export const BOOKING_SLOTS_MAX = 3;
export const BOOKING_CONFIRMATION_NOTE_MAX_LENGTH = 300;
export const BOOKING_CANCELLATION_REASON_MAX_LENGTH = 500;

/**
 * `bookings.proposal` (§4.3): a booking link, or up to three future intervals
 * under one IANA timezone. A proposal implies NO confirmation — neither a sent
 * link nor an offered slot nor a model classification confirms a meeting.
 */
export const vBookingProposal = v.union(
  v.object({ kind: v.literal("booking_link"), url: v.string() }),
  v.object({
    kind: v.literal("slots"),
    timezone: v.string(),
    slots: v.array(v.object({ startsAt: v.number(), endsAt: v.number() })),
  }),
);

export type BookingProposal = Infer<typeof vBookingProposal>;

/**
 * Validate a proposal at proposal time: a public http(s) link, or 1–3 valid
 * future intervals under a canonical IANA zone. Returns the normalized value.
 */
export function assertBookingProposal(
  proposal: BookingProposal,
  options: { now: number },
  field = "proposal",
): BookingProposal {
  if (proposal.kind === "booking_link") {
    return {
      kind: "booking_link",
      url: normalizeHttpUrl(proposal.url, `${field}.url`),
    };
  }
  if (proposal.slots.length === 0) {
    throw invalid(`${field}.slots must offer at least one interval`);
  }
  if (proposal.slots.length > BOOKING_SLOTS_MAX) {
    throw invalid(
      `${field}.slots allows at most ${BOOKING_SLOTS_MAX} intervals`,
    );
  }
  return {
    kind: "slots",
    timezone: assertIanaTimezone(proposal.timezone, `${field}.timezone`),
    slots: proposal.slots.map((slot, index) => {
      const at = `${field}.slots[${index}]`;
      const startsAt = assertEpochMs(slot.startsAt, `${at}.startsAt`);
      const endsAt = assertEpochMs(slot.endsAt, `${at}.endsAt`);
      if (endsAt <= startsAt) {
        throw invalid(`${at}.endsAt must be after startsAt`);
      }
      if (startsAt <= options.now) {
        throw invalid(`${at}.startsAt must be in the future`);
      }
      return { startsAt, endsAt };
    }),
  };
}

/**
 * Enforce the §4.3 precondition "times required for confirmed/completed/
 * no-show", returning the normalized triple for those states only.
 *
 * NOT a way to derive what to STORE. `undefined` here means "this state does
 * not require times", never "this row has none": a booking cancelled from
 * `confirmed` still carries the agreed start/end/timezone, and §8 "CRM and
 * booking transitions" requires keeping it — writing the triple back as
 * undefined on cancel would destroy the record of what was actually agreed.
 * The row-level timezone is the CONFIRMED meeting's zone; a `slots` proposal's
 * own timezone records what was offered and is not rewritten by a reschedule.
 */
export function assertRequiredBookingTimes(
  state: BookingState,
  times: { startsAt?: number; endsAt?: number; timezone?: string },
  field = "booking",
): { startsAt: number; endsAt: number; timezone: string } | undefined {
  if (!BOOKING_TIMED_STATES.includes(state)) {
    return undefined;
  }
  if (
    times.startsAt === undefined ||
    times.endsAt === undefined ||
    times.timezone === undefined
  ) {
    throw invalid(
      `${field} in state ${state} requires startsAt, endsAt and timezone`,
    );
  }
  const startsAt = assertEpochMs(times.startsAt, `${field}.startsAt`);
  const endsAt = assertEpochMs(times.endsAt, `${field}.endsAt`);
  if (endsAt <= startsAt) {
    throw invalid(`${field}.endsAt must be after startsAt`);
  }
  return {
    startsAt,
    endsAt,
    timezone: assertIanaTimezone(times.timezone, `${field}.timezone`),
  };
}

/* ----- evidence -------------------------------------------------------- */

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

/** §4.5 research caps. The full output lives in storage behind `artifactId`. */
export const EVIDENCE_EXCERPT_MAX_LENGTH = 2_000;
export const EVIDENCE_OBSERVATION_MAX_LENGTH = 1_000;
export const RESEARCH_OBSERVATIONS_MAX = 12;
