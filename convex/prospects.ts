/**
 * Prospects — the person-level lead (`prospects` is the backend name; the UI
 * says Contacts). PLAN §7.
 *
 * What lives here after the pivot: the read surface the Contacts table and
 * the lead drawer use, lead approval (PLAN §9.3), notes, and the two
 * provider-fact derivations the send and inbox boundaries call. Sourcing,
 * pre-ranking, research and email reveal are the agent run's (T30) and the
 * contacts surface's (T31); nothing in this file spends money or schedules
 * work.
 *
 * Three rules govern every write below:
 *
 *   `stage` + `nextActionAt` is the whole state machine (PLAN §7). An
 *   automatic transition may only move a lead forward
 *   (`advancedLeadStage`), and it never enters or leaves `closed_lost` /
 *   `rejected`, nor un-parks a lead sitting in `needs_attention`.
 *
 *   Lead approval is not email approval (PLAN §9.3). Approving here says
 *   "yes, contact this person" — it authorises finding the address and
 *   drafting. Approving the text of one message is an `approvals` row.
 *
 *   `lastContactedAt` comes ONLY from a send acceptance and `lastReplyAt`
 *   ONLY from a verified inbound reply. Drafting a message is not contacting
 *   anyone.
 *
 * Every business update and its `leadEvents` row are written in ONE
 * transaction, so the history can never disagree with the lead.
 */
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireWorkspaceEditor, requireWorkspaceMember } from "./lib/auth";
import { vEvidenceDoc } from "./evidence";
import {
  appendLeadEvent,
  findLeadEventByOperationKey,
  vLeadEventDoc,
} from "./leadEvents";
import { vBookingDoc } from "./bookings";
import {
  advancedLeadStage,
  assertEpochMs,
  boundedLimit,
  boundedString,
  domainError,
  invalid,
  vLeadApproval,
  vLeadStage,
  DEFAULT_LIST_LIMIT,
  EPOCH_MS_MIN,
  LEAD_EVENT_NOTE_MAX_LENGTH,
  MAX_LIST_LIMIT,
  PROSPECT_COMPANY_NAME_MAX_LENGTH,
  PROSPECT_STAGE_REASON_MAX_LENGTH,
} from "./lib/validators";
import type { LeadApproval, LeadStage } from "./lib/validators";
import { prospectFields } from "./schema";

export const vProspectDoc = v.object({
  _id: v.id("prospects"),
  _creationTime: v.number(),
  ...prospectFields,
});

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

const vListPage = v.object({
  items: v.array(vProspectDoc),
  cursor: v.union(v.string(), v.null()),
  hasMore: v.boolean(),
});

type ListPageArgs = {
  workspaceId: Id<"workspaces">;
  stage?: LeadStage;
  approval?: LeadApproval;
  dueRange?: { from?: number; to?: number };
  unscheduled?: boolean;
  topScoreFirst?: boolean;
  cursor?: string | null;
  limit?: number;
};

/**
 * Every list mode is an exact index range — never a post-filtered page. The
 * modes and the index behind each:
 *
 *   due (`dueRange`): soonest-due first on `by_workspaceId_and_nextActionAt`.
 *   A lead with no due time cannot satisfy a range bound, so this mode never
 *   hides one behind a page that looks filtered — it appears in the default
 *   and `unscheduled` modes instead.
 *
 *   unscheduled: the complementary slice — leads with NO `nextActionAt`.
 *
 *   score (`topScoreFirst`): best leads first on
 *   `by_workspaceId_and_scoreKey`. `scoreKey` is the denormalised mirror of
 *   `research.aiScore`; unresearched leads have none and sort below, which is
 *   exactly the "scored first, the rest one click away" order of PLAN §3.
 *
 *   stage / approval: the Contacts filters, each on its own index.
 *
 *   default: the whole workspace by next-action time, most recent first.
 *
 * Unsupported combinations REFUSE rather than silently post-filter: the
 * schema declares an index per enabled combination, and a filter pair with no
 * index is added deliberately or not at all.
 */
