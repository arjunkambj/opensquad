/**
 * Approvals — owner/operator resolution of a draft (architecture §4.3/§8,
 * verification V13).
 *
 * `approve` / `requestChanges` / `reject` are three DISTINCT operations; all
 * of them (a) dedupe on (workspaceId, requestId) through the approvals table,
 * (b) bind the exact draft revision — payload hash, normalized recipient,
 * current-draft pointer and conversation context version — then (c) write one
 * immutable `approvals` row.
 *
 * The verdict written on the approvals row is `approved` or `rejected`;
 * `requestChanges` records `rejected` (this exact content is not approved)
 * while `draftResolution` carries the caller-visible distinction
 * (`changes_requested` → redraft, `rejected` → intentional terminal
 * rejection). Stale approvals fail `CONFLICT` rather than silently applying to
 * newer content.
 *
 * Send authorization is NOT granted here: `sending.ts` re-runs the full
 * preflight immediately before dispatch, and only an `approved` approvals
 * row matching the live draft/context satisfies the "exact approval" gate.
 */
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  requireWorkspaceEditor,
  requireWorkspaceMember,
} from "./lib/auth";
import {
  boundedLimit,
  boundedString,
  domainError,
} from "./lib/validators";
import type { ApprovalVerdict, DraftResolution } from "./lib/validators";
import { recordActivityEvent } from "./activity/model";
import { approvalFields } from "./schema";

export const vApprovalDoc = v.object({
  _id: v.id("approvals"),
  _creationTime: v.number(),
  ...approvalFields,
});

/* ------------------------------------------------------------------ */
/* Public reads                                                        */
/* ------------------------------------------------------------------ */

/** One approval row; foreign or cross-workspace IDs return `NOT_FOUND`. */
export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    approvalId: v.id("approvals"),
  },
  returns: vApprovalDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const approval = await ctx.db.get("approvals", args.approvalId);
    if (approval === null || approval.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "approval not found");
    }
    return approval;
  },
});

/** All verdicts recorded against one draft revision, oldest first. */
export const listForDraft = query({
  args: {
    workspaceId: v.id("workspaces"),
    draftId: v.id("drafts"),
    limit: v.optional(v.number()),
  },
  returns: v.array(vApprovalDoc),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const draft = await ctx.db.get("drafts", args.draftId);
    if (draft === null || draft.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "draft not found");
    }
    return await ctx.db
      .query("approvals")
      .withIndex("by_draftId", (q) => q.eq("draftId", args.draftId))
      .take(boundedLimit(args.limit));
  },
});

/* ------------------------------------------------------------------ */
/* Resolution core                                                     */
/* ------------------------------------------------------------------ */

type ResolveInput = {
  workspaceId: Id<"workspaces">;
  draftId: Id<"drafts">;
  requestId: string;
  verdict: ApprovalVerdict;
  /** The caller-visible distinction between a redraft request and a
   *  deliberate terminal rejection. */
  draftResolution: DraftResolution;
  /** Human-readable comment/reason — required for non-approvals. */
  body?: string;
};

/**
 * Shared resolution path for all three operations. The whole flow — dedupe
 * check, draft/context binding checks and the approval insert — runs in ONE
 * transaction.
 */
