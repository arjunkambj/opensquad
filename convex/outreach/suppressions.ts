/**
 * Suppressions — explicit email/domain blocks (architecture §4.3/§8.6,
 * integrations G3 step 9).
 *
 * A suppression row is the only thing the send boundary honors as "do not send":
 * the preflight normalizes the draft's recipient, checks the exact email
 * key, then the domain key. Email unsubscribe NEVER implies the domain —
 * domain rows are always created explicitly (`kind: "domain"`), which is
 * deliberate: one person's opt-out cannot silently suppress a whole company.
 *
 * Unique (orgId, kind, normalizedValue) is enforced transactionally;
 * re-adding is an idempotent no-op returning the existing row.
 */
import { internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  requireOrgMember,
} from "../lib/auth";
import type { AuthCtx } from "../lib/auth";
import {
  boundedLimit,
  boundedString,
  domainError,
  domainOfNormalizedEmail,
  EMAIL_ADDRESS_MAX_LENGTH,
  normalizeDomain,
  normalizeEmailAddress,
  vSuppressionKind,
  vSuppressionReason,
} from "../lib/validators";
import type { SuppressionKind, SuppressionReason } from "../lib/validators";
import { suppressionFields } from "../schema";

export const vSuppressionDoc = v.object({
  _id: v.id("suppressions"),
  _creationTime: v.number(),
  ...suppressionFields,
});

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Canonical suppression key for the given kind. */
function normalizedSuppressionValue(
  kind: SuppressionKind,
  value: string,
): string {
  return kind === "domain"
    ? normalizeDomain(value, "value")
    : normalizeEmailAddress(value, "value");
}

export async function findSuppression(
  ctx: AuthCtx,
  orgId: Id<"orgs">,
  kind: SuppressionKind,
  normalizedValue: string,
): Promise<Doc<"suppressions"> | null> {
  return await ctx.db
    .query("suppressions")
    .withIndex("by_orgId_and_kind_and_normalizedValue", (q) =>
      q
        .eq("orgId", orgId)
        .eq("kind", kind)
        .eq("normalizedValue", normalizedValue),
    )
    .unique();
}

/**
 * Which suppression (if any) blocks sending to `normalizedEmail`. Checks the
 * exact email key first, then the explicit domain key. Returns the matched
 * row plus whether the match was the email or the domain.
 */