async function listPage(
  ctx: QueryCtx,
  args: ListPageArgs,
): Promise<typeof vListPage.type> {
  const paginate = {
    numItems: boundedLimit(args.limit),
    cursor: args.cursor ?? null,
  };
  const exclusive = [
    args.stage !== undefined,
    args.approval !== undefined,
    args.dueRange !== undefined,
    args.unscheduled === true,
    args.topScoreFirst === true,
  ].filter(Boolean).length;
  if (exclusive > 1) {
    throw invalid(
      "stage, approval, dueRange, unscheduled and topScoreFirst are separate list modes — no index supports combining them",
    );
  }

  if (args.unscheduled === true) {
    // `undefined` sorts below every bound on this index, and every stored
    // `nextActionAt` is ≥ EPOCH_MS_MIN, so `lt(EPOCH_MS_MIN)` names exactly
    // the rows with no due time — the unscheduled state as a first-class
    // slice rather than a sentinel date the reader has to know about.
    const result = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_nextActionAt", (q) =>
        q.eq("workspaceId", args.workspaceId).lt("nextActionAt", EPOCH_MS_MIN),
      )
      .order("desc")
      .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  if (args.dueRange !== undefined) {
    const from =
      args.dueRange.from === undefined
        ? undefined
        : assertEpochMs(args.dueRange.from, "dueRange.from");
    const to =
      args.dueRange.to === undefined
        ? undefined
        : assertEpochMs(args.dueRange.to, "dueRange.to");
    if (from !== undefined && to !== undefined && from > to) {
      throw invalid("dueRange.from must not be after dueRange.to");
    }
    // A lead with NO `nextActionAt` stores `undefined` in the index, which
    // sorts below every bound — `lte(to)` alone would return undated leads as
    // "due". The lower bound is therefore always present: the caller's
    // `from`, or 0 meaning "has a due date at all".
    const lower = from ?? 0;
    const result = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_nextActionAt", (q) => {
        const scoped = q
          .eq("workspaceId", args.workspaceId)
          .gte("nextActionAt", lower);
        return to === undefined ? scoped : scoped.lte("nextActionAt", to);
      })
      .order("asc")
      .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  if (args.topScoreFirst === true) {
    const result = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_scoreKey", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .order("desc")
      .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  const approval = args.approval;
  if (approval !== undefined) {
    const result = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_approval", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("approval", approval),
      )
      .order("desc")
      .paginate(paginate);
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  }

  const stage = args.stage;
  const result =
    stage !== undefined
      ? await ctx.db
          .query("prospects")
          .withIndex("by_workspaceId_and_stage_and_updatedAt", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("stage", stage),
          )
          .order("desc")
          .paginate(paginate)
      : await ctx.db
          .query("prospects")
          .withIndex("by_workspaceId_and_nextActionAt", (q) =>
            q.eq("workspaceId", args.workspaceId),
          )
          .order("desc")
          .paginate(paginate);
  return {
    items: result.page,
    cursor: result.isDone ? null : result.continueCursor,
    hasMore: !result.isDone,
  };
}

/** Leads in one workspace — see `listPage` for the supported index modes. */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    stage: v.optional(vLeadStage),
    approval: v.optional(vLeadApproval),
    /** Due mode: a bounded `nextActionAt` range (either bound may be
     *  omitted; `{}` lists every lead that HAS a due date). */
    dueRange: v.optional(
      v.object({
        from: v.optional(v.number()),
        to: v.optional(v.number()),
      }),
    ),
    /** The complementary due slice: leads with NO `nextActionAt`. */
    unscheduled: v.optional(v.boolean()),
    /** Best score first; unresearched leads sort last. */
    topScoreFirst: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: vListPage,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await listPage(ctx, args);
  },
});

