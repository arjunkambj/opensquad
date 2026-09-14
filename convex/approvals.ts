/**
 * Approvals — owner/operator resolution of `draft_approval` decisions
 * (architecture §4.3/§8, verification V13).
 *
 * `approve` / `requestChanges` / `reject` are three DISTINCT operations; all
 * of them (a) check the decision's expectedVersion, (b) dedupe on
 * (workspaceId, requestId) through the approvals table, (c) bind the exact
 * draft revision — payload hash, normalized recipient, current-draft pointer
 * and conversation context version — then (d) write one immutable
 * `approvals` row and (e) resolve the decision through `decisions.resolveBound`
 * (P06's single resolution path: it also delivers the workflow continuation
 * transactionally).
 *
 * The verdict written on the approvals row is `approved` or `rejected`;
 * `requestChanges` records `rejected` (this exact content is not approved)
 * while the decision answer's `fields.draftResolution` carries the
 * workflow-visible distinction (`changes_requested` → redraft, `rejected` →
 * intentional terminal rejection). Stale approvals fail `CONFLICT` rather
 * than silently applying to newer content.
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
  invalid,
} from "./lib/validators";
import type { ApprovalVerdict, DraftResolution } from "./lib/validators";
import { recordActivityEvent } from "./activity";
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
  decisionId: Id<"decisions">;
  expectedVersion: number;
  requestId: string;
  verdict: ApprovalVerdict;
  /** Carried on `answer.fields.draftResolution` for the waiting workflow. */
  draftResolution: DraftResolution;
  /** Human-readable comment/reason — required for non-approvals. */
  body?: string;
};

/**
 * Shared resolution path for all three operations. The whole flow — dedupe
 * check, draft/context binding checks, approval insert, decision resolution
 * and the `approvalId` link — runs in ONE transaction; the nested
 * `decisions.resolveBound` re-validates `expectedVersion` and rejects a
 * second/different resolution of the same decision.
 */