export async function matchSuppression(
  ctx: AuthCtx,
  orgId: Id<"orgs">,
  normalizedEmail: string,
): Promise<{
  suppression: Doc<"suppressions">;
  matchedBy: "email" | "domain";
} | null> {
  const byEmail = await findSuppression(
    ctx,
    orgId,
    "email",
    normalizedEmail,
  );
  if (byEmail !== null) {
    return { suppression: byEmail, matchedBy: "email" };
  }
  const byDomain = await findSuppression(
    ctx,
    orgId,
    "domain",
    domainOfNormalizedEmail(normalizedEmail),
  );
  if (byDomain !== null) {
    return { suppression: byDomain, matchedBy: "domain" };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Public reads                                                        */
/* ------------------------------------------------------------------ */

/** All suppression rows for the org (bounded). */
export const list = query({
  args: {
    orgId: v.id("orgs"),
    kind: v.optional(vSuppressionKind),
    limit: v.optional(v.number()),
  },
  returns: v.array(vSuppressionDoc),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const limit = boundedLimit(args.limit);
    const kind = args.kind;
    if (kind !== undefined) {
      // Narrow scan: range over the kind prefix of the unique index.
      const rows = await ctx.db
        .query("suppressions")
        .withIndex("by_orgId_and_kind_and_normalizedValue", (q) =>
          q.eq("orgId", args.orgId).eq("kind", kind),
        )
        .take(limit);
      return rows;
    }
    return await ctx.db
      .query("suppressions")
      .withIndex("by_orgId_and_kind_and_normalizedValue", (q) =>
        q.eq("orgId", args.orgId),
      )
      .take(limit);
  },
});

/** Would this recipient be blocked right now? Member-readable. */
export const check = query({
  args: {
    orgId: v.id("orgs"),
    email: v.string(),
  },
  returns: v.object({
    suppressed: v.boolean(),
    matchedBy: v.union(
      v.literal("email"),
      v.literal("domain"),
      v.null(),
    ),
    suppression: v.union(vSuppressionDoc, v.null()),
  }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const normalized = normalizeEmailAddress(args.email, "email");
    const match = await matchSuppression(ctx, args.orgId, normalized);
    if (match === null) {
      return { suppressed: false, matchedBy: null, suppression: null };
    }
    return {
      suppressed: true,
      matchedBy: match.matchedBy,
      suppression: match.suppression,
    };
  },
});

/* ------------------------------------------------------------------ */
/* The Blocklist tab's read                                            */
/* ------------------------------------------------------------------ */

/**
 * How many of an org's suppression rows one request will read.
 *
 * There is no (org, createdAt) index — the unique key indexes by value
 * — so newest-first ordering and substring search are both done over a
 * bounded scan. A trial org sends at most 30 mails a day, so its whole
 * blocklist is tens of rows; the cap exists so a pathological org
 * degrades honestly (`truncated`) instead of reading an unbounded table.
 */
const SUPPRESSION_SCAN_MAX = 1000;

/** Rows one Blocklist page shows. */
const SUPPRESSION_PAGE_MAX = 25;

/**
 * Where the next page starts. `createdAt` alone is not a key — a bounce sweep
 * can write several rows in one transaction and they share a millisecond — so
 * the row's id breaks the tie and no entry can fall between two pages.
 */
export const vSuppressionCursor = v.object({
  at: v.number(),
  id: v.id("suppressions"),
});

type SuppressionCursor = { at: number; id: Id<"suppressions"> };

/** Newest first, ties broken by id so the order is total and stable. */
function newerFirst(
  left: Doc<"suppressions">,
  right: Doc<"suppressions">,
): number {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }
  return left._id < right._id ? 1 : left._id > right._id ? -1 : 0;
}

/** Is `row` strictly past `cursor` in newest-first order? */
function isAfterCursor(
  row: Doc<"suppressions">,
  cursor: SuppressionCursor,
): boolean {
  if (row.createdAt !== cursor.at) {
    return row.createdAt < cursor.at;
  }
  return row._id < cursor.id;
}

/**
 * One page of the Blocklist tab: newest first, optionally narrowed to a kind
 * and to rows whose normalized value contains `search`.
 *
 * `list` stays the flat read the rest of the backend uses; this exists
 * because the tab needs ordering, a filter and a page boundary, and folding
 * those into `list` would change what every other caller receives.
 */
