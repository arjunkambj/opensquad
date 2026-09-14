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
 * Returns the input unchanged; throws `INVALID` for unknown zones.
 */
export function assertIanaTimezone(value: string, field = "timezone"): string {
  const trimmed = boundedString(value, field, { min: 1, max: 100 });
  try {
    // Throws RangeError for names outside the IANA database.
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
  } catch {
    throw invalid(`${field} must be a valid IANA timezone`);
  }
  return trimmed;
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

export const vClassifyReplyResult = v.object({
  schemaVersion: v.literal(1),
  operation: v.literal("classify_reply"),
  classification: v.union(
    v.literal("interested"),
    v.literal("not_interested"),
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

export const vWorkerResult = v.union(
  vDiscoverResult,
  vResearchResult,
  vContactResult,
  vDraftResult,
  vClassifyReplyResult,
);
export type WorkerResult = Infer<typeof vWorkerResult>;

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
  if (result.schemaVersion !== 1) {
    throw bridgeInvalid("result.schemaVersion must be 1");
  }
  if (result.operation !== expectedOperation) {
    throw bridgeInvalid(
      `result.operation ${String(result.operation)} does not match request operation ${expectedOperation}`,
    );
  }
  boundedString(result.summary as string, "result.summary", {
    min: 0,
    max: 1000,
  });
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
        ![
          "interested",
          "not_interested",
          "out_of_office",
          "unsubscribe",
          "bounce",
          "question",
          "other",
        ].includes(result.classification as string)
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
] as const;

export type ActivityKindP10 = (typeof ACTIVITY_KINDS_P10)[number];

/* ----- conversation/draft/approval/send-attempt state unions -------- */

export const vConversationState = v.union(
  v.literal("open"),
  v.literal("closed"),
  v.literal("unassigned"),
);

export type ConversationState = "open" | "closed" | "unassigned";

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
 * Application handling key for inbound messages
 * (`incoming:<inbox>:<message>`) — a second provider event ID for the same
 * message can never start a second reply mission (§4.3 note). Outbound
 * delivery events use `outbound:<messageRef>:<eventType>` instead.
 */
export function inboundApplicationKey(inboxRef: string, messageRef: string) {
  return `incoming:${inboxRef}:${messageRef}`;
}

export function outboundApplicationKey(
  messageRef: string,
  eventType: string,
) {
  return `outbound:${messageRef}:${eventType}`;
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