async function resolveDraftDecision(
  ctx: MutationCtx,
  args: ResolveInput,
): Promise<{ approval: Doc<"approvals">; replayed: boolean }> {
  const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
  const requestId = boundedString(args.requestId, "requestId", {
    min: 1,
    max: 100,
  });

  const decision = await ctx.db.get("decisions", args.decisionId);
  if (decision === null || decision.workspaceId !== args.workspaceId) {
    throw domainError("NOT_FOUND", "decision not found");
  }
  if (decision.kind !== "draft_approval") {
    throw invalid("decision is not a draft approval ask");
  }

  // Idempotent replay — the recorded row is returned verbatim; the decision
  // stays resolved exactly once and the activity feed stays unique. The
  // dedupe is bound to THIS decision's recorded approval: reusing the same
  // requestId against a different ask (e.g. the new revision's decision
  // after a supersede) must surface a CONFLICT, not silently return a
  // verdict recorded for unrelated content while this ask stays open.
  const prior = await ctx.db
    .query("approvals")
    .withIndex("by_workspaceId_and_requestId", (q) =>
      q
        .eq("workspaceId", args.workspaceId)
        .eq("requestId", requestId),
    )
    .unique();
  if (prior !== null) {
    if (prior.decision !== args.verdict) {
      throw domainError(
        "CONFLICT",
        `requestId ${requestId} already recorded a "${prior.decision}" verdict`,
      );
    }
    if (decision.approvalId !== String(prior._id)) {
      throw domainError(
        "CONFLICT",
        `requestId ${requestId} was already used to resolve a different decision`,
      );
    }
    // `requestChanges` and `reject` share the "rejected" verdict — the
    // workflow-visible distinction lives on the recorded answer. Reusing
    // one operation's requestId for the other must CONFLICT, not silently
    // replay a terminal rejection as a redraft request (or vice versa).
    if (decision.answer?.fields?.draftResolution !== args.draftResolution) {
      throw domainError(
        "CONFLICT",
        `requestId ${requestId} recorded a different draft resolution`,
      );
    }
    return { approval: prior, replayed: true };
  }

  if (decision.state !== "open") {
    throw domainError(
      "CONFLICT",
      `decision is already ${decision.state} — a prior resolution stands`,
    );
  }
  if (decision.version !== args.expectedVersion) {
    throw domainError(
      "CONFLICT",
      `decision version is ${decision.version}, not ${args.expectedVersion}`,
    );
  }
  if (decision.draftId === undefined) {
    throw invalid("draft approval decision is not bound to a draft");
  }

  const draft = await ctx.db.get(
    "drafts",
    decision.draftId as Id<"drafts">,
  );
  if (draft === null || draft.workspaceId !== args.workspaceId) {
    throw domainError("NOT_FOUND", "draft not found");
  }
  const conversation = await ctx.db.get("conversations", draft.conversationId);
  if (conversation === null) {
    throw domainError("NOT_FOUND", "conversation not found");
  }
  // Exact-draft binding (§8): the ask is answerable only while the bound
  // revision is still current and no inbound/context change has moved the
  // conversation past the version the draft was written against.
  if (conversation.currentDraftId !== draft._id || draft.supersededAt !== undefined) {
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

  const now = Date.now();
  const approvalId = await ctx.db.insert("approvals", {
    workspaceId: args.workspaceId,
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

  // Resolve through the bound internal path (the public `resolve` refuses
  // artifact-bound kinds): version + state checks are re-applied there and
  // the workflow continuation is delivered in the same transaction. The same
  // requestId marks the decision's resolutionRequestId. The verdict
  // distinction (changes requested vs rejected) rides in fields.
  const answer = {
    approved: args.verdict === "approved",
    ...(args.body !== undefined ? { body: args.body } : {}),
    fields: { draftResolution: args.draftResolution },
  };
  await ctx.runMutation(internal.decisions.resolveBound, {
    workspaceId: args.workspaceId,
    decisionId: args.decisionId,
    expectedVersion: args.expectedVersion,
    requestId,
    answer,
    resolvedBy: identityKey,
  });
  // Link the decision to its immutable approval row (forward string ref).
  await ctx.db.patch("decisions", args.decisionId, {
    approvalId,
  });

  const verb =
    args.draftResolution === "approved"
      ? "approved"
      : args.draftResolution === "changes_requested"
        ? "requested changes on"
        : "rejected";
  await recordActivityEvent(ctx, {
    workspaceId: args.workspaceId,
    missionId: decision.missionId,
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
 * Approve the exact bound draft revision. Produces an `approved` approvals
 * row — the ONLY artifact that can satisfy the send preflight's exact-draft
 * gate. `comment` is optional review context.
 */
export const approve = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    decisionId: v.id("decisions"),
    expectedVersion: v.number(),
    requestId: v.string(),
    comment: v.optional(v.string()),
  },
  returns: v.object({
    approval: vApprovalDoc,
    replayed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await resolveDraftDecision(ctx, {
      workspaceId: args.workspaceId,
      decisionId: args.decisionId,
      expectedVersion: args.expectedVersion,
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
 * Request changes — resolves the ask as NOT approved with a required comment
 * describing what must change. The workflow-visible distinction
 * (`fields.draftResolution = "changes_requested"`) tells the pipeline to
 * redraft; the approvals row records an immutable `rejected` verdict for
 * this exact content.
 */
export const requestChanges = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    decisionId: v.id("decisions"),
    expectedVersion: v.number(),
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
    return await resolveDraftDecision(ctx, {
      workspaceId: args.workspaceId,
      decisionId: args.decisionId,
      expectedVersion: args.expectedVersion,
      requestId: args.requestId,
      verdict: "rejected",
      draftResolution: "changes_requested",
      body: comment,
    });
  },
});

/**
 * Reject the exact bound draft revision with a required reason — the
 * deliberate terminal "do not send this" verdict.
 */
export const reject = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    decisionId: v.id("decisions"),
    expectedVersion: v.number(),
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
    return await resolveDraftDecision(ctx, {
      workspaceId: args.workspaceId,
      decisionId: args.decisionId,
      expectedVersion: args.expectedVersion,
      requestId: args.requestId,
      verdict: "rejected",
      draftResolution: "rejected",
      body: reason,
    });
  },
});