async function resolveDraft(
  ctx: MutationCtx,
  args: ResolveInput,
): Promise<{ approval: Doc<"approvals">; replayed: boolean }> {
  const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
  const requestId = boundedString(args.requestId, "requestId", {
    min: 1,
    max: 100,
  });

  const draft = await ctx.db.get("drafts", args.draftId);
  if (draft === null || draft.workspaceId !== args.workspaceId) {
    throw domainError("NOT_FOUND", "draft not found");
  }

  // Idempotent replay — the recorded row is returned verbatim, so the
  // activity feed stays unique. The dedupe is bound to THIS draft: reusing
  // the same requestId against a different revision must surface a CONFLICT,
  // not silently return a verdict recorded for unrelated content.
  const prior = await ctx.db
    .query("approvals")
    .withIndex("by_workspaceId_and_requestId", (q) =>
      q.eq("workspaceId", args.workspaceId).eq("requestId", requestId),
    )
    .unique();
  if (prior !== null) {
    if (prior.draftId !== draft._id) {
      throw domainError(
        "CONFLICT",
        `requestId ${requestId} was already used to resolve a different draft`,
      );
    }
    if (prior.decision !== args.verdict) {
      throw domainError(
        "CONFLICT",
        `requestId ${requestId} already recorded a "${prior.decision}" verdict`,
      );
    }
    return { approval: prior, replayed: true };
  }

  const conversation = await ctx.db.get("conversations", draft.conversationId);
  if (conversation === null) {
    throw domainError("NOT_FOUND", "conversation not found");
  }
  // Exact-draft binding (§8): the draft is answerable only while this
  // revision is still current and no inbound/context change has moved the
  // conversation past the version the draft was written against.
  if (
    conversation.currentDraftId !== draft._id ||
    draft.supersededAt !== undefined
  ) {
    throw domainError(
      "CONFLICT",
      "the bound draft revision is no longer the conversation's current draft",
    );
  }
  if (conversation.contextVersion !== draft.basedOnContextVersion) {
    throw domainError(
      "CONFLICT",
      "conversation context changed since this draft was written — revise or redraft first",
    );
  }
  // §4.3: a booking-linked draft is approved ONLY while the proposal it names
  // is still live at the exact version the content was written against. A
  // confirmed/rescheduled/cancelled booking means the mailed times or link
  // are no longer the offer on the table — approving this revision would
  // authorize content that no longer matches the agreement. The dispatch
  // preflight runs the same check a second time before any wire call.
  if (draft.bookingId !== undefined) {
    const booking = await ctx.db.get("bookings", draft.bookingId);
    if (booking === null || booking.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "booking not found");
    }
    if (
      booking.state !== "proposed" ||
      booking.version !== draft.bookingVersion ||
      booking.prospectId !== conversation.prospectId
    ) {
      throw domainError(
        "CONFLICT",
        `linked booking ${booking._id} is ${booking.state} at version ${booking.version}; this draft proposed it at version ${draft.bookingVersion} — draft a fresh proposal`,
      );
    }
  }

  const now = Date.now();
  const approvalId = await ctx.db.insert("approvals", {
    workspaceId: args.workspaceId,
    // This module is the HUMAN approval path; Autopilot writes its own row
    // with `actor: "autopilot"` through the outreach loop (PLAN §9.3).
    actor: "user",
    draftId: draft._id,
    draftRevision: draft.revision,
    payloadHash: draft.payloadHash,
    normalizedRecipient: draft.normalizedRecipient,
    contextVersion: conversation.contextVersion,
    decision: args.verdict,
    approverIdentityKey: identityKey,
    createdAt: now,
    requestId,
  });
  const approval = await ctx.db.get("approvals", approvalId);
  if (approval === null) {
    throw domainError("NOT_FOUND", "approval not found after insert");
  }

  const verb =
    args.draftResolution === "approved"
      ? "approved"
      : args.draftResolution === "changes_requested"
        ? "requested changes on"
        : "rejected";
  await recordActivityEvent(ctx, {
    workspaceId: args.workspaceId,
    kind: "approval_recorded",
    summary:
      `Draft revision ${draft.revision} ${verb} by an authorized ` +
      `reviewer (payload ${draft.payloadHash.slice(0, 12)}…)`,
    actor: identityKey,
    dedupeKey: `approval:${approval._id}:recorded`,
    conversationId: conversation._id,
  });
  return { approval, replayed: false };
}

/* ------------------------------------------------------------------ */
/* The three distinct owner/operator operations                        */
/* ------------------------------------------------------------------ */

/**
 * Approve the exact draft revision. Produces an `approved` approvals row —
 * the ONLY record that can satisfy the send preflight's exact-draft gate.
 * `comment` is optional review context.
 */
export const approve = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    draftId: v.id("drafts"),
    requestId: v.string(),
    comment: v.optional(v.string()),
  },
  returns: v.object({
    approval: vApprovalDoc,
    replayed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await resolveDraft(ctx, {
      workspaceId: args.workspaceId,
      draftId: args.draftId,
      requestId: args.requestId,
      verdict: "approved",
      draftResolution: "approved",
      body:
        args.comment === undefined
          ? undefined
          : boundedString(args.comment, "comment", { min: 1, max: 2000 }),
    });
    // Approval wakes the send boundary: schedule one dispatch; the boundary
    // re-runs EVERY gate fresh (§8 — approval alone never sends). Safe to
    // schedule on replay too, but skipped for cleanliness — the attempt
    // already exists.
    if (!result.replayed) {
      await ctx.scheduler.runAfter(
        0,
        internal.sending.sendApprovedDraft,
        { draftId: result.approval.draftId },
      );
    }
    return result;
  },
});

/**
 * Request changes — records NOT approved with a required comment describing
 * what must change. The approvals row records an immutable `rejected` verdict
 * for this exact content; `changes_requested` is the caller-visible signal to
 * redraft.
 */
export const requestChanges = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    draftId: v.id("drafts"),
    requestId: v.string(),
    comment: v.string(),
  },
  returns: v.object({
    approval: vApprovalDoc,
    replayed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const comment = boundedString(args.comment, "comment", {
      min: 1,
      max: 2000,
    });
    return await resolveDraft(ctx, {
      workspaceId: args.workspaceId,
      draftId: args.draftId,
      requestId: args.requestId,
      verdict: "rejected",
      draftResolution: "changes_requested",
      body: comment,
    });
  },
});

/**
 * Reject the exact draft revision with a required reason — the deliberate
 * terminal "do not send this" verdict.
 */
export const reject = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    draftId: v.id("drafts"),
    requestId: v.string(),
    reason: v.string(),
  },
  returns: v.object({
    approval: vApprovalDoc,
    replayed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const reason = boundedString(args.reason, "reason", {
      min: 1,
      max: 2000,
    });
    return await resolveDraft(ctx, {
      workspaceId: args.workspaceId,
      draftId: args.draftId,
      requestId: args.requestId,
      verdict: "rejected",
      draftResolution: "rejected",
      body: reason,
    });
  },
});
