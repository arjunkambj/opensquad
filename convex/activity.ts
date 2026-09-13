/**
 * Activity feed, run receipts and mission comments — architecture §4.2/§5.
 *
 * `recordActivityEvent` is THE write path for activity: every meaningful
 * receipt lands here with a workspace-unique `dedupeKey`, so a replayed
 * step/callback inserts nothing twice (§4.2 "deduped activity events").
 * Public reads are member-guarded, indexed and cursor-paginated.
 *
 * `missionComments` are human notes only — a comment can NEVER resolve a
 * business approval (§4.2 invariant): this module exposes no path from a
 * comment to decision state.
 */
import { mutation, query } from "./_generated/server";
import type { GenericDatabaseWriter } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  requireWorkspaceEditor,
  requireWorkspaceMember,
} from "./lib/auth";
import type { AuthCtx } from "./lib/auth";
import {
  boundedLimit,
  boundedString,
  domainError,
} from "./lib/validators";
import {
  activityEventFields,
  missionCommentFields,
  runFields,
} from "./schema";

export const vActivityEventDoc = v.object({
  _id: v.id("activityEvents"),
  _creationTime: v.number(),
  ...activityEventFields,
});

/** Local doc validator — kept leaf-ward so `runs.ts` can import this module
 *  without a cycle. */
export const vRunDoc = v.object({
  _id: v.id("runs"),
  _creationTime: v.number(),
  ...runFields,
});

export const vMissionCommentDoc = v.object({
  _id: v.id("missionComments"),
  _creationTime: v.number(),
  ...missionCommentFields,
});

/** Minimal writer context shared by mutations that record activity. */
export type WriteCtx = { db: GenericDatabaseWriter<DataModel> };

export type ActivityInput = {
  workspaceId: Id<"workspaces">;
  missionId: Id<"missions">;
  /** One of ACTIVITY_KINDS (lib/validators.ts); stored as bounded string. */
  kind: string;
  summary: string;
  /** identityKey for human actions; "workflow" / "system" otherwise. */
  actor: string;
  dedupeKey: string;
  runId?: Id<"runs">;
  /** Forward reference — `Id<"prospects">` once P09/P19 lands it. */
  prospectId?: string;
  conversationId?: string;
  artifactId?: string;
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
      q
        .eq("workspaceId", event.workspaceId)
        .eq("dedupeKey", event.dedupeKey),
    )
    .unique();
  if (existing !== null) {
    return existing;
  }
  const id = await ctx.db.insert("activityEvents", {
    workspaceId: event.workspaceId,
    missionId: event.missionId,
    kind: boundedString(event.kind, "kind", { min: 1, max: 64 }),
    summary: boundedString(event.summary, "summary", { min: 1, max: 500 }),
    actor: boundedString(event.actor, "actor", { min: 1, max: 300 }),
    dedupeKey: boundedString(event.dedupeKey, "dedupeKey", {
      min: 1,
      max: 200,
    }),
    createdAt: Date.now(),
    ...(event.runId !== undefined ? { runId: event.runId } : {}),
    ...(event.prospectId !== undefined ? { prospectId: event.prospectId } : {}),
    ...(event.conversationId !== undefined
      ? { conversationId: event.conversationId }
      : {}),
    ...(event.artifactId !== undefined ? { artifactId: event.artifactId } : {}),
  });
  const row = await ctx.db.get("activityEvents", id);
  if (row === null) {
    throw domainError("NOT_FOUND", "activity event not found after insert");
  }
  return row;
}

/** Mission read scoped to the caller's workspace — shared by feed queries. */
async function getMissionInWorkspace(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
  missionId: Id<"missions">,
): Promise<Doc<"missions">> {
  const mission = await ctx.db.get("missions", missionId);
  if (mission === null || mission.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "mission not found");
  }
  return mission;
}

/**
 * Chronological activity feed. Filters by mission when `missionId` is given,
 * by workspace otherwise; `from`/`to` bound the `createdAt` range. Newest
 * first, cursor-paginated, `{items, cursor, hasMore}`.
 */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    missionId: v.optional(v.id("missions")),
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
    if (args.missionId !== undefined) {
      await getMissionInWorkspace(ctx, args.workspaceId, args.missionId);
    }
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("activityEvents")
      .withIndex(
        args.missionId === undefined
          ? "by_workspaceId_and_createdAt"
          : "by_missionId_and_createdAt",
        (q) => {
          const bound =
            args.missionId === undefined
              ? q.eq("workspaceId", args.workspaceId)
              : q.eq("missionId", args.missionId);
          if (args.from !== undefined && args.to !== undefined) {
            return bound
              .gte("createdAt", args.from)
              .lte("createdAt", args.to);
          }
          if (args.from !== undefined) {
            return bound.gte("createdAt", args.from);
          }
          if (args.to !== undefined) {
            return bound.lte("createdAt", args.to);
          }
          return bound;
        },
      )
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});

/**
 * Run receipts for one mission (execution history, not stage orchestration).
 * Newest first, cursor-paginated.
 */
export const listRuns = query({
  args: {
    workspaceId: v.id("workspaces"),
    missionId: v.id("missions"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vRunDoc),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    await getMissionInWorkspace(ctx, args.workspaceId, args.missionId);
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("runs")
      .withIndex("by_missionId_and_createdAt", (q) =>
        q.eq("missionId", args.missionId),
      )
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});

/**
 * Add a human comment to a mission (owner/operator). Comments carry no
 * approval semantics — they cannot resolve a decision or advance a send;
 * `acknowledgedByRunId` is set later by a run that consumed the note.
 */
export const addComment = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    missionId: v.id("missions"),
    body: v.string(),
  },
  returns: vMissionCommentDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const mission = await getMissionInWorkspace(
      ctx,
      args.workspaceId,
      args.missionId,
    );
    const body = boundedString(args.body, "body", { min: 1, max: 4000 });
    const id = await ctx.db.insert("missionComments", {
      workspaceId: args.workspaceId,
      missionId: mission._id,
      authorIdentityKey: identityKey,
      body,
      createdAt: Date.now(),
    });
    await recordActivityEvent(ctx, {
      workspaceId: args.workspaceId,
      missionId: mission._id,
      kind: "comment_added",
      summary: `Comment added on "${mission.title}"`,
      actor: identityKey,
      dedupeKey: `comment:${id}`,
    });
    const comment = await ctx.db.get("missionComments", id);
    if (comment === null) {
      throw domainError("NOT_FOUND", "comment not found");
    }
    return comment;
  },
});

/** Comments for one mission, newest first, cursor-paginated. */
export const listComments = query({
  args: {
    workspaceId: v.id("workspaces"),
    missionId: v.id("missions"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vMissionCommentDoc),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    await getMissionInWorkspace(ctx, args.workspaceId, args.missionId);
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("missionComments")
      .withIndex("by_missionId_and_createdAt", (q) =>
        q.eq("missionId", args.missionId),
      )
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});
