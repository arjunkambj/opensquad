/**
 * Lead approval, as a model function: one lead's decision, and what a
 * rejection retires (PLAN §9.3, §9.1).
 *
 * `leads/mutations.ts` holds the public mutation — validate, authorise, loop —
 * and this holds the rule it applies to each lead, because two of those rules
 * are subtle enough to want their own file:
 *
 *   Lead approval is not email approval. Approving says "yes, contact this
 *   person": it authorises finding the address and drafting, and sends
 *   nothing.
 *
 *   Cancellation never decides money. Nothing here refunds anything. A parked
 *   send intent that provably never dispatched is retired by the send
 *   boundary's own mutation, which releases what it reserved; a reveal
 *   already in flight runs to its recorded result, is billed what it cost,
 *   and its address is STORED rather than thrown away.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { LeadApproval } from "../lib/validators";
import { domainError } from "../lib/validators";
import { draftIsUnsent } from "../outreach/outreachLeadState";
import { appendLeadEvent, findLeadEventByOperationKey } from "./events";
import { loadProspectForWrite } from "./model";

/** One lead's decision, written with its event in the same transaction. */
export async function decideOne(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    prospectId: Id<"prospects">;
    approval: LeadApproval;
    identityKey: string;
    requestId: string;
    reason?: string;
  },
): Promise<boolean> {
  const prospect = await loadProspectForWrite(
    ctx,
    args.orgId,
    args.prospectId,
  );
  const operationKey = `lead:${args.prospectId}:approval:${args.requestId}`;
  const prior = await findLeadEventByOperationKey(
    ctx,
    args.orgId,
    operationKey,
  );
  if (prior !== null) {
    if (prior.details?.toApproval !== args.approval) {
      throw domainError(
        "CONFLICT",
        `requestId ${args.requestId} already recorded a different decision`,
      );
    }
    return false;
  }
  if (prospect.approval === args.approval) {
    // Already decided the same way — a deliberate no-op, not a new event.
    return false;
  }

  const now = Date.now();
  const rejected = args.approval === "rejected";
  await ctx.db.patch("prospects", prospect._id, {
    approval: args.approval,
    approvedBy: "user",
    updatedAt: now,
    ...(args.reason !== undefined ? { stageReason: args.reason } : {}),
    // A rejected lead leaves the pipeline and stops being due for work — but
    // a reveal already in flight keeps its watchdog, because the sweep finds
    // a lost job by the lead being DUE. Rejecting stops what has not started
    // (PLAN §9.1); it does not strand a request that already left us.
    ...(rejected
      ? {
          stage: "rejected" as const,
          ...(prospect.emailStatus === "revealing"
            ? {}
            : { nextActionAt: undefined }),
        }
      : {}),
  });
  if (rejected) {
    await cancelWorkForRejectedLead(
      ctx,
      prospect,
      args.reason ?? "lead rejected",
    );
  }
  await appendLeadEvent(ctx, {
    orgId: prospect.orgId,
    prospectId: prospect._id,
    kind: "approval_changed",
    summary: rejected ? "Lead rejected" : "Lead approved for outreach",
    operationKey,
    actor: { source: "human", identityKey: args.identityKey },
    ...(rejected && prospect.stage !== "rejected"
      ? { fromStage: prospect.stage, toStage: "rejected" as const }
      : {}),
    details: {
      fromApproval: prospect.approval,
      toApproval: args.approval,
      approvalActor: "user",
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    },
  });
  return true;
}

/** Conversations one lead can hold. A lead has a handful at most. */
const CONVERSATION_SCAN_MAX = 25;

/**
 * Retire the outreach a rejected lead had queued.
 *
 * `drafts` belongs to the outreach domain and is patched here for one reason:
 * the rejection and everything it invalidates have to land in ONE transaction,
 * or a send scheduled a millisecond later would pass a gate the user has just
 * closed. The patch is the exact one `vDraftState` documents for this case
 * ("written when … the lead is rejected"), and it is the only outreach row
 * this domain ever writes.
 */
export async function cancelWorkForRejectedLead(
  ctx: MutationCtx,
  lead: Doc<"prospects">,
  reason: string,
): Promise<{ draftsSuperseded: number; conversations: number }> {
  const conversations = await ctx.db
    .query("conversations")
    .withIndex("by_prospectId", (q) => q.eq("prospectId", lead._id))
    .take(CONVERSATION_SCAN_MAX);

  const now = Date.now();
  let draftsSuperseded = 0;
  for (const conversation of conversations) {
    const open = await ctx.db
      .query("drafts")
      .withIndex("by_conversationId_and_state", (q) =>
        q.eq("conversationId", conversation._id).eq("state", "current"),
      )
      .take(CONVERSATION_SCAN_MAX);
    let clearsCurrent = false;
    for (const draft of open) {
      // SENT MAIL IS UNTOUCHED (PLAN §9.1). A draft stays `current` after it
      // has gone out — nothing supersedes it until the next revision — so
      // superseding every `current` row flipped already-sent mail to
      // `superseded`, rewriting the record of what was actually sent to this
      // person. `draftIsUnsent` is the same guard `retireConversationDrafts`
      // applies, and a rejection is not a stronger claim than a reply.
      if (!(await draftIsUnsent(ctx, draft._id))) {
        continue;
      }
      // `state` and `supersededAt` move together — see `vDraftState`.
      await ctx.db.patch("drafts", draft._id, {
        state: "superseded",
        supersededAt: now,
      });
      if (conversation.currentDraftId === draft._id) {
        clearsCurrent = true;
      }
      draftsSuperseded += 1;
    }
    if (clearsCurrent) {
      // The thread pane renders whatever `currentDraftId` names; leaving it on
      // a superseded draft shows stale text under a live Approve & send.
      await ctx.db.patch("conversations", conversation._id, {
        currentDraftId: undefined,
        updatedAt: now,
      });
    }
    // Pre-dispatch intents only: the send boundary owns the distinction, and
    // a request that already left us is never retracted here.
    await ctx.runMutation(
      internal.outreach.sendControls.cancelParkedConversationAttempts,
      {
        orgId: lead.orgId,
        conversationId: conversation._id,
        reason,
      },
    );
  }
  return { draftsSuperseded, conversations: conversations.length };
}
