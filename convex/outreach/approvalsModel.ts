/**
 * The shared draft-resolution core behind approve / requestChanges / reject.
 *
 * Every resolution (a) dedupes on (workspaceId, requestId) through the
 * approvals table, (b) binds the exact draft revision — payload hash,
 * normalized recipient, current-draft pointer and conversation context
 * version — then (c) writes one immutable `approvals` row. Stale approvals
 * fail `CONFLICT` rather than silently applying to newer content.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { recordActivityEvent } from "../activity/model";
import { requireWorkspaceEditor } from "../lib/auth";
import { boundedString, domainError } from "../lib/validators";
import type { ApprovalVerdict, DraftResolution } from "../lib/validators";

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
export async function resolveDraft(
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
