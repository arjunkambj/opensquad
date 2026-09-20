/**
 * Approvals — owner/operator resolution of a draft (architecture §4.3/§8,
 * verification V13).
 *
 * `approve` / `requestChanges` / `reject` are three DISTINCT operations. The
 * verdict written on the approvals row is `approved` or `rejected`;
 * `requestChanges` records `rejected` (this exact content is not approved)
 * while `draftResolution` carries the caller-visible distinction
 * (`changes_requested` → redraft, `rejected` → intentional terminal
 * rejection).
 *
 * Send authorization is NOT granted here: the send boundary re-runs the full
 * preflight immediately before dispatch, and only an `approved` approvals row
 * matching the live draft/context satisfies the "exact approval" gate.
 */
import { internal } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { requireWorkspaceMember } from "../lib/auth";
import { boundedLimit, boundedString, domainError } from "../lib/validators";
import { approvalFields } from "../schema";
import { resolveDraft } from "./approvalsModel";
import { v } from "convex/values";

export const vApprovalDoc = v.object({
  _id: v.id("approvals"),
  _creationTime: v.number(),
  ...approvalFields,
});

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
        internal.outreach.sendActions.sendApprovedDraft,
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
