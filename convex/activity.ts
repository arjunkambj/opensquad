/**
 * Workspace activity feed — architecture §4.2/§5.
 *
 * `recordActivityEvent` is THE write path for activity: every meaningful
 * receipt lands here with a workspace-unique `dedupeKey`, so a replayed
 * step/callback inserts nothing twice (§4.2 "deduped activity events").
 * Public reads are member-guarded, indexed and cursor-paginated.
 */
import { query } from "./_generated/server";
import type { GenericDatabaseWriter } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireWorkspaceMember } from "./lib/auth";
import { boundedLimit, boundedString, domainError } from "./lib/validators";
import { activityEventFields } from "./schema";

export const vActivityEventDoc = v.object({
  _id: v.id("activityEvents"),
  _creationTime: v.number(),
  ...activityEventFields,
});

/** Minimal writer context shared by mutations that record activity. */
export type WriteCtx = { db: GenericDatabaseWriter<DataModel> };

export type ActivityInput = {
  workspaceId: Id<"workspaces">;
  /** One of the ACTIVITY_KINDS lists (lib/validators.ts); stored as a
   *  bounded string. */
  kind: string;
  summary: string;
  /** identityKey for human actions; "workflow" / "system" otherwise. */
  actor: string;
  dedupeKey: string;
  prospectId?: string;
  conversationId?: string;
};

/**
 * Insert one activity event unless its `dedupeKey` already exists in the
 * workspace. Returns the existing row on a duplicate so callers can stay
 * idempotent without pre-checking.
 */
export async function recordActivityEvent(
  ctx: WriteCtx,
  event: ActivityInput,
): Promise<Doc<"activityEvents">> {
  const existing = await ctx.db
    .query("activityEvents")
    .withIndex("by_workspaceId_and_dedupeKey", (q) =>
      q.eq("workspaceId", event.workspaceId).eq("dedupeKey", event.dedupeKey),
    )
    .unique();
  if (existing !== null) {
    return existing;
  }
  const id = await ctx.db.insert("activityEvents", {
    workspaceId: event.workspaceId,
    kind: boundedString(event.kind, "kind", { min: 1, max: 64 }),
    summary: boundedString(event.summary, "summary", { min: 1, max: 500 }),
    actor: boundedString(event.actor, "actor", { min: 1, max: 300 }),
    dedupeKey: boundedString(event.dedupeKey, "dedupeKey", {
      min: 1,
      max: 200,
    }),
    createdAt: Date.now(),
    ...(event.prospectId !== undefined ? { prospectId: event.prospectId } : {}),
    ...(event.conversationId !== undefined
      ? { conversationId: event.conversationId }
      : {}),
  });
  const row = await ctx.db.get("activityEvents", id);
  if (row === null) {
    throw domainError("NOT_FOUND", "activity event not found after insert");
  }
  return row;
}

/**
 * Chronological workspace activity feed. `from`/`to` bound the `createdAt`
 * range. Newest first, cursor-paginated, `{items, cursor, hasMore}`.
 */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vActivityEventDoc),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("activityEvents")
      .withIndex("by_workspaceId_and_createdAt", (q) => {
        const bound = q.eq("workspaceId", args.workspaceId);
        if (args.from !== undefined && args.to !== undefined) {
          return bound.gte("createdAt", args.from).lte("createdAt", args.to);
        }
        if (args.from !== undefined) {
          return bound.gte("createdAt", args.from);
        }
        if (args.to !== undefined) {
          return bound.lte("createdAt", args.to);
        }
        return bound;
      })
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});
