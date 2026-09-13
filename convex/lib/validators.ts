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
 */
export function boundedString(
  value: string,
  field: string,
  options: { min?: number; max: number },
): string {
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