export const page = query({
  args: {
    orgId: v.id("orgs"),
    kind: v.optional(vSuppressionKind),
    /** Case-insensitive substring of the normalized address or domain. */
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
    after: v.optional(vSuppressionCursor),
  },
  returns: v.object({
    entries: v.array(vSuppressionDoc),
    /** Pass back as `after` for the next page; `null` at the end. */
    nextCursor: v.union(vSuppressionCursor, v.null()),
    /** Rows matching the current filter, across every page. */
    matched: v.number(),
    /** The org holds more rows than one request reads. */
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const limit = Math.min(boundedLimit(args.limit), SUPPRESSION_PAGE_MAX);
    const kind = args.kind;
    const term =
      args.search === undefined
        ? ""
        : boundedString(args.search, "search", {
            max: EMAIL_ADDRESS_MAX_LENGTH,
          }).toLowerCase();

    const scanned = await ctx.db
      .query("suppressions")
      .withIndex("by_orgId_and_kind_and_normalizedValue", (q) =>
        kind === undefined
          ? q.eq("orgId", args.orgId)
          : q.eq("orgId", args.orgId).eq("kind", kind),
      )
      .take(SUPPRESSION_SCAN_MAX + 1);
    const truncated = scanned.length > SUPPRESSION_SCAN_MAX;
    const rows = truncated ? scanned.slice(0, SUPPRESSION_SCAN_MAX) : scanned;

    const matching = (
      term === ""
        ? rows
        : rows.filter((row) => row.normalizedValue.includes(term))
    ).sort(newerFirst);

    const after = args.after;
    const remaining =
      after === undefined
        ? matching
        : matching.filter((row) => isAfterCursor(row, after));
    const entries = remaining.slice(0, limit);
    const last = entries.at(-1);
    return {
      entries,
      nextCursor:
        remaining.length > entries.length && last !== undefined
          ? { at: last.createdAt, id: last._id }
          : null,
      matched: matching.length,
      truncated,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Add a suppression (owner/operator; P11's inbound path calls the internal
 * variant for verified unsubscribe/bounce facts). The normalized unique key
 * makes re-adding idempotent — the existing row is returned, never doubled.
 */
export const add = mutation({
  args: {
    orgId: v.id("orgs"),
    kind: vSuppressionKind,
    value: v.string(),
    reason: vSuppressionReason,
    sourceConversationId: v.optional(v.id("conversations")),
  },
  returns: v.object({
    suppression: vSuppressionDoc,
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { org } = await requireOrgMember(ctx, args.orgId);
    return await insertSuppression(ctx, org._id, args);
  },
});

/** Remove a suppression (owner/operator). Rows are deleted, not archived —
 * the activity record lives on the org activity feed. */
export const remove = mutation({
  args: {
    orgId: v.id("orgs"),
    suppressionId: v.id("suppressions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const row = await ctx.db.get("suppressions", args.suppressionId);
    if (row === null || row.orgId !== args.orgId) {
      throw domainError("NOT_FOUND", "suppression not found");
    }
    await ctx.db.delete("suppressions", row._id);
    return null;
  },
});

async function insertSuppression(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  args: {
    kind: SuppressionKind;
    value: string;
    reason: SuppressionReason;
    sourceConversationId?: Id<"conversations">;
  },
): Promise<{ suppression: Doc<"suppressions">; created: boolean }> {
  const normalizedValue = normalizedSuppressionValue(args.kind, args.value);
  const existing = await findSuppression(
    ctx,
    orgId,
    args.kind,
    normalizedValue,
  );
  if (existing !== null) {
    return { suppression: existing, created: false };
  }
  if (args.sourceConversationId !== undefined) {
    const conversation = await ctx.db.get(
      "conversations",
      args.sourceConversationId,
    );
    if (conversation === null || conversation.orgId !== orgId) {
      throw domainError("NOT_FOUND", "source conversation not found");
    }
  }
  const id = await ctx.db.insert("suppressions", {
    orgId,
    kind: args.kind,
    normalizedValue,
    reason: args.reason,
    createdAt: Date.now(),
    ...(args.sourceConversationId !== undefined
      ? { sourceConversationId: args.sourceConversationId }
      : {}),
  });
  const suppression = await ctx.db.get("suppressions", id);
  if (suppression === null) {
    throw domainError("NOT_FOUND", "suppression not found after insert");
  }
  return { suppression, created: true };
}

/**
 * Record a suppression from backend paths (inbound unsubscribe/bounce —
 * P11; delivery-fact folding — sendOutcome.ts). Same normalized-unique-key
 * semantics as the public mutation.
 */
export const recordSuppression = internalMutation({
  args: {
    orgId: v.id("orgs"),
    kind: vSuppressionKind,
    value: v.string(),
    reason: vSuppressionReason,
    sourceConversationId: v.optional(v.id("conversations")),
  },
  returns: v.object({
    suppression: vSuppressionDoc,
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const org = await ctx.db.get("orgs", args.orgId);
    if (org === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    return await insertSuppression(ctx, org._id, args);
  },
});