/**
 * How many leads the state machine owes work to right now — the attention
 * count the app header renders. Bounded at `MAX_LIST_LIMIT` like every
 * workspace count: `hasMore` means the number is the bound, not the total, so
 * the UI renders "50+". Leads with no due time can never satisfy the range,
 * so they can never inflate it either.
 */
export const countDue = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({
    count: v.number(),
    hasMore: v.boolean(),
    bound: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const now = Date.now();
    const rows = await ctx.db
      .query("prospects")
      .withIndex("by_workspaceId_and_nextActionAt", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .gte("nextActionAt", 0)
          .lte("nextActionAt", now),
      )
      .take(MAX_LIST_LIMIT + 1);
    return {
      count: Math.min(rows.length, MAX_LIST_LIMIT),
      hasMore: rows.length > MAX_LIST_LIMIT,
      bound: MAX_LIST_LIMIT,
    };
  },
});

/**
 * Company-name search through the declared `search_company_name` index.
 * Equality filters (`stage`, `approval`) are applied INSIDE `withSearchIndex`
 * — the only fields the index declares — and pagination follows the engine's
 * relevance order. Empty text falls back to the ordinary list, so the table
 * never has to switch calls.
 */
export const search = query({
  args: {
    workspaceId: v.id("workspaces"),
    text: v.string(),
    stage: v.optional(vLeadStage),
    approval: v.optional(vLeadApproval),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: vListPage,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const text = boundedString(args.text, "text", {
      max: PROSPECT_COMPANY_NAME_MAX_LENGTH,
    }).trim();
    if (text === "") {
      return await listPage(ctx, args);
    }
    const result = await ctx.db
      .query("prospects")
      .withSearchIndex("search_company_name", (q) => {
        let scoped = q
          .search("companyName", text)
          .eq("workspaceId", args.workspaceId);
        if (args.stage !== undefined) {
          scoped = scoped.eq("stage", args.stage);
        }
        if (args.approval !== undefined) {
          scoped = scoped.eq("approval", args.approval);
        }
        return scoped;
      })
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

/**
 * One lead with the evidence behind it, its bookings and the history that
 * produced it. A row in another workspace is NOT_FOUND, never FORBIDDEN.
 */
export const getDetail = query({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
  },
  returns: v.object({
    prospect: vProspectDoc,
    evidence: v.array(vEvidenceDoc),
    events: v.array(vLeadEventDoc),
    bookings: v.array(vBookingDoc),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const prospect = await ctx.db.get("prospects", args.prospectId);
    if (prospect === null || prospect.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "prospect not found");
    }
    const evidence = await ctx.db
      .query("evidence")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", args.prospectId),
      )
      .order("desc")
      .take(DEFAULT_LIST_LIMIT);
    const events = await ctx.db
      .query("leadEvents")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", args.prospectId),
      )
      .order("desc")
      .take(DEFAULT_LIST_LIMIT);
    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_prospectId_and_createdAt", (q) =>
        q.eq("prospectId", args.prospectId),
      )
      .order("desc")
      .take(DEFAULT_LIST_LIMIT);
    return { prospect, evidence, events, bookings };
  },
});

/* ------------------------------------------------------------------ */
/* Shared write helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Load a lead for a write. A missing row and a row in another workspace are
 * the same NOT_FOUND — the read must never reveal another workspace's data.
 */
async function loadProspectForWrite(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  prospectId: Id<"prospects">,
): Promise<Doc<"prospects">> {
  const prospect = await ctx.db.get("prospects", prospectId);
  if (prospect === null || prospect.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "prospect not found");
  }
  return prospect;
}

/** Re-read a patched lead; absence inside the writing transaction is a defect. */
async function reread(
  ctx: MutationCtx,
  prospectId: Id<"prospects">,
): Promise<Doc<"prospects">> {
  const row = await ctx.db.get("prospects", prospectId);
  if (row === null) {
    throw domainError("NOT_FOUND", "prospect not found after write");
  }
  return row;
}

