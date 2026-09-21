/**
 * Human approval of an exact draft revision.
 *
 * Send authorization is NOT granted here: the send boundary re-runs the full
 * preflight immediately before dispatch, and only an `approved` approvals row
 * matching the live draft/context satisfies the "exact approval" gate.
 */
import { internal } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import { boundedLimit, domainError } from "../lib/validators";
import { approvalFields } from "../schema";
import { approveDraft } from "./approvalsModel";
import { v } from "convex/values";

export const vApprovalDoc = v.object({
  _id: v.id("approvals"),
  _creationTime: v.number(),
  ...approvalFields,
});

/** All verdicts recorded against one draft revision, oldest first. */
export const listForDraft = query({
  args: {
    orgId: v.id("orgs"),
    draftId: v.id("drafts"),
    limit: v.optional(v.number()),
  },
  returns: v.array(vApprovalDoc),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const draft = await ctx.db.get("drafts", args.draftId);
    if (draft === null || draft.orgId !== args.orgId) {
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
 */
export const approve = mutation({
  args: {
    orgId: v.id("orgs"),
    draftId: v.id("drafts"),
    requestId: v.string(),
  },
  returns: v.object({
    approval: vApprovalDoc,
    replayed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await approveDraft(ctx, args);
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
