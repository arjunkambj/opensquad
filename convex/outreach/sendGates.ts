/**
 * The send gate checklist — architecture §8, integrations G3.
 *
 * One shared evaluation re-run at every step of the boundary: liveness, the
 * exact draft + approval binding, the booking link, conversation state, inbox
 * binding, suppression and the across-revisions unresolved-attempt guard.
 * Everything here is a pure read — no gate takes a reservation or writes.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthCtx } from "../lib/auth";
import {
  SENDING_AGENT_MODES,
  UNRESOLVED_ATTEMPT_STATES,
} from "../lib/validators";
import { matchSuppression } from "./suppressions";
import { v } from "convex/values";

/**
 * Send-path block/result codes — the honest surfacing contract (P10's
 * definitely-unsent / rejected / uncertain UI codes map off these).
 */
export const SEND_BLOCK_CODES = [
  "workspace_paused",
  /** The agent is in a mode that never sends (sourcing only, paused). */
  "agent_not_sending",
  "conversation_not_open",
  "human_takeover",
  "draft_not_current",
  "context_changed",
  "no_current_approval",
  "policy_changed",
  /** The agent's instructions moved on after the draft was written. */
  "agent_revision_changed",
  "inbox_unassigned",
  "inbox_mismatch",
  "suppressed_email",
  "suppressed_domain",
  /** The user rejected the lead this thread is for (PLAN §9.1). */
  "lead_rejected",
  /** The lead replied after this text was written, so it is stale mail. */
  "lead_replied",
  "already_sent",
  "attempt_in_flight",
  "attempt_uncertain",
  "attempt_failed",
  "unresolved_attempt",
  "outside_window",
  "send_limit_reached",
  /** §4.3 (P19): the draft offers a booking proposal whose linked booking is
   *  no longer `proposed` at the recorded version — the offer changed. */
  "booking_not_current",
] as const;

export type SendBlockCode = (typeof SEND_BLOCK_CODES)[number];

export const vSendBlockCode = v.union(
  ...SEND_BLOCK_CODES.map((code) => v.literal(code)),
);

/**
 * The minimal honest result codes the UI surfaces (card requirement):
 * `definitely_unsent` = never reached the provider / cancelled before
 * dispatch; `rejected` = definitive provider refusal; `delivery_uncertain` =
 * ambiguous, capacity retained, human attention required; `sent` = provider
 * accepted (NOT delivered — delivery facts arrive via verified events);
 * `pending` = intent still live.
 */
export const vSendResultCode = v.union(
  v.literal("pending"),
  v.literal("sent"),
  v.literal("definitely_unsent"),
  v.literal("rejected"),
  v.literal("delivery_uncertain"),
);

export type SendResultCode =
  | "pending"
  | "sent"
  | "definitely_unsent"
  | "rejected"
  | "delivery_uncertain";

/** Map an attempt row to its honest UI result code. */
export function sendResultCode(attempt: Doc<"sendAttempts">): SendResultCode {
  switch (attempt.state) {
    case "reserved":
    case "requesting":
      return "pending";
    case "acknowledged":
      return "sent";
    case "uncertain":
      return "delivery_uncertain";
    case "cancelled":
      return "definitely_unsent";
    case "definitively_failed":
      // A provider refusal (4xx) is "rejected"; a local failure that never
      // reached the provider is "definitely_unsent".
      return attempt.error?.httpStatus !== undefined &&
        attempt.error.httpStatus >= 400 &&
        attempt.error.httpStatus < 500
        ? "rejected"
        : "definitely_unsent";
  }
}

/* ------------------------------------------------------------------ */
/* Shared gate evaluation (the preflight checklist)                     */
/* ------------------------------------------------------------------ */
type GateBlock = { ok: false; code: SendBlockCode; reason: string };

type GatePass = { ok: true; approval: Doc<"approvals"> };

type GateResult = GatePass | GateBlock;

function block(code: SendBlockCode, reason: string): GateBlock {
  return { ok: false, code, reason };
}

/**
 * Load the currently-valid `approved` approval for an exact draft revision —
 * matching payloadHash, normalizedRecipient AND the conversation's live
 * context version (§8 "approvals bind the draft revision and the
 * conversation version"). Historical verdicts are never consulted — only the
 * approval that still applies right now.
 */