/* ------------------------------------------------------------------ */
/* Lead approval (PLAN §9.3)                                           */
/* ------------------------------------------------------------------ */

/**
 * "Yes, contact this person" — or "no, never".
 *
 * This authorises finding the address and drafting; it sends nothing. The
 * email itself is approved separately, per draft, in `approvals`.
 *
 * Rejecting also moves the lead to the `rejected` stage and clears
 * `nextActionAt`, so the state machine stops offering it work. Per PLAN §9.1
 * a rejection stops only what has NOT started and never refunds by itself:
 * cancelling queued steps and superseding open drafts belongs to the outreach
 * loop (T40), which owns those rows.
 *
 * `requestId` dedupes through the lead-event index, so a double-clicked
 * Approve records one decision and returns it.
 */
export const setApproval = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    approval: vLeadApproval,
    /** Required on a rejection: a refusal always states its basis. */
    reason: v.optional(v.string()),
    requestId: v.string(),
  },
  returns: vProspectDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    if (args.approval === "pending") {
      throw invalid("approval cannot be set back to pending");
    }
    const reason =
      args.reason === undefined
        ? undefined
        : boundedString(args.reason, "reason", {
            min: 1,
            max: PROSPECT_STAGE_REASON_MAX_LENGTH,
          });
    const prospect = await loadProspectForWrite(
      ctx,
      args.workspaceId,
      args.prospectId,
    );
    const operationKey = `lead:${args.prospectId}:approval:${requestId}`;
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.workspaceId,
      operationKey,
    );
    if (prior !== null) {
      if (prior.details?.toApproval !== args.approval) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded a different decision`,
        );
      }
      return prospect;
    }
    if (prospect.approval === args.approval) {
      // Already decided the same way — a deliberate no-op, not a new event.
      return prospect;
    }

    const now = Date.now();
    const rejected = args.approval === "rejected";
    await ctx.db.patch("prospects", prospect._id, {
      approval: args.approval,
      approvedBy: "user",
      updatedAt: now,
      ...(reason !== undefined ? { stageReason: reason } : {}),
      // A rejected lead leaves the pipeline and stops being due for work.
      ...(rejected ? { stage: "rejected" as const, nextActionAt: undefined } : {}),
    });
    await appendLeadEvent(ctx, {
      workspaceId: prospect.workspaceId,
      prospectId: prospect._id,
      kind: "approval_changed",
      summary: rejected ? "Lead rejected" : "Lead approved for outreach",
      operationKey,
      actor: { source: "human", identityKey },
      ...(rejected && prospect.stage !== "rejected"
        ? { fromStage: prospect.stage, toStage: "rejected" as const }
        : {}),
      details: {
        fromApproval: prospect.approval,
        toApproval: args.approval,
        approvalActor: "user",
        ...(reason !== undefined ? { reason } : {}),
      },
    });
    return reread(ctx, prospect._id);
  },
});

/**
 * Append a note to the lead's history. A note IS the event — the lead row is
 * untouched (no `updatedAt` move), so annotating a lead can never reorder a
 * Contacts view. `requestId` dedupes the append: a retried note returns the
 * row it already wrote, and the same requestId carrying a different body is a
 * CONFLICT.
 */
export const addNote = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
    body: v.string(),
    requestId: v.string(),
  },
  returns: vLeadEventDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const note = boundedString(args.body, "body", {
      min: 1,
      max: LEAD_EVENT_NOTE_MAX_LENGTH,
    });
    await loadProspectForWrite(ctx, args.workspaceId, args.prospectId);
    const operationKey = `lead:${args.prospectId}:note:${requestId}`;
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.workspaceId,
      operationKey,
    );
    if (prior !== null) {
      if (prior.details?.note !== note) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded a different note`,
        );
      }
      return prior;
    }
    const eventId = await appendLeadEvent(ctx, {
      workspaceId: args.workspaceId,
      prospectId: args.prospectId,
      kind: "note_added",
      summary: "Note added by a team member",
      operationKey,
      actor: { source: "human", identityKey },
      details: { note },
    });
    if (eventId === null) {
      throw domainError("CONFLICT", "note operation key already recorded");
    }
    const event = await ctx.db.get("leadEvents", eventId);
    if (event === null) {
      throw domainError("NOT_FOUND", "lead event not found after insert");
    }
    return event;
  },
});

