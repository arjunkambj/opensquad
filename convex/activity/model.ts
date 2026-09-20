/**
 * Workspace activity feed — architecture §4.2/§5.
 *
 * This domain owns the deduped receipt trail: `recordActivityEvent` is THE
 * write path, and every meaningful step lands here with a workspace-unique
 * `dedupeKey` so a replayed callback inserts nothing twice. It owns no
 * business rule of its own — callers decide what is worth recording.
 */
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { boundedString, domainError } from "../lib/validators";
import type { GenericDatabaseWriter } from "convex/server";

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
