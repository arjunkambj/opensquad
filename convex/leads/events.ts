/**
 * Lead events — the append-only CRM history (§4.3). One row per business
 * fact: stage change, owner assignment, note, next-action set/clear, research
 * and enrichment receipts, and every booking transition.
 *
 * TWO invariants make the history trustworthy:
 *
 *   Atomic with the business update. Every mutation that changes a lead or a
 *   booking inserts its event in the SAME transaction, so the history can
 *   never disagree with the row it describes. `appendLeadEvent` below is the
 *   single write path — the lead mutations and the booking mutations both go through it.
 *
 *   Idempotent by `operationKey`. `(workspaceId, operationKey)` is looked up
 *   in the same transaction as the insert, so a replayed mutation returns the
 *   row it already wrote instead of appending a second one. The read
 *   registers the index range in the transaction's read set — a concurrent
 *   duplicate write conflicts under OCC and retries into the replay branch.
 *   That lookup is ALSO P19's mutation-level idempotency store: the CRM and
 *   booking mutations name their event's key from the caller's `requestId`,
 *   so a client retry replays rather than re-applies (P20's declared design —
 *   `prospects` carries no requestId index of its own).
 *
 * `actor` is a discriminated union: only a `human` actor carries an
 * `identityKey`, and it comes from `ctx.auth` — never from model output or
 * email content.
 */
import { query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { requireWorkspaceMember } from "../lib/auth";
import {
  boundedLimit,
  boundedString,
  domainError,
} from "../lib/validators";
import type {
  LeadEventActor,
  LeadEventDetails,
  LeadEventKind,
  LeadStage,
} from "../lib/validators";
import { leadEventFields } from "../schema";

export const vLeadEventDoc = v.object({
  _id: v.id("leadEvents"),
  _creationTime: v.number(),
  ...leadEventFields,
});

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * The full history of one lead, newest first, cursor-paginated. A prospect in
 * another workspace is NOT_FOUND — the same rule `leads.getDetail`
 * applies to the lead itself.
 */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vLeadEventDoc),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const prospect = await ctx.db.get("prospects", args.prospectId);
    if (prospect === null || prospect.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "prospect not found");
    }
    const result = await ctx.db
      .query("leadEvents")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", args.prospectId),
      )
      .order("desc")
      .paginate({
        numItems: boundedLimit(args.limit),
        cursor: args.cursor ?? null,
      });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});

/* ------------------------------------------------------------------ */
/* The one write path                                                  */
/* ------------------------------------------------------------------ */

/**
 * Append one CRM history row, idempotently. `operationKey` is unique per
 * workspace and the index is a lookup, so the read happens in the SAME
 * transaction as the insert; a replayed mutation returns the row it already
 * wrote instead of appending a second one.
 *
 * Returns `null` when the operationKey already exists — callers that need to
 * distinguish "wrote" from "replayed" (the operator-facing mutations compare
 * the recorded event against the request before deciding whether a replay is
 * honest or a requestId collision) read the row back through
 * `findLeadEventByOperationKey`.
 */
export async function appendLeadEvent(
  ctx: MutationCtx,
  event: {
    workspaceId: Id<"workspaces">;
    prospectId: Id<"prospects">;
    kind: LeadEventKind;
    summary: string;
    operationKey: string;
    fromStage?: LeadStage;
    toStage?: LeadStage;
    bookingId?: Id<"bookings">;
    details?: LeadEventDetails;
    /** Overrides the default `workflow` actor. The ONLY legitimate override
     *  is a `human` carrying an identityKey the backend itself captured from
     *  `ctx.auth`. Model output and email content can never name an actor. */
    actor?: LeadEventActor;
  },
): Promise<Id<"leadEvents"> | null> {
  const operationKey = boundedString(event.operationKey, "operationKey", {
    min: 1,
    max: 200,
  });
  const existing = await findLeadEventByOperationKey(
    ctx,
    event.workspaceId,
    operationKey,
  );
  if (existing !== null) {
    return null;
  }
  return ctx.db.insert("leadEvents", {
    workspaceId: event.workspaceId,
    prospectId: event.prospectId,
    kind: event.kind,
    actor: event.actor ?? { source: "workflow" as const },
    summary: boundedString(event.summary, "summary", { min: 1, max: 500 }),
    createdAt: Date.now(),
    operationKey,
    ...(event.fromStage !== undefined ? { fromStage: event.fromStage } : {}),
    ...(event.toStage !== undefined ? { toStage: event.toStage } : {}),
    ...(event.bookingId !== undefined ? { bookingId: event.bookingId } : {}),
    ...(event.details !== undefined ? { details: event.details } : {}),
  });
}

/**
 * The idempotency read every CRM/booking mutation performs BEFORE its version
 * check: a committed operation replays to the recorded event even though the
 * row's version has since moved past the one the retry still carries.
 */
export async function findLeadEventByOperationKey(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  operationKey: string,
): Promise<Doc<"leadEvents"> | null> {
  return await ctx.db
    .query("leadEvents")
    .withIndex("by_workspaceId_and_operationKey", (q) =>
      q.eq("workspaceId", workspaceId).eq("operationKey", operationKey),
    )
    .unique();
}