/* ------------------------------------------------------------------ */
/* Provider-fact derivations                                           */
/* ------------------------------------------------------------------ */

/**
 * THE contacted / meeting_proposed derivation — called by `sending.ts`
 * exactly once per provider-acknowledged send, inside the outcome
 * transaction. It is deliberately non-throwing: a broken association must
 * never roll back the acceptance record the send boundary just committed; it
 * simply records less.
 *
 * What it records, all in one patch:
 *   `lastContactedAt` — the monotonic max of every accepted send.
 *   `contacted` — when the lead has not already advanced past it.
 *   `meeting_proposed` — ONLY when the sent draft carries a live
 *   `bookingId`/`bookingVersion` link that still resolves to a `proposed`
 *   booking on this lead. A stale or moved booking is skipped — the send
 *   itself is still a contact. A meeting is BOOKED only by the user
 *   (PLAN §9.5); nothing here can set that stage.
 *
 * A `send_accepted` event is written per attempt; a stage event is written
 * only when the stage actually moved.
 */
export const markSendAccepted = internalMutation({
  args: {
    sendAttemptId: v.id("sendAttempts"),
    at: v.number(),
  },
  returns: v.object({
    applied: v.boolean(),
    stage: v.optional(vLeadStage),
  }),
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null) {
      return { applied: false };
    }
    const conversation = await ctx.db.get(
      "conversations",
      attempt.conversationId,
    );
    if (conversation === null || conversation.prospectId === undefined) {
      return { applied: false };
    }
    const prospect = await ctx.db.get("prospects", conversation.prospectId);
    if (prospect === null || prospect.workspaceId !== attempt.workspaceId) {
      return { applied: false };
    }
    const draft = await ctx.db.get("drafts", attempt.draftId);

    // The booking link the dispatch gate already validated — re-checked here
    // because a confirm/reschedule could have landed between the two.
    let booking: Doc<"bookings"> | null = null;
    if (draft !== null && draft.bookingId !== undefined) {
      const linked = await ctx.db.get("bookings", draft.bookingId);
      if (
        linked !== null &&
        linked.workspaceId === prospect.workspaceId &&
        linked.prospectId === prospect._id &&
        linked.state === "proposed" &&
        linked.version === draft.bookingVersion
      ) {
        booking = linked;
      }
    }

    const now = Date.now();
    const nextStage = advancedLeadStage(
      prospect.stage,
      booking !== null ? "meeting_proposed" : "contacted",
    );
    const moved = nextStage !== prospect.stage;
    await ctx.db.patch("prospects", prospect._id, {
      lastContactedAt: Math.max(prospect.lastContactedAt ?? 0, args.at),
      updatedAt: now,
      ...(moved
        ? {
            stage: nextStage,
            stageReason:
              booking !== null
                ? "Booking proposal send accepted by the provider"
                : "Outbound send accepted by the provider",
          }
        : {}),
    });
    // `booking` is only set when the linked draft exists — the narrowed
    // `draft !== null` here is what that implication looks like to the
    // checker.
    if (booking !== null && draft !== null) {
      await ctx.db.patch("bookings", booking._id, {
        ...(booking.conversationId === undefined
          ? { conversationId: conversation._id }
          : {}),
        ...(booking.draftId === undefined ? { draftId: draft._id } : {}),
        updatedAt: now,
      });
    }
    await appendLeadEvent(ctx, {
      workspaceId: prospect.workspaceId,
      prospectId: prospect._id,
      kind: "send_accepted",
      summary: `Outbound send accepted by the provider (attempt ${attempt._id})`,
      operationKey: `lead:${prospect._id}:send-accepted:${attempt._id}`,
      ...(booking !== null ? { bookingId: booking._id } : {}),
    });
    if (moved) {
      await appendLeadEvent(ctx, {
        workspaceId: prospect.workspaceId,
        prospectId: prospect._id,
        kind: booking !== null ? "booking_proposed" : "stage_changed",
        summary:
          booking !== null
            ? "Booking proposal delivered — lead is meeting_proposed"
            : `Stage ${prospect.stage} → ${nextStage}`,
        operationKey:
          // Keyed per ATTEMPT, not per booking: a human can pull the stage
          // back down and a second send carrying the same live booking link
          // must still record its re-advance — the row and the append-only
          // history can never disagree. True replays still dedupe because
          // one attempt writes this key at most once.
          booking !== null
            ? `lead:${prospect._id}:booking-sent:${booking._id}:${attempt._id}`
            : `lead:${prospect._id}:contacted:${attempt._id}`,
        fromStage: prospect.stage,
        toStage: nextStage,
        ...(booking !== null ? { bookingId: booking._id } : {}),
      });
    }
    return { applied: true, stage: nextStage };
  },
});

