/**
 * Suppressions — explicit email/domain blocks (architecture §4.3/§8.6,
 * integrations G3 step 9).
 *
 * A suppression row is the only thing `sending.ts` honors as "do not send":
 * the preflight normalizes the draft's recipient, checks the exact email
 * key, then the domain key. Email unsubscribe NEVER implies the domain —
 * domain rows are always created explicitly (`kind: "domain"`), which is
 * deliberate: one person's opt-out cannot silently suppress a whole company.
 *
 * Unique (workspaceId, kind, normalizedValue) is enforced transactionally;
 * re-adding is an idempotent no-op returning the existing row.
 */
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  requireWorkspaceEditor,
  requireWorkspaceMember,
} from "./lib/auth";
import type { AuthCtx } from "./lib/auth";
import {
  boundedLimit,
  domainError,
  domainOfNormalizedEmail,
  normalizeDomain,
  normalizeEmailAddress,
  vSuppressionKind,
  vSuppressionReason,
} from "./lib/validators";
import type { SuppressionKind, SuppressionReason } from "./lib/validators";
import { suppressionFields } from "./schema";

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
  workspaceId: Id<"workspaces">,
  kind: SuppressionKind,
  normalizedValue: string,
): Promise<Doc<"suppressions"> | null> {
  return await ctx.db
    .query("suppressions")
    .withIndex("by_workspaceId_and_kind_and_normalizedValue", (q) =>
      q
        .eq("workspaceId", workspaceId)
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
  workspaceId: Id<"workspaces">,
  normalizedEmail: string,
): Promise<{
  suppression: Doc<"suppressions">;
  matchedBy: "email" | "domain";
} | null> {
  const byEmail = await findSuppression(
    ctx,
    workspaceId,
    "email",
    normalizedEmail,
  );
  if (byEmail !== null) {
    return { suppression: byEmail, matchedBy: "email" };
  }
  const byDomain = await findSuppression(
    ctx,
    workspaceId,
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

/** All suppression rows for the workspace (bounded). */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    kind: v.optional(vSuppressionKind),
    limit: v.optional(v.number()),
  },
  returns: v.array(vSuppressionDoc),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const limit = boundedLimit(args.limit);
    const kind = args.kind;
    if (kind !== undefined) {
      // Narrow scan: range over the kind prefix of the unique index.
      const rows = await ctx.db
        .query("suppressions")
        .withIndex("by_workspaceId_and_kind_and_normalizedValue", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("kind", kind),
        )
        .take(limit);
      return rows;
    }
    return await ctx.db
      .query("suppressions")
      .withIndex("by_workspaceId_and_kind_and_normalizedValue", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .take(limit);
  },
});

/** Would this recipient be blocked right now? Member-readable. */
export const check = query({
  args: {
    workspaceId: v.id("workspaces"),
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
    await requireWorkspaceMember(ctx, args.workspaceId);
    const normalized = normalizeEmailAddress(args.email, "email");
    const match = await matchSuppression(ctx, args.workspaceId, normalized);
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
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Add a suppression (owner/operator; P11's inbound path calls the internal
 * variant for verified unsubscribe/bounce facts). The normalized unique key
 * makes re-adding idempotent — the existing row is returned, never doubled.
 */
export const add = mutation({
  args: {
    workspaceId: v.id("workspaces"),
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
    const { workspace } = await requireWorkspaceEditor(ctx, args.workspaceId);
    return await insertSuppression(ctx, workspace._id, args);
  },
});

/** Remove a suppression (owner/operator). Rows are deleted, not archived —
 * the activity record lives on the workspace activity feed. */
export const remove = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    suppressionId: v.id("suppressions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const row = await ctx.db.get("suppressions", args.suppressionId);
    if (row === null || row.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "suppression not found");
    }
    await ctx.db.delete("suppressions", row._id);
    return null;
  },
});

async function insertSuppression(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
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
    workspaceId,
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
    if (conversation === null || conversation.workspaceId !== workspaceId) {
      throw domainError("NOT_FOUND", "source conversation not found");
    }
  }
  const id = await ctx.db.insert("suppressions", {
    workspaceId,
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
 * P11; delivery-fact folding — sending.ts). Same normalized-unique-key
 * semantics as the public mutation.
 */
export const recordSuppression = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
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
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (workspace === null) {
      throw domainError("NOT_FOUND", "workspace not found");
    }
    return await insertSuppression(ctx, workspace._id, args);
  },
});