async function currentApproval(
  ctx: AuthCtx,
  draft: Doc<"drafts">,
  conversation: Doc<"conversations">,
): Promise<Doc<"approvals"> | null> {
  const approvals = await ctx.db
    .query("approvals")
    .withIndex("by_draftId", (q) => q.eq("draftId", draft._id))
    .collect();
  return (
    approvals.find(
      (approval) =>
        approval.decision === "approved" &&
        approval.draftRevision === draft.revision &&
        approval.payloadHash === draft.payloadHash &&
        approval.normalizedRecipient === draft.normalizedRecipient &&
        approval.contextVersion === conversation.contextVersion,
    ) ?? null
  );
}

/**
 * Every send gate that does not depend on wall-clock window/capacity:
 * workspace/agent liveness, exact approval + context binding,
 * takeover/closed state, suppression, inbox match, and the across-revisions
 * unresolved-attempt guard.
 *
 * `excludeAttemptId` — the attempt currently dispatching (it is itself
 * unresolved while `reserved`/`requesting`).
 */
export async function evaluateSendGates(
  ctx: AuthCtx,
  args: {
    workspace: Doc<"workspaces">;
    conversation: Doc<"conversations">;
    draft: Doc<"drafts">;
    agent: Doc<"agents"> | null;
    excludeAttemptId?: Id<"sendAttempts">;
  },
): Promise<GateResult> {
  const { workspace, conversation, draft, agent } = args;

  // --- liveness ------------------------------------------------------
  if (workspace.automationState !== "active") {
    return block(
      "workspace_paused",
      `workspace automation is ${workspace.automationState}`,
    );
  }
  // Sourcing-only and paused agents never put mail on the wire (PLAN §9.3).
  if (agent !== null && !SENDING_AGENT_MODES.includes(agent.mode)) {
    return block("agent_not_sending", `agent mode is ${agent.mode}`);
  }

  // --- exact draft + approval binding ---------------------------------
  if (
    conversation.currentDraftId !== draft._id ||
    draft.supersededAt !== undefined
  ) {
    return block(
      "draft_not_current",
      "draft is not the conversation's current revision",
    );
  }
  if (conversation.contextVersion !== draft.basedOnContextVersion) {
    return block(
      "context_changed",
      `conversation context is v${conversation.contextVersion}; draft was written against v${draft.basedOnContextVersion}`,
    );
  }
  const approval = await currentApproval(ctx, draft, conversation);
  if (approval === null) {
    return block(
      "no_current_approval",
      "no approved verdict binds this revision, payload and context version",
    );
  }
  if (workspace.policyVersion !== draft.policyVersion) {
    return block(
      "policy_changed",
      `workspace policy is v${workspace.policyVersion}; draft was written against v${draft.policyVersion}`,
    );
  }
  // Revision fencing (PLAN §9.1): instructions, tone, goal, ICP or mode
  // changed after this text was written, so the text is no longer what the
  // agent would say.
  if (agent !== null && agent.revision !== draft.agentRevision) {
    return block(
      "agent_revision_changed",
      `agent is at revision ${agent.revision}; draft was written against ${draft.agentRevision}`,
    );
  }

  // --- the lead this thread is for (PLAN §9.1 send-time list) ------------
  // Two of the invalidation table's rows are facts of the LEAD rather than of
  // the draft, and neither is implied by anything above: a rejection
  // supersedes the drafts it can see in its own transaction, and a reply
  // advances the conversation's context version — but a draft written on a
  // second thread, or a reply the inbound path recorded without a context
  // bump, would slip through. Re-read here, at the moment of effect, which
  // PLAN §9.1 makes the authority.
  if (conversation.prospectId !== undefined) {
    const lead = await ctx.db.get("prospects", conversation.prospectId);
    if (lead !== null && lead.workspaceId === workspace._id) {
      if (lead.approval === "rejected" || lead.stage === "rejected") {
        return block(
          "lead_rejected",
          "the lead this conversation is for has been rejected",
        );
      }
      // A REPLY draft is written after the message it answers, so this
      // compares times rather than presence: only mail composed BEFORE the
      // latest reply is stale.
      if (lead.lastReplyAt !== undefined && lead.lastReplyAt >= draft.createdAt) {
        return block(
          "lead_replied",
          "the lead replied after this draft was written — answer the reply instead",
        );
      }
    }
  }

  // --- booking link (§4.3, P19) ------------------------------------------
  // A booking-linked draft is sendable only while the proposal it names is
  // still live at the exact version the content was written against. This is
  // the third evaluation of the same check (install, approval, dispatch): a
  // confirm/reschedule/cancel that lands after approval must catch the send
  // here, because the mailed times or link would no longer be the offer.
  if (draft.bookingId !== undefined) {
    const booking = await ctx.db.get("bookings", draft.bookingId);
    if (booking === null || booking.workspaceId !== workspace._id) {
      return block(
        "booking_not_current",
        "the linked booking no longer exists in this workspace",
      );
    }
    if (
      booking.state !== "proposed" ||
      booking.version !== draft.bookingVersion ||
      booking.prospectId !== conversation.prospectId
    ) {
      return block(
        "booking_not_current",
        `linked booking is ${booking.state} at version ${booking.version}; this draft proposed it at version ${draft.bookingVersion}`,
      );
    }
  }

  // --- conversation state ----------------------------------------------
  if (conversation.state !== "open") {
    return block(
      "conversation_not_open",
      `conversation is ${conversation.state}`,
    );
  }
  if (conversation.humanTakeover) {
    return block(
      "human_takeover",
      "conversation is under human takeover — automation is frozen",
    );
  }

  // --- inbox binding ---------------------------------------------------
  if (workspace.inboxRef === undefined) {
    return block(
      "inbox_unassigned",
      "workspace has no assigned sender inbox",
    );
  }
  // The inbox must be attached by the workspace's OWN key (PLAN §9.4).
  // `legacy_platform_inbox` is receive-only — it still gets mail on the
  // platform route and cannot send until its owner connects a key — and
  // `invalid` is a key the provider refused at send time. Reported as
  // `inbox_unassigned` on purpose: "connect your inbox" is already the UI
  // meaning of that code, so no new block code has to be mapped.
  if (workspace.inboxConnection !== "connected") {
    return block(
      "inbox_unassigned",
      workspace.inboxConnection === "legacy_platform_inbox"
        ? "this workspace receives on a platform inbox and cannot send until its own key is connected"
        : "the workspace's mail key is not connected",
    );
  }
  if (
    workspace.inboxRef !== draft.inboxRef ||
    conversation.inboxRef !== draft.inboxRef
  ) {
    return block(
      "inbox_mismatch",
      "draft inbox no longer matches the workspace/conversation inbox",
    );
  }

  // --- suppression ------------------------------------------------------
  const suppression = await matchSuppression(
    ctx,
    workspace._id,
    draft.normalizedRecipient,
  );
  if (suppression !== null) {
    return block(
      suppression.matchedBy === "email" ? "suppressed_email" : "suppressed_domain",
      `recipient is suppressed by ${suppression.matchedBy} record (${suppression.suppression.reason})`,
    );
  }

  // --- across-revisions unresolved-attempt guard -------------------------
  const unresolved: Doc<"sendAttempts">[] = [];
  for (const state of UNRESOLVED_ATTEMPT_STATES) {
    const rows = await ctx.db
      .query("sendAttempts")
      .withIndex("by_conversationId_and_state", (q) =>
        q.eq("conversationId", conversation._id).eq("state", state),
      )
      .collect();
    unresolved.push(...rows);
  }
  for (const other of unresolved) {
    if (other._id === args.excludeAttemptId) {
      continue;
    }
    if (other.state === "uncertain") {
      return block(
        "attempt_uncertain",
        `send attempt ${other._id} is uncertain — reconcile it before anything else dispatches on this conversation`,
      );
    }
    return block(
      "unresolved_attempt",
      `send attempt ${other._id} is ${other.state} — no new send may dispatch on this conversation`,
    );
  }

  return { ok: true, approval };
}