/**
 * THE replied derivation — called by `inbox.ts` once per verified inbound on
 * a conversation already linked to a lead, and by
 * `conversations.associateProspect` when a held thread is bound. Keyed on the
 * provider message ref so a replayed receipt dedupes rather than double-
 * counting. Non-throwing like `markSendAccepted`: a reply fact must never
 * roll back the receipt that carries it.
 *
 * Clearing `nextActionAt` is the accounting-free half of PLAN §9.1's "a reply
 * arrives → follow-ups for that conversation cancelled in the same mutation
 * that stores the reply": the lead stops being due, so no further follow-up
 * step is ever selected for it. Superseding an unsent draft is the outreach
 * loop's (T40), which owns `drafts`.
 */
export const markReplied = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageRef: v.string(),
    at: v.number(),
  },
  returns: v.object({
    applied: v.boolean(),
    stage: v.optional(vLeadStage),
  }),
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null || conversation.prospectId === undefined) {
      return { applied: false };
    }
    const prospect = await ctx.db.get("prospects", conversation.prospectId);
    if (prospect === null || prospect.workspaceId !== conversation.workspaceId) {
      return { applied: false };
    }
    const messageRef = boundedString(args.messageRef, "messageRef", {
      min: 1,
      max: 300,
    });
    const operationKey = `lead:${prospect._id}:replied:${messageRef}`;
    const prior = await findLeadEventByOperationKey(
      ctx,
      prospect.workspaceId,
      operationKey,
    );
    if (prior !== null) {
      return { applied: true, stage: prospect.stage };
    }
    const now = Date.now();
    const nextStage = advancedLeadStage(prospect.stage, "replied");
    const moved = nextStage !== prospect.stage;
    await ctx.db.patch("prospects", prospect._id, {
      lastReplyAt: Math.max(prospect.lastReplyAt ?? 0, args.at),
      nextActionAt: undefined,
      updatedAt: now,
      ...(moved
        ? {
            stage: nextStage,
            stageReason: "Verified inbound reply on the linked conversation",
          }
        : {}),
    });
    await appendLeadEvent(ctx, {
      workspaceId: prospect.workspaceId,
      prospectId: prospect._id,
      kind: "reply_received",
      summary: "Verified inbound reply recorded on the linked conversation",
      operationKey,
    });
    if (moved) {
      await appendLeadEvent(ctx, {
        workspaceId: prospect.workspaceId,
        prospectId: prospect._id,
        kind: "stage_changed",
        summary: `Stage ${prospect.stage} → replied`,
        operationKey: `lead:${prospect._id}:stage-replied:${messageRef}`,
        fromStage: prospect.stage,
        toStage: nextStage,
      });
    }
    return { applied: true, stage: nextStage };
  },
});
