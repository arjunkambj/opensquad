/**
 * Sending boundary — architecture §8, integrations G3, verification
 * V13/V15/V17/V18 (P10).
 *
 * THE DISPATCH COMMIT POINT is `beginDispatch`: a guarded mutation that
 * re-runs every send gate, takes the usage reservation and flips the attempt
 * `reserved → requesting` in ONE transaction, then returns the exact
 * immutable send payload rebuilt from the draft row. The very next statement
 * in the calling action performs the single provider request. After the
 * commit point nothing local can retract the request — a reply, takeover or
 * policy change that lands later can only invalidate FUTURE automation.
 *
 * Layout (mirrors integrations G3):
 *   reserveSendIntent  — §8 step 3: durable intent + every static gate,
 *                        atomically; outside the send window / over the
 *                        daily limit it parks `reserved` with
 *                        `nextPermittedAt` instead of touching the provider.
 *   dispatchAttempt    — §8 step 4–7: `beginDispatch` (commit point) → ONE
 *                        `runAction` against the AgentMail adapter →
 *                        `recordSendOutcome`. No retry anywhere: not here,
 *                        not in the adapter, not via the component's sender.
 *   reconcile*         — §8.7: an `uncertain` attempt is replayed only
 *                        through the SAME provider idempotency key, only
 *                        inside the provider's key-retention window and only
 *                        while policy still permits dispatch. Otherwise the
 *                        attempt stays `uncertain` and blocks the thread
 *                        until a human resolves it.
 *
 * `approvals.approve` schedules `sendApprovedDraft`, which converges on the
 * same idempotent gates below.
 */
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import {
  requireWorkspaceEditor,
  requireWorkspaceMember,
} from "./lib/auth";
import type { AuthCtx } from "./lib/auth";
import {
  boundedString,
  domainError,
  localCivilToUtc,
  localDayKey,
  localDayParts,
  sendWindowStatus,
  SENDING_AGENT_MODES,
  UNRESOLVED_ATTEMPT_STATES,
  vSendAttemptState,
} from "./lib/validators";
import { recordActivityEvent } from "./activity/model";
import { matchSuppression } from "./suppressions";
import {
  applyReceiptToAttempt,
  vSendAttemptDoc,
} from "./sendAttempts";
import { getDraftInWorkspace } from "./drafts";

/* ------------------------------------------------------------------ */
/* Constants + result vocabulary                                        */
/* ------------------------------------------------------------------ */

/**
 * Longer than the adapter's 30s provider timeout plus margin — a `requesting`
 * attempt older than this means the action died between dispatch and outcome
 * recording (a lost acknowledgement), which is treated as `uncertain`.
 */
const REQUEST_STALE_SWEEP_MS = 120_000;

/**
 * Replay window for an uncertain attempt. AgentMail retains idempotency keys
 * for 24h; we stop replaying well inside that so a late replay can never
 * mint a duplicate after the key expired.
 */
const RECONCILE_WINDOW_MS = 23 * 60 * 60 * 1000;

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

const vSendBlockCode = v.union(
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
async function evaluateSendGates(
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

/* ------------------------------------------------------------------ */
/* Loaders + helpers                                                    */
/* ------------------------------------------------------------------ */

type AttemptContext = {
  workspace: Doc<"workspaces">;
  conversation: Doc<"conversations">;
  draft: Doc<"drafts">;
  agent: Doc<"agents"> | null;
};

async function loadAttemptContext(
  ctx: MutationCtx,
  draftId: Id<"drafts">,
): Promise<AttemptContext> {
  const draft = await ctx.db.get("drafts", draftId);
  if (draft === null) {
    throw domainError("NOT_FOUND", "draft not found");
  }
  const conversation = await ctx.db.get("conversations", draft.conversationId);
  const workspace = await ctx.db.get("workspaces", draft.workspaceId);
  if (conversation === null || workspace === null) {
    throw domainError("NOT_FOUND", "send context is incomplete");
  }
  const agent =
    conversation.agentId === undefined
      ? null
      : await ctx.db.get("agents", conversation.agentId);
  return { workspace, conversation, draft, agent };
}

/** The workspace's daily send cap — the one ceiling the ledger reserves against. */
function effectiveSendLimit(workspace: Doc<"workspaces">): number {
  return workspace.dailySendLimit;
}

/** UTC instant of the NEXT send-window opening after `fromMs`. */
function nextWindowStart(
  workspace: Doc<"workspaces">,
  fromMs: number,
): number {
  const status = sendWindowStatus(workspace, fromMs);
  if (!status.permitted) {
    return status.nextPermittedAt;
  }
  // Already inside a window — the next opening follows today's close. Find
  // the close instant in local civil time, then ask for the opening after it.
  const parts = localDayParts(fromMs, workspace.timezone);
  const closeUtc = localCivilToUtc(
    parts.year,
    parts.month,
    parts.day,
    workspace.sendWindow.endMinute,
    workspace.timezone,
  );
  const after = sendWindowStatus(workspace, closeUtc + 60_000);
  return after.permitted ? closeUtc + 60_000 : after.nextPermittedAt;
}

/** Remaining send capacity for the workspace-local day containing `atMs`. */
async function sendCapacity(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  atMs: number,
): Promise<{ periodKey: string; limit: number; remaining: number }> {
  const periodKey = localDayKey(atMs, workspace.timezone);
  const limit = effectiveSendLimit(workspace);
  const bucket = await ctx.db
    .query("usageBuckets")
    .withIndex(
      "by_workspaceId_and_scopeKey_and_metric_and_periodKey",
      (q) =>
        q
          .eq("workspaceId", workspace._id)
          .eq("scopeKey", "workspace")
          .eq("metric", "sends")
          .eq("periodKey", periodKey),
    )
    .unique();
  const used =
    bucket === null
      ? 0
      : bucket.reserved + bucket.committed + bucket.uncertain;
  return { periodKey, limit, remaining: limit - used };
}

/**
 * Take the daily-send reservation for this attempt. Idempotent on the
 * attempt's `operationKey`; a true capacity race surfaces as CONFLICT from
 * the nested mutation, which aborts this transaction — the calling action
 * then re-runs `reserveSendIntent` and lands on the `wait` path.
 */
async function ensureUsageReservation(
  ctx: MutationCtx,
  attempt: Doc<"sendAttempts">,
  workspace: Doc<"workspaces">,
): Promise<void> {
  const now = Date.now();
  const capacity = await sendCapacity(ctx, workspace, now);
  if (capacity.remaining < 1) {
    throw domainError(
      "CONFLICT",
      `send limit reached for ${capacity.periodKey} (${capacity.limit})`,
    );
  }
  await ctx.runMutation(internal.billing.reservations.reserve, {
    workspaceId: workspace._id,
    scopeKey: "workspace",
    metric: "sends",
    periodKey: capacity.periodKey,
    limit: capacity.limit,
    operationKey: attempt.operationKey,
    quantity: 1,
  });
}

async function insertReservedAttempt(
  ctx: MutationCtx,
  args: {
    context: AttemptContext;
    approval: Doc<"approvals">;
    operationKey: string;
    /** Recorded wake time for a parked attempt — set by the wait branches
     *  so the sweep can re-drive a lost schedule. */
    nextPermittedAt?: number;
  },
): Promise<Id<"sendAttempts">> {
  const { draft, conversation, workspace } = args.context;
  const now = Date.now();
  // The provider idempotency key is generated exactly once here and never
  // regenerated — the same key carries the initial request and every
  // reconciliation replay (G3).
  const providerIdempotencyKey = `opensquad-send-${crypto.randomUUID()}`;
  const attemptId = await ctx.db.insert("sendAttempts", {
    workspaceId: workspace._id,
    draftId: draft._id,
    approvalId: args.approval._id,
    conversationId: conversation._id,
    inboxRef: draft.inboxRef,
    operationKey: args.operationKey,
    endpointOperation:
      draft.replyToMessageRef === undefined ? "send" : "reply",
    providerIdempotencyKey,
    state: "reserved",
    payloadHash: draft.payloadHash,
    createdAt: now,
    updatedAt: now,
    ...(args.nextPermittedAt !== undefined
      ? { nextPermittedAt: args.nextPermittedAt }
      : {}),
  });
  await recordActivityEvent(ctx, {
    workspaceId: workspace._id,
    kind: "send_attempt_reserved",
    summary: `Send intent reserved for draft revision ${draft.revision} → ${draft.normalizedRecipient}`,
    actor: "workflow",
    dedupeKey: `sendattempt:${attemptId}:reserved`,
    conversationId: conversation._id,
  });
  return attemptId;
}

/* ------------------------------------------------------------------ */
/* reserveSendIntent — the serialization point (§8 step 3)               */
/* ------------------------------------------------------------------ */

const vReserveResult = v.union(
  v.object({
    action: v.literal("ready"),
    sendAttemptId: v.id("sendAttempts"),
  }),
  v.object({
    action: v.literal("existing"),
    sendAttemptId: v.id("sendAttempts"),
    state: vSendAttemptState,
  }),
  v.object({
    action: v.literal("wait"),
    sendAttemptId: v.id("sendAttempts"),
    nextPermittedAt: v.number(),
    reason: v.string(),
  }),
  v.object({
    action: v.literal("blocked"),
    code: vSendBlockCode,
    reason: v.string(),
  }),
);

/**
 * Atomically create the ONE logical send intent for a draft revision.
 *
 * - `send:<draftId>[:retry:N]` dedupes retried dispatch triggers — a replay
 *  returns the live attempt, a concurrently racing trigger either observes
 *  the committed attempt (idempotent) or aborts and re-reads.
 * - Every static gate runs inside the transaction; a hard block writes an
 *  activity record and returns `blocked` — no attempt row is created for an
 *  intent that can never dispatch.
 * - Outside the send window or over the daily limit the attempt is created
 *  `reserved` with `nextPermittedAt` — durable intent BEFORE any network
 *  I/O — and the caller waits durably and re-runs everything.
 * - The daily-send usage reservation is taken here when dispatch is
 *  imminent (inside the window); a window-parked attempt reserves at
 *  `beginDispatch` so a wait never debits the wrong local day.
 */
export const reserveSendIntent = internalMutation({
  args: {
    draftId: v.id("drafts"),
  },
  returns: vReserveResult,
  handler: async (ctx, args): Promise<Infer<typeof vReserveResult>> => {
    const context = await loadAttemptContext(ctx, args.draftId);
    const { draft, workspace, conversation } = context;

    // --- logical-send dedupe ------------------------------------------------
    const priorAttempts = await ctx.db
      .query("sendAttempts")
      .withIndex("by_draftId", (q) => q.eq("draftId", draft._id))
      .collect();
    const live = priorAttempts.find(
      (attempt) =>
        attempt.state === "reserved" || attempt.state === "requesting",
    );
    if (live !== undefined) {
      return {
        action: "existing" as const,
        sendAttemptId: live._id,
        state: live.state,
      };
    }
    if (priorAttempts.some((attempt) => attempt.state === "acknowledged")) {
      return blockResult("already_sent", "draft revision already sent");
    }
    if (priorAttempts.some((attempt) => attempt.state === "uncertain")) {
      return blockResult(
        "attempt_uncertain",
        "an earlier attempt for this revision is still uncertain — reconcile it before sending again; never blind-retry",
      );
    }
    if (
      priorAttempts.some(
        (attempt) => attempt.state === "definitively_failed",
      )
    ) {
      return blockResult(
        "attempt_failed",
        "this exact payload was already definitively refused — a corrected draft revision is required",
      );
    }
    const operationKey =
      priorAttempts.length === 0
        ? `send:${draft._id}`
        : `send:${draft._id}:retry:${priorAttempts.length}`;

    // --- static gates ---------------------------------------------------------
    const gate = await evaluateSendGates(ctx, {
      workspace: context.workspace,
      conversation,
      draft,
      agent: context.agent,
    });
    if (!gate.ok) {
      await recordActivityEvent(ctx, {
        workspaceId: workspace._id,
        kind: "send_attempt_cancelled",
        summary: `Send blocked (${gate.code}): ${gate.reason}`,
        actor: "workflow",
        dedupeKey: `sendblock:${draft._id}:${gate.code}:${operationKey}`,
        conversationId: conversation._id,
      });
      return blockResult(gate.code, gate.reason);
    }

    const now = Date.now();

    // --- send window ----------------------------------------------------------
    const window = sendWindowStatus(workspace, now);
    if (!window.permitted) {
      const sendAttemptId = await insertReservedAttempt(ctx, {
        context,
        approval: gate.approval,
        operationKey,
        nextPermittedAt: window.nextPermittedAt,
      });
      // Scheduled INSIDE the committing mutation — the durable wake can
      // never be lost between the `reserved` write and a caller-side
      // schedule (the action may die in between).
      await ctx.scheduler.runAfter(
        Math.max(0, window.nextPermittedAt - now),
        internal.sending.dispatchAttempt,
        { sendAttemptId },
      );
      return {
        action: "wait" as const,
        sendAttemptId,
        nextPermittedAt: window.nextPermittedAt,
        reason: "outside_window",
      };
    }

    // --- daily allowance -------------------------------------------------------
    const capacity = await sendCapacity(ctx, workspace, now);
    if (capacity.remaining < 1) {
      const nextPermittedAt = nextWindowStart(workspace, now);
      const sendAttemptId = await insertReservedAttempt(ctx, {
        context,
        approval: gate.approval,
        operationKey,
        nextPermittedAt,
      });
      await ctx.scheduler.runAfter(
        Math.max(0, nextPermittedAt - now),
        internal.sending.dispatchAttempt,
        { sendAttemptId },
      );
      return {
        action: "wait" as const,
        sendAttemptId,
        nextPermittedAt,
        reason: "send_limit_reached",
      };
    }

    // --- reserve intent + allowance atomically ---------------------------------
    // `nextPermittedAt: now` — dispatch is permitted immediately, and the
    // belt sweep can re-drive this row if the caller dies between the
    // commit and beginDispatch (an unindexed reserved row would park
    // forever).
    const sendAttemptId = await insertReservedAttempt(ctx, {
      context,
      approval: gate.approval,
      operationKey,
      nextPermittedAt: now,
    });
    const attempt = await ctx.db.get("sendAttempts", sendAttemptId);
    if (attempt === null) {
      throw domainError("NOT_FOUND", "send attempt not found after insert");
    }
    await ensureUsageReservation(ctx, attempt, workspace);
    return { action: "ready" as const, sendAttemptId };
  },
});

function blockResult(
  code: SendBlockCode,
  reason: string,
): { action: "blocked"; code: SendBlockCode; reason: string } {
  return { action: "blocked", code, reason };
}

/* ------------------------------------------------------------------ */
/* beginDispatch — the commit point (§8 step 4)                          */
/* ------------------------------------------------------------------ */

const vSendPayload = v.object({
  to: v.string(),
  subject: v.optional(v.string()),
  text: v.string(),
});

const vBeginResult = v.union(
  v.object({
    action: v.literal("dispatch"),
    sendAttemptId: v.id("sendAttempts"),
    inboxRef: v.string(),
    providerIdempotencyKey: v.string(),
    endpointOperation: v.union(v.literal("send"), v.literal("reply")),
    parentMessageId: v.optional(v.string()),
    payloadHash: v.string(),
    payload: vSendPayload,
  }),
  v.object({
    action: v.literal("wait"),
    nextPermittedAt: v.number(),
    reason: v.string(),
  }),
  v.object({
    action: v.literal("blocked"),
    code: vSendBlockCode,
    reason: v.string(),
  }),
  v.object({
    action: v.literal("done"),
    state: vSendAttemptState,
  }),
);

/**
 * Immediately-before-submission gate: re-runs EVERY check against live data,
 * ensures the usage reservation exists and flips `reserved → requesting`
 * atomically, then returns the exact immutable payload rebuilt from the
 * draft row (never re-read after this transaction). A second caller on a
 * `requesting` attempt gets `blocked: attempt_in_flight` — there is exactly
 * one in-flight provider request per attempt, ever.
 */
export const beginDispatch = internalMutation({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: vBeginResult,
  handler: async (ctx, args): Promise<Infer<typeof vBeginResult>> => {
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    if (attempt.state === "acknowledged") {
      return { action: "done" as const, state: attempt.state };
    }
    if (attempt.state !== "reserved") {
      return {
        action: "blocked" as const,
        code: "attempt_in_flight" as const,
        reason: `attempt is ${attempt.state}; dispatch can only start from reserved`,
      };
    }

    const context = await loadAttemptContext(ctx, attempt.draftId);
    const { workspace, conversation, draft } = context;
    const gate = await evaluateSendGates(ctx, {
      workspace,
      conversation,
      draft,
      agent: context.agent,
      excludeAttemptId: attempt._id,
    });
    const cancel = async (code: SendBlockCode, reason: string) => {
      await ctx.db.patch("sendAttempts", attempt._id, {
        state: "cancelled",
        error: { message: reason, at: Date.now(), reason: code },
        updatedAt: Date.now(),
      });
      // Release any deferred reservation the parked attempt holds.
      const reservation = await ctx.runMutation(
        internal.billing.reservations.getByOperationKey,
        {
          workspaceId: workspace._id,
          operationKey: attempt.operationKey,
        },
      );
      if (reservation !== null && reservation.state === "reserved") {
        await ctx.runMutation(internal.billing.reservations.release, {
          workspaceId: workspace._id,
          operationKey: attempt.operationKey,
        });
      }
      await recordActivityEvent(ctx, {
        workspaceId: workspace._id,
        kind: "send_attempt_cancelled",
        summary: `Send cancelled at dispatch gate (${code}): ${reason}`,
        actor: "workflow",
        dedupeKey: `sendattempt:${attempt._id}:cancelled`,
        conversationId: conversation._id,
      });
      return blockResult(code, reason);
    };
    if (!gate.ok) {
      return await cancel(gate.code, gate.reason);
    }

    const now = Date.now();
    const window = sendWindowStatus(workspace, now);
    if (!window.permitted) {
      await ctx.db.patch("sendAttempts", attempt._id, {
        nextPermittedAt: window.nextPermittedAt,
        updatedAt: now,
      });
      // Transactional wake — the parked attempt's re-drive cannot be lost.
      await ctx.scheduler.runAfter(
        Math.max(0, window.nextPermittedAt - now),
        internal.sending.dispatchAttempt,
        { sendAttemptId: attempt._id },
      );
      return {
        action: "wait" as const,
        nextPermittedAt: window.nextPermittedAt,
        reason: "outside_window",
      };
    }
    let reservation: Doc<"usageReservations"> | null = await ctx.runMutation(
      internal.billing.reservations.getByOperationKey,
      {
        workspaceId: workspace._id,
        operationKey: attempt.operationKey,
      },
    );
    if (reservation !== null && reservation.state === "reserved") {
      // A reservation taken on a previous local day must not fund today's
      // send — release it and re-reserve under the current period so the
      // daily cap is charged to the day the mail actually goes out.
      const heldBucket = await ctx.db.get("usageBuckets", reservation.bucketId);
      if (
        heldBucket !== null &&
        heldBucket.periodKey !== localDayKey(now, workspace.timezone)
      ) {
        await ctx.runMutation(internal.billing.reservations.release, {
          workspaceId: workspace._id,
          operationKey: attempt.operationKey,
        });
        reservation = null;
      }
    }
    if (reservation === null) {
      const capacity = await sendCapacity(ctx, workspace, now);
      if (capacity.remaining < 1) {
        const nextPermittedAt = nextWindowStart(workspace, now);
        await ctx.db.patch("sendAttempts", attempt._id, {
          nextPermittedAt,
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(
          Math.max(0, nextPermittedAt - now),
          internal.sending.dispatchAttempt,
          { sendAttemptId: attempt._id },
        );
        return {
          action: "wait" as const,
          nextPermittedAt,
          reason: "send_limit_reached",
        };
      }
      await ensureUsageReservation(ctx, attempt, workspace);
    } else if (reservation.state !== "reserved") {
      return {
        action: "blocked" as const,
        code: "unresolved_attempt" as const,
        reason: `usage reservation is ${reservation.state}; cannot dispatch`,
      };
    }

    // Commit point — after this patch the request may be in flight and can
    // no longer be retracted by local state. The lost-acknowledgement sweep
    // is scheduled in the SAME transaction: a `requesting` row always has a
    // recovery path even if the calling action dies before returning.
    await ctx.db.patch("sendAttempts", attempt._id, {
      state: "requesting",
      requestStartedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      REQUEST_STALE_SWEEP_MS,
      internal.sending.sweepStaleRequesting,
      { sendAttemptId: attempt._id },
    );
    await recordActivityEvent(ctx, {
      workspaceId: workspace._id,
      kind: "send_attempt_dispatched",
      summary: `Dispatching draft revision ${draft.revision} to provider`,
      actor: "workflow",
      dedupeKey: `sendattempt:${attempt._id}:dispatched`,
      conversationId: conversation._id,
    });
    return {
      action: "dispatch" as const,
      sendAttemptId: attempt._id,
      inboxRef: draft.inboxRef,
      providerIdempotencyKey: attempt.providerIdempotencyKey,
      endpointOperation: attempt.endpointOperation,
      parentMessageId: draft.replyToMessageRef,
      payloadHash: attempt.payloadHash,
      payload: {
        to: draft.normalizedRecipient,
        ...(draft.subject.length > 0 ? { subject: draft.subject } : {}),
        text: draft.body,
      },
    };
  },
});

/* ------------------------------------------------------------------ */
/* recordSendOutcome — §8 step 7/9                                       */
/* ------------------------------------------------------------------ */

const vOutcomeArg = v.union(
  v.object({
    outcome: v.literal("accepted"),
    messageId: v.string(),
    threadId: v.string(),
    httpStatus: v.optional(v.number()),
  }),
  v.object({
    outcome: v.literal("rejected"),
    httpStatus: v.optional(v.number()),
    providerError: v.string(),
  }),
  v.object({
    outcome: v.literal("uncertain"),
    providerError: v.string(),
    httpStatus: v.optional(v.number()),
    reason: v.optional(v.string()),
  }),
);

const vRecordResult = v.object({
  attempt: vSendAttemptDoc,
  /** true when the call replayed an already-recorded outcome. */
  replayed: v.boolean(),
});

/** How an acknowledged thread ref relates to the attempt's conversation. */
type ThreadMapping =
  | { kind: "claim" }
  | { kind: "already_linked" }
  | { kind: "conflict"; detail: string };

/**
 * Surface an acknowledged send whose conversation could not be mapped. The
 * send stands; only the reply route is missing, so this is the operator's one
 * signal that inbound mail on that thread will need manual assignment.
 */
async function reportThreadLinkMissed(
  ctx: MutationCtx,
  args: {
    attempt: Doc<"sendAttempts">;
    threadId: string;
    detail: string;
  },
): Promise<void> {
  await recordActivityEvent(ctx, {
    workspaceId: args.attempt.workspaceId,
    kind: "conversation_thread_link_missed",
    summary: `Send acknowledged on thread ${args.threadId.slice(0, 120)} but the conversation thread mapping was not written — ${args.detail}; replies on that thread need manual assignment`,
    actor: "workflow",
    dedupeKey: `sendattempt:${args.attempt._id}:threadlinkmiss`,
    conversationId: args.attempt.conversationId,
  });
}

/**
 * Mirror an acknowledged send's provider thread ref onto its conversation.
 *
 * `conversations.(inboxRef, providerThreadRef)` is the pair P11 matches every
 * inbound reply on (§4.3), so a conversation that never records it routes
 * every authentic reply to the unassigned takeover queue — exactly what V15
 * forbids. Called from inside `recordSendOutcome`'s transaction, so a mapping
 * this can write is committed with the accepted outcome and never after it.
 *
 * Never throws, and therefore does NOT guarantee every acknowledged send is
 * mapped: the provider has already accepted the send, so no mapping anomaly
 * may roll the accepted outcome back. Every unmapped case instead emits a
 * `conversation_thread_link_missed` activity event. P11 must still treat an
 * unmatched inbound message as unassigned rather than assuming a mapping
 * exists for OpenSquad-originated threads.
 */
async function linkConversationThread(
  ctx: MutationCtx,
  args: {
    attempt: Doc<"sendAttempts">;
    threadId: string;
    at: number;
  },
): Promise<void> {
  const { attempt, threadId, at } = args;
  const conversation = await ctx.db.get(
    "conversations",
    attempt.conversationId,
  );
  // Workspace boundary — an attempt never writes through into another
  // workspace's conversation row. This is the one branch here that indicates a
  // real integrity violation, so it is reported rather than returned silently.
  if (
    conversation === null ||
    conversation.workspaceId !== attempt.workspaceId
  ) {
    await reportThreadLinkMissed(ctx, {
      attempt,
      threadId,
      detail:
        conversation === null
          ? "the attempt's conversation row is missing"
          : "the attempt's conversation belongs to another workspace",
    });
    return;
  }

  let mapping: ThreadMapping;
  if (conversation.inboxRef !== attempt.inboxRef) {
    // The stored pair keys on the conversation's own `inboxRef`, but the mail
    // left on the attempt's. Equal on every path today; if they ever diverge,
    // claiming would write an index entry P11's inbound matcher never reads.
    mapping = {
      kind: "conflict",
      detail: `conversation is bound to a different inbox than the send`,
    };
  } else if (conversation.providerThreadRef === threadId) {
    mapping = { kind: "already_linked" };
  } else if (conversation.providerThreadRef !== undefined) {
    // A thread ref is stable for the life of a thread. Overwriting it would
    // orphan every reply already threaded under the first ref, so the first
    // one stands and the second is surfaced. This is not only a provider
    // anomaly: a follow-up with no inbound reply dispatches as `send` rather
    // than `reply` (`endpointFor` in drafts.ts), and AgentMail mints a fresh
    // thread for a send — so the second thread stays unmapped by design and
    // its replies need assignment.
    mapping = {
      kind: "conflict",
      detail: `already mapped to thread ${conversation.providerThreadRef.slice(0, 120)}`,
    };
  } else {
    // §4.3 uniqueness on (inboxRef, providerThreadRef) — the same guard
    // `drafts.stageConversation` applies before it patches or inserts a
    // thread ref, except it may not throw here. `.collect()`, not `.unique()`:
    // an already-violated pair must not strand an acknowledged send, and the
    // index is not workspace-scoped, so a foreign row must neither block the
    // claim nor have its id quoted into this workspace's activity feed.
    const holders = await ctx.db
      .query("conversations")
      .withIndex("by_inboxRef_and_providerThreadRef", (q) =>
        q
          .eq("inboxRef", conversation.inboxRef)
          .eq("providerThreadRef", threadId),
      )
      .collect();
    const duplicate = holders.find(
      (row) =>
        row._id !== conversation._id &&
        row.workspaceId === conversation.workspaceId,
    );
    mapping =
      duplicate !== undefined
        ? {
            kind: "conflict",
            detail: `thread already mapped to conversation ${duplicate._id}`,
          }
        : { kind: "claim" };
  }

  if (mapping.kind === "conflict") {
    await reportThreadLinkMissed(ctx, {
      attempt,
      threadId,
      detail: mapping.detail,
    });
  }

  // Recency is monotonic: P11's inbound processing writes `lastMessageAt`
  // too, and a reconcile can record this acknowledgement long after a newer
  // reply landed — a late outbound ack must never rewind the inbox ordering.
  const advanceRecency =
    conversation.lastMessageAt === undefined || conversation.lastMessageAt < at;
  const claims = mapping.kind === "claim";
  if (!claims && !advanceRecency) {
    return; // replay of an already-linked, already-current conversation
  }
  await ctx.db.patch("conversations", conversation._id, {
    ...(claims ? { providerThreadRef: threadId } : {}),
    ...(advanceRecency ? { lastMessageAt: at } : {}),
    updatedAt: at,
  });
}

/**
 * Persist the provider outcome onto the attempt — the ONLY write path from
 * transport result to durable state.
 *
 * - `accepted` stores the provider message/thread refs, commits the usage
 *   reservation, and folds in any delivery receipts that arrived BEFORE the
 *   acknowledgement stored the message ref (G3 — delivery events can win
 *   that race; they are verified provider facts, not transport truth).
 * - `rejected` marks `definitively_failed` and releases the reservation.
 * - `uncertain` keeps the attempt unresolved, retains capacity as
 *   `uncertain`, and opens the `delivery_uncertain` ask in the same
 *   transaction — an uncertain attempt can never exist without its ask —
 *   no retry, no new key.
 * - `reconcile: true` marks this as the reconciliation path outcome and is
 *   the only way an `uncertain` attempt may transition; a confirmed verdict
 *   also retires the open delivery-uncertainty ask.
 */
export const recordSendOutcome = internalMutation({
  args: {
    sendAttemptId: v.id("sendAttempts"),
    result: vOutcomeArg,
    reconcile: v.optional(v.boolean()),
  },
  returns: vRecordResult,
  handler: async (ctx, args): Promise<Infer<typeof vRecordResult>> => {
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    const now = Date.now();

    // Replays: an already-acknowledged attempt accepts the identical
    // provider refs and nothing else.
    if (attempt.state === "acknowledged") {
      if (
        args.result.outcome === "accepted" &&
        args.result.messageId === attempt.providerMessageRef
      ) {
        return { attempt, replayed: true };
      }
      throw domainError(
        "CONFLICT",
        `attempt is already acknowledged as ${attempt.providerMessageRef}`,
      );
    }
    if (attempt.state !== "requesting" && attempt.state !== "uncertain") {
      throw domainError(
        "CONFLICT",
        `attempt is ${attempt.state}; a provider outcome cannot land on it`,
      );
    }

    const draft = await ctx.db.get("drafts", attempt.draftId);
    if (draft === null) {
      throw domainError("NOT_FOUND", "draft not found");
    }
    const settle = async (
      target: "committed" | "released" | "uncertain",
      providerReference?: string,
    ) => {
      const reservation = await ctx.runMutation(
        internal.billing.reservations.getByOperationKey,
        {
          workspaceId: attempt.workspaceId,
          operationKey: attempt.operationKey,
        },
      );
      if (reservation === null) {
        return; // parked attempts never took a reservation
      }
      const fn =
        target === "committed"
          ? internal.billing.reservations.commit
          : target === "released"
            ? internal.billing.reservations.release
            : internal.billing.reservations.markUncertain;
      await ctx.runMutation(fn, {
        workspaceId: attempt.workspaceId,
        operationKey: attempt.operationKey,
        ...(providerReference !== undefined ? { providerReference } : {}),
      });
    };

    if (args.result.outcome === "accepted") {
      const messageId = boundedString(args.result.messageId, "messageId", {
        min: 1,
        max: 400,
      });
      const threadId = boundedString(args.result.threadId, "threadId", {
        min: 1,
        max: 400,
      });
      await ctx.db.patch("sendAttempts", attempt._id, {
        state: "acknowledged",
        providerMessageRef: messageId,
        providerThreadRef: threadId,
        ...(args.reconcile === true || attempt.state === "uncertain"
          ? { reconciledAt: now }
          : {}),
        updatedAt: now,
      });
      // Same transaction as the accepted outcome: an acknowledged send whose
      // conversation carries no thread ref loses every reply to it.
      await linkConversationThread(ctx, {
        attempt,
        threadId,
        at: now,
      });
      // Same transaction again (§8 step 5, P19): the provider's acceptance is
      // the ONLY fact that may stamp `lastContactedAt` and advance the lead —
      // `contacted` for a plain send, `booking_proposed` when this exact
      // draft carries a live booking link. Non-throwing by contract: a broken
      // association records less, never rolls back the acceptance.
      await ctx.runMutation(internal.prospects.markSendAccepted, {
        sendAttemptId: attempt._id,
        at: now,
      });
      await settle("committed", messageId);
      // Fold any delivery receipts that beat the acknowledgement.
      const early = await ctx.db
        .query("emailEventReceipts")
        .withIndex("by_providerMessageRef", (q) =>
          q.eq("providerMessageRef", messageId),
        )
        .collect();
      for (const receipt of early) {
        if (receipt.handlingState === "pending") {
          await applyReceiptToAttempt(ctx, receipt, attempt._id);
        }
      }
      await recordActivityEvent(ctx, {
        workspaceId: attempt.workspaceId,
        kind:
          attempt.state === "uncertain"
            ? "send_attempt_reconciled"
            : "send_attempt_acknowledged",
        summary: `Provider accepted send (message ${messageId})`,
        actor: "workflow",
        dedupeKey: `sendattempt:${attempt._id}:acknowledged`,
        conversationId: attempt.conversationId,
      });
    } else if (args.result.outcome === "rejected") {
      // Provider error text is unbounded input — truncate, never refuse to
      // record the outcome (a throw here strands the attempt in `requesting`).
      const providerError = args.result.providerError.slice(0, 500);
      await ctx.db.patch("sendAttempts", attempt._id, {
        state: "definitively_failed",
        error: {
          message: providerError,
          at: now,
          ...(args.result.httpStatus !== undefined
            ? { httpStatus: args.result.httpStatus }
            : {}),
          reason: "provider_rejected",
        },
        ...(args.reconcile === true || attempt.state === "uncertain"
          ? { reconciledAt: now }
          : {}),
        updatedAt: now,
      });
      await settle("released");
      await recordActivityEvent(ctx, {
        workspaceId: attempt.workspaceId,
        kind:
          attempt.state === "uncertain"
            ? "send_attempt_reconciled"
            : "send_attempt_failed",
        summary: `Provider rejected send: ${providerError.slice(0, 200)}`,
        actor: "workflow",
        dedupeKey: `sendattempt:${attempt._id}:failed`,
        conversationId: attempt.conversationId,
      });
    } else {
      const providerError = args.result.providerError.slice(0, 500);
      await ctx.db.patch("sendAttempts", attempt._id, {
        state: "uncertain",
        error: {
          message: providerError,
          at: now,
          ...(args.result.httpStatus !== undefined
            ? { httpStatus: args.result.httpStatus }
            : {}),
          reason: args.result.reason ?? "unknown",
        },
        updatedAt: now,
      });
      await settle("uncertain");
      await recordActivityEvent(ctx, {
        workspaceId: attempt.workspaceId,
        kind: "send_attempt_uncertain",
        summary: `Send outcome is uncertain — ${providerError.slice(0, 200)}`,
        actor: "workflow",
        dedupeKey: `sendattempt:${attempt._id}:uncertain`,
        conversationId: attempt.conversationId,
      });
    }

    const updated = await ctx.db.get("sendAttempts", attempt._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "send attempt not found after update");
    }
    return { attempt: updated, replayed: false };
  },
});


/* ------------------------------------------------------------------ */
/* The delivery-uncertain ask + stale-request sweep                      */
/* ------------------------------------------------------------------ */

/** Shared uncertain transition for a stale `requesting` attempt. */
async function markLostAcknowledgement(
  ctx: MutationCtx,
  attempt: Doc<"sendAttempts">,
): Promise<boolean> {
  if (
    attempt.state !== "requesting" ||
    attempt.requestStartedAt === undefined
  ) {
    return false;
  }
  await ctx.db.patch("sendAttempts", attempt._id, {
    state: "uncertain",
    error: {
      message:
        "dispatch outcome was never recorded — provider acknowledgement lost",
      at: Date.now(),
      reason: "lost_acknowledgement",
    },
    updatedAt: Date.now(),
  });
  const reservation = await ctx.runMutation(
    internal.billing.reservations.getByOperationKey,
    {
      workspaceId: attempt.workspaceId,
      operationKey: attempt.operationKey,
    },
  );
  if (reservation !== null && reservation.state === "reserved") {
    await ctx.runMutation(internal.billing.reservations.markUncertain, {
      workspaceId: attempt.workspaceId,
      operationKey: attempt.operationKey,
    });
  }
  const draft = await ctx.db.get("drafts", attempt.draftId);
  if (draft !== null) {
    await recordActivityEvent(ctx, {
      workspaceId: attempt.workspaceId,
      kind: "send_attempt_uncertain",
      summary: "Send attempt lost its acknowledgement — marked uncertain",
      actor: "system",
      dedupeKey: `sendattempt:${attempt._id}:uncertain`,
      conversationId: attempt.conversationId,
    });
  }
  return true;
}

/**
 * Lost-acknowledgement sweep: a `requesting` attempt older than the provider
 * timeout + margin means the dispatch action died between the commit point
 * and outcome recording. The attempt becomes `uncertain` (capacity retained)
 * and the delivery-uncertain ask is opened. Scheduled by the dispatch path
 * and safe to call at any time — any other state is a no-op.
 */
export const sweepStaleRequesting = internalMutation({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: v.object({ swept: v.boolean() }),
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null) {
      return { swept: false };
    }
    if (
      attempt.requestStartedAt !== undefined &&
      attempt.requestStartedAt + REQUEST_STALE_SWEEP_MS > Date.now()
    ) {
      return { swept: false };
    }
    return { swept: await markLostAcknowledgement(ctx, attempt) };
  },
});

/**
 * Workspace-wide sweep — the ops/probe entry point. `staleAfterMs` defaults
 * to the lost-acknowledgement margin; tests pass 0 to force-sweep.
 */
export const sweepStaleAttempts = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    staleAfterMs: v.optional(v.number()),
  },
  returns: v.object({
    swept: v.number(),
    sendAttemptIds: v.array(v.id("sendAttempts")),
  }),
  handler: async (ctx, args) => {
    const cutoff =
      Date.now() - (args.staleAfterMs ?? REQUEST_STALE_SWEEP_MS);
    const stale = await ctx.db
      .query("sendAttempts")
      .withIndex("by_workspaceId_and_state_and_updatedAt", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("state", "requesting")
          .lt("updatedAt", cutoff),
      )
      .collect();
    const sendAttemptIds: Id<"sendAttempts">[] = [];
    for (const attempt of stale) {
      if (await markLostAcknowledgement(ctx, attempt)) {
        sendAttemptIds.push(attempt._id);
      }
    }
    return { swept: sendAttemptIds.length, sendAttemptIds };
  },
});

/**
 * The cron belt (see `crons.ts`): workspace-agnostic sweep covering the two
 * durable wait states. `requesting` rows past the stale margin get the
 * lost-acknowledgement treatment; `reserved` rows whose recorded
 * `nextPermittedAt` passed get a fresh `dispatchAttempt` schedule — covers
 * a scheduled wake that never fired. Both bounds keep the scan small.
 */
export const sweepStaleAttemptsGlobal = internalMutation({
  args: {},
  returns: v.object({ swept: v.number(), redriven: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const staleRequesting = await ctx.db
      .query("sendAttempts")
      .withIndex("by_state_and_updatedAt", (q) =>
        q
          .eq("state", "requesting")
          .lt("updatedAt", now - REQUEST_STALE_SWEEP_MS),
      )
      .take(64);
    let swept = 0;
    for (const attempt of staleRequesting) {
      if (await markLostAcknowledgement(ctx, attempt)) {
        swept += 1;
      }
    }
    const overdue = await ctx.db
      .query("sendAttempts")
      .withIndex("by_state_and_nextPermittedAt", (q) =>
        q.eq("state", "reserved").lte("nextPermittedAt", now),
      )
      .take(64);
    let redriven = 0;
    for (const attempt of overdue) {
      // The wake is re-armed against the CURRENT time — the recorded
      // instant already passed. dispatchAttempt re-runs every gate; a
      // still-blocked attempt re-parks itself with a fresh schedule.
      await ctx.scheduler.runAfter(0, internal.sending.dispatchAttempt, {
        sendAttemptId: attempt._id,
      });
      redriven += 1;
    }
    return { swept, redriven };
  },
});

/* ------------------------------------------------------------------ */
/* Dispatch actions (single-flight, no retries)                          */
/* ------------------------------------------------------------------ */

/**
 * The action-level contract — also the return shape `workflows/send.ts`'s
 * journaled step consumes. `preflight_refused` covers every gate failure;
 * `outside_send_window` + `nextPermittedAt` is the only case a caller may
 * wait-and-retry on (the workflow sleeps durably; the non-workflow path
 * parks via `dispatchAttempt`). `acknowledged` is provider acceptance only —
 * never "delivered".
 */
const vDispatchOutcome = v.union(
  v.object({
    outcome: v.literal("acknowledged"),
    sendAttemptId: v.id("sendAttempts"),
    providerMessageRef: v.string(),
    providerThreadRef: v.string(),
  }),
  v.object({
    outcome: v.literal("definitively_failed"),
    sendAttemptId: v.id("sendAttempts"),
    reason: v.string(),
  }),
  v.object({
    outcome: v.literal("uncertain"),
    sendAttemptId: v.id("sendAttempts"),
    reason: v.string(),
  }),
  v.object({
    outcome: v.literal("preflight_refused"),
    code: v.string(),
    reason: v.string(),
    nextPermittedAt: v.optional(v.number()),
    sendAttemptId: v.optional(v.id("sendAttempts")),
  }),
  v.object({
    outcome: v.literal("already_resolved"),
    sendAttemptId: v.id("sendAttempts"),
    state: v.string(),
  }),
  v.object({
    // A provider request for this draft is live — distinct from
    // `already_resolved` so a journaled caller never records "resolved"
    // for mail still in flight.
    outcome: v.literal("in_flight"),
    sendAttemptId: v.id("sendAttempts"),
    state: v.string(),
  }),
);

type DispatchOutcome = Infer<typeof vDispatchOutcome>;

/**
 * Shared per-attempt executor: commit point → ONE provider request → record.
 * Called by `sendApprovedDraft` (fresh intent) and by `dispatchAttempt`
 * (the durable reschedule target for window/limit waits and reconciliation).
 */
async function executeAttemptDispatch(
  ctx: ActionCtx,
  sendAttemptId: Id<"sendAttempts">,
): Promise<DispatchOutcome> {
  const begin = await ctx.runMutation(internal.sending.beginDispatch, {
    sendAttemptId,
  });
  if (begin.action === "wait") {
    // `beginDispatch` already parked the attempt with a recorded
    // `nextPermittedAt` AND scheduled the re-drive transactionally — this
    // action must not schedule again. Reported to callers (incl. the
    // workflow boundary) as `preflight_refused`/`outside_send_window` so a
    // journaled caller may also sleep durably on the same instant.
    return {
      outcome: "preflight_refused",
      sendAttemptId,
      code: "outside_send_window",
      nextPermittedAt: begin.nextPermittedAt,
      reason: begin.reason,
    };
  }
  if (begin.action === "blocked") {
    return {
      outcome: "preflight_refused",
      sendAttemptId,
      code: begin.code,
      reason: begin.reason,
    };
  }
  if (begin.action === "done") {
    return {
      outcome: "already_resolved",
      sendAttemptId,
      state: "acknowledged",
    };
  }

  // The lost-acknowledgement sweep was scheduled inside `beginDispatch`'s
  // commit transaction — a `requesting` row always has its recovery path.

  // Exactly one provider request. The adapter never retries; it classifies
  // transport results itself, so a returned value is already an honest
  // outcome. A THROWN error is different: `runAction` can fail because the
  // callee isolate was killed or the invocation transport broke — possibly
  // AFTER the provider request was issued. That is provably unknowable, so
  // it lands `uncertain` (the reconcile path treats its identical catch the
  // same way): a false-uncertain costs a human review, a false-rejected can
  // double-send.
  let result:
    | {
        outcome: "accepted";
        messageId: string;
        threadId: string;
        httpStatus?: number;
      }
    | { outcome: "rejected"; httpStatus?: number; providerError: string }
    | {
        outcome: "uncertain";
        providerError: string;
        httpStatus?: number;
        reason?: string;
      };
  try {
    if (begin.endpointOperation === "reply") {
      const call = await ctx.runAction(
        internal.integrations.agentmail.executeReplyAttempt,
        {
          inboxId: begin.inboxRef,
          idempotencyKey: begin.providerIdempotencyKey,
          parentMessageId: begin.parentMessageId ?? "",
          payload: begin.payload,
        },
      );
      result = transportToOutcome(call);
    } else {
      const call = await ctx.runAction(
        internal.integrations.agentmail.executeSendAttempt,
        {
          inboxId: begin.inboxRef,
          idempotencyKey: begin.providerIdempotencyKey,
          payload: begin.payload,
        },
      );
      result = transportToOutcome(call);
    }
  } catch (error) {
    result = {
      outcome: "uncertain",
      reason: "dispatch_error",
      providerError: `dispatch invocation failed (outcome unknown): ${error instanceof Error ? error.message : String(error)}`.slice(
        0,
        500,
      ),
    };
  }

  const recorded = await ctx.runMutation(internal.sending.recordSendOutcome, {
    sendAttemptId,
    result,
  });
  if (result.outcome === "uncertain") {
    return {
      outcome: "uncertain",
      sendAttemptId,
      reason: result.providerError,
    };
  }
  if (result.outcome === "rejected") {
    // Provider refusal OR a provably pre-request failure — both land as
    // `definitively_failed`; sendResultCode still distinguishes them for UI.
    return {
      outcome: "definitively_failed",
      sendAttemptId,
      reason: result.providerError,
    };
  }
  return {
    outcome: "acknowledged",
    sendAttemptId,
    providerMessageRef: recorded.attempt.providerMessageRef ?? "",
    providerThreadRef: recorded.attempt.providerThreadRef ?? "",
  };
}

/** The domain-error code carried by a thrown ConvexError, if any. */
function thrownCode(error: unknown): string | undefined {
  if (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null
  ) {
    const code = (error.data as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function transportToOutcome(call: {
  outcome: "accepted" | "rejected" | "uncertain";
  messageId?: string;
  threadId?: string;
  httpStatus?: number;
  providerError?: string;
  reason?: string;
  detail?: string;
}):
  | { outcome: "accepted"; messageId: string; threadId: string; httpStatus?: number }
  | { outcome: "rejected"; httpStatus?: number; providerError: string }
  | { outcome: "uncertain"; providerError: string; httpStatus?: number; reason?: string } {
  if (call.outcome === "accepted") {
    return {
      outcome: "accepted",
      messageId: call.messageId ?? "",
      threadId: call.threadId ?? "",
      httpStatus: call.httpStatus,
    };
  }
  if (call.outcome === "rejected") {
    return {
      outcome: "rejected",
      httpStatus: call.httpStatus,
      providerError: call.providerError ?? "provider rejected the request",
    };
  }
  return {
    outcome: "uncertain",
    providerError: call.detail ?? call.providerError ?? "outcome unknown",
    httpStatus: call.httpStatus,
    reason: call.reason,
  };
}

/**
 * Entry point for dispatching an approved draft: reserves the intent, parks
 * on the send window/limit when necessary, or executes immediately. Called
 * from `approvals.approve` and the public `requestDispatch` trigger.
 * Idempotent on the draft's operation key.
 */
export const sendApprovedDraft = internalAction({
  args: {
    draftId: v.id("drafts"),
  },
  returns: vDispatchOutcome,
  handler: async (ctx, args): Promise<DispatchOutcome> => {
    let gate;
    try {
      gate = await ctx.runMutation(internal.sending.reserveSendIntent, args);
    } catch (error) {
      // Retry once only on optimistic-concurrency conflicts — a capacity
      // race is transient. A deterministic domain error (NOT_FOUND, INVALID)
      // would fail identically and must surface with its real code, never
      // relabelled as a transient attempt conflict.
      if (thrownCode(error) !== "CONFLICT") {
        throw error;
      }
      try {
        gate = await ctx.runMutation(
          internal.sending.reserveSendIntent,
          args,
        );
      } catch (retryError) {
        return {
          outcome: "preflight_refused" as const,
          code: "unresolved_attempt",
          reason:
            retryError instanceof Error
              ? retryError.message.slice(0, 400)
              : "reserve failed",
        };
      }
    }
    if (gate.action === "blocked") {
      return {
        outcome: "preflight_refused",
        code: gate.code,
        reason: gate.reason,
      };
    }
    if (gate.action === "wait") {
      // `reserveSendIntent` parked the attempt and scheduled the re-drive
      // transactionally — nothing more to schedule here.
      return {
        outcome: "preflight_refused",
        sendAttemptId: gate.sendAttemptId,
        code: "outside_send_window",
        nextPermittedAt: gate.nextPermittedAt,
        reason: gate.reason,
      };
    }
    if (gate.action === "existing") {
      // `existing` only ever reports `reserved` or `requesting` (uncertain
      // is blocked earlier with `attempt_uncertain`). A live provider
      // request is NOT resolved — report it honestly as in-flight.
      if (gate.state === "reserved") {
        return await executeAttemptDispatch(ctx, gate.sendAttemptId);
      }
      return {
        outcome: "in_flight",
        sendAttemptId: gate.sendAttemptId,
        state: gate.state,
      };
    }
    return await executeAttemptDispatch(ctx, gate.sendAttemptId);
  },
});

/**
 * Durable re-entry for a parked/scheduled attempt — the reschedule target
 * for send-window waits. Re-runs every gate via `beginDispatch`; if the
 * window is still closed it reschedules itself, so a workspace restart never
 * loses the wait.
 */
export const dispatchAttempt = internalAction({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: vDispatchOutcome,
  handler: async (ctx, args): Promise<Infer<typeof vDispatchOutcome>> =>
    await executeAttemptDispatch(ctx, args.sendAttemptId),
});

/* ------------------------------------------------------------------ */
/* Reconciliation (§8.7)                                                 */
/* ------------------------------------------------------------------ */

const vPrepareResult = v.union(
  v.object({
    action: v.literal("replay"),
    sendAttemptId: v.id("sendAttempts"),
    inboxRef: v.string(),
    providerIdempotencyKey: v.string(),
    endpointOperation: v.union(v.literal("send"), v.literal("reply")),
    parentMessageId: v.optional(v.string()),
    payload: vSendPayload,
  }),
  v.object({
    action: v.literal("wait"),
    nextPermittedAt: v.number(),
    reason: v.string(),
  }),
  v.object({
    action: v.literal("needs_review"),
    reason: v.string(),
  }),
  v.object({
    action: v.literal("resolved"),
    state: vSendAttemptState,
  }),
  v.object({
    // A provider request is still live — distinct from `resolved` so a
    // journaled caller never records "resolved" for mail in flight.
    action: v.literal("in_flight"),
    state: vSendAttemptState,
  }),
);

/**
 * Guarded recheck before an uncertain attempt may be replayed (G3 step 8):
 * the SAME idempotency key + SAME payload, only inside the provider's key
 * retention window, and only while workspace policy still permits dispatch
 * (not paused, no takeover, no suppression, context unchanged, inside the
 * send window). Anything else routes to human review — the recorded
 * attempt stays `uncertain`.
 */
export const prepareReconcile = internalMutation({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: vPrepareResult,
  handler: async (ctx, args): Promise<Infer<typeof vPrepareResult>> => {
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    if (attempt.state !== "uncertain") {
      if (attempt.state === "reserved" || attempt.state === "requesting") {
        return { action: "in_flight" as const, state: attempt.state };
      }
      return { action: "resolved" as const, state: attempt.state };
    }
    const started = attempt.requestStartedAt ?? attempt.createdAt;
    if (started + RECONCILE_WINDOW_MS < Date.now()) {
      return {
        action: "needs_review" as const,
        reason:
          "provider idempotency window has expired — replay can no longer prove the original outcome; human review required",
      };
    }
    const context = await loadAttemptContext(ctx, attempt.draftId);
    const { workspace, conversation, draft, agent } = context;
    const gate = await evaluateSendGates(ctx, {
      workspace,
      conversation,
      draft,
      agent,
      excludeAttemptId: attempt._id,
    });
    if (!gate.ok) {
      return {
        action: "needs_review" as const,
        reason: `policy no longer permits dispatch (${gate.code}: ${gate.reason})`,
      };
    }
    const window = sendWindowStatus(workspace, Date.now());
    if (!window.permitted) {
      // Transactional re-drive — a reconcile wait can never be lost between
      // this return and a caller-side schedule.
      await ctx.scheduler.runAfter(
        Math.max(0, window.nextPermittedAt - Date.now()),
        internal.sending.reconcileUncertainAttempt,
        { sendAttemptId: attempt._id },
      );
      return {
        action: "wait" as const,
        nextPermittedAt: window.nextPermittedAt,
        reason: "outside_window",
      };
    }
    return {
      action: "replay" as const,
      sendAttemptId: attempt._id,
      inboxRef: draft.inboxRef,
      providerIdempotencyKey: attempt.providerIdempotencyKey,
      endpointOperation: attempt.endpointOperation,
      parentMessageId: draft.replyToMessageRef,
      payload: {
        to: draft.normalizedRecipient,
        ...(draft.subject.length > 0 ? { subject: draft.subject } : {}),
        text: draft.body,
      },
    };
  },
});

/**
 * The reconciliation action: guarded recheck → ONE replay with the SAME
 * provider idempotency key → record the verdict. Never mints a fresh key;
 * an expired window or a policy block returns needs_review and leaves the
 * attempt (and its ask) for a human.
 */
export const reconcileUncertainAttempt = internalAction({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: vDispatchOutcome,
  handler: async (ctx, args): Promise<DispatchOutcome> => {
    const prepared = await ctx.runMutation(internal.sending.prepareReconcile, {
      sendAttemptId: args.sendAttemptId,
    });
    if (prepared.action === "resolved") {
      return {
        outcome: "already_resolved",
        sendAttemptId: args.sendAttemptId,
        state: prepared.state,
      };
    }
    if (prepared.action === "in_flight") {
      return {
        outcome: "in_flight",
        sendAttemptId: args.sendAttemptId,
        state: prepared.state,
      };
    }
    if (prepared.action === "needs_review") {
      return {
        outcome: "uncertain",
        sendAttemptId: args.sendAttemptId,
        reason: `needs human review: ${prepared.reason}`,
      };
    }
    if (prepared.action === "wait") {
      // `prepareReconcile` already scheduled the re-drive transactionally.
      return {
        outcome: "preflight_refused",
        sendAttemptId: args.sendAttemptId,
        code: "outside_send_window",
        nextPermittedAt: prepared.nextPermittedAt,
        reason: prepared.reason,
      };
    }

    let result;
    try {
      if (prepared.endpointOperation === "reply") {
        const call = await ctx.runAction(
          internal.integrations.agentmail.reconcileReplyAttempt,
          {
            inboxId: prepared.inboxRef,
            idempotencyKey: prepared.providerIdempotencyKey,
            parentMessageId: prepared.parentMessageId ?? "",
            payload: prepared.payload,
          },
        );
        result = transportToOutcome(call);
      } else {
        const call = await ctx.runAction(
          internal.integrations.agentmail.reconcileSendAttempt,
          {
            inboxId: prepared.inboxRef,
            idempotencyKey: prepared.providerIdempotencyKey,
            payload: prepared.payload,
          },
        );
        result = transportToOutcome(call);
      }
    } catch (error) {
      // A pre-request failure proves nothing about the original request —
      // the attempt stays uncertain.
      return {
        outcome: "uncertain",
        sendAttemptId: args.sendAttemptId,
        reason: `reconcile request could not be issued: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          400,
        ),
      };
    }
    const recorded = await ctx.runMutation(
      internal.sending.recordSendOutcome,
      {
        sendAttemptId: args.sendAttemptId,
        result,
        reconcile: true,
      },
    );
    if (result.outcome === "uncertain") {
      return {
        outcome: "uncertain",
        sendAttemptId: args.sendAttemptId,
        reason: result.providerError,
      };
    }
    if (result.outcome === "accepted") {
      return {
        outcome: "acknowledged",
        sendAttemptId: args.sendAttemptId,
        providerMessageRef: recorded.attempt.providerMessageRef ?? "",
        providerThreadRef: recorded.attempt.providerThreadRef ?? "",
      };
    }
    return {
      outcome: "definitively_failed",
      sendAttemptId: args.sendAttemptId,
      reason: result.providerError,
    };
  },
});

/**
 * Read-only evidence bundle for an attempt (G3 step 8): the provider-side
 * message/thread existence check plus every recorded receipt — the input a
 * human (or a probe) needs to resolve a `delivery_uncertain` ask honestly.
 * Performs no writes and issues no provider mutations.
 */
const vEvidenceResult = v.object({
  sendAttemptId: v.id("sendAttempts"),
  state: vSendAttemptState,
  providerMessageRef: v.optional(v.string()),
  providerThreadRef: v.optional(v.string()),
  provider: v.object({
    message: v.union(
      v.object({ messageId: v.string(), threadId: v.string() }),
      v.null(),
    ),
    thread: v.union(
      v.object({
        threadId: v.string(),
        messageCount: v.optional(v.number()),
      }),
      v.null(),
    ),
    error: v.optional(v.string()),
  }),
  receipts: v.array(
    v.object({
      providerEventId: v.string(),
      eventType: v.string(),
      handlingState: v.string(),
      receivedAt: v.number(),
      handledAt: v.optional(v.number()),
    }),
  ),
  deliveryFacts: v.optional(v.record(v.string(), v.any())),
  withinReconcileWindow: v.boolean(),
});

export const gatherProviderEvidence = internalAction({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: vEvidenceResult,
  handler: async (ctx, args): Promise<Infer<typeof vEvidenceResult>> => {
    const attempt = await ctx.runQuery(internal.sendAttempts.getInternal, {
      sendAttemptId: args.sendAttemptId,
    });
    if (attempt === null) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    const receipts = await ctx.runQuery(
      internal.sendAttempts.receiptsForAttempt,
      { sendAttemptId: args.sendAttemptId },
    );
    const provider = await ctx.runAction(
      internal.integrations.agentmail.lookupProviderMessage,
      {
        inboxId: attempt.inboxRef,
        ...(attempt.providerMessageRef !== undefined
          ? { messageId: attempt.providerMessageRef }
          : {}),
        ...(attempt.providerThreadRef !== undefined
          ? { threadId: attempt.providerThreadRef }
          : {}),
      },
    );
    const started = attempt.requestStartedAt ?? attempt.createdAt;
    return {
      sendAttemptId: attempt._id,
      state: attempt.state,
      ...(attempt.providerMessageRef !== undefined
        ? { providerMessageRef: attempt.providerMessageRef }
        : {}),
      ...(attempt.providerThreadRef !== undefined
        ? { providerThreadRef: attempt.providerThreadRef }
        : {}),
      provider,
      receipts: receipts.map((receipt) => ({
        providerEventId: receipt.providerEventId,
        eventType: receipt.eventType,
        handlingState: receipt.handlingState,
        receivedAt: receipt.receivedAt,
        ...(receipt.handledAt !== undefined
          ? { handledAt: receipt.handledAt }
          : {}),
      })),
      ...(attempt.providerDeliveryFacts !== undefined
        ? { deliveryFacts: attempt.providerDeliveryFacts }
        : {}),
      withinReconcileWindow:
        started + RECONCILE_WINDOW_MS >= Date.now(),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Public triggers + honest surfacing                                    */
/* ------------------------------------------------------------------ */

/**
 * Trigger the send boundary for a draft (owner/operator). Only schedules —
 * every gate still runs inside `sendApprovedDraft`; calling this on an
 * unapproved draft is a safe no-op that surfaces `preflight_refused` in the
 * attempt audit. Idempotent via the operation key.
 */
export const requestDispatch = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    draftId: v.id("drafts"),
  },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    await getDraftInWorkspace(ctx, args.workspaceId, args.draftId);
    await ctx.scheduler.runAfter(
      0,
      internal.sending.sendApprovedDraft,
      {
        draftId: args.draftId,
      },
    );
    return { scheduled: true };
  },
});

/**
 * Ask for one guarded reconciliation replay of an uncertain attempt
 * (owner/operator). Refuses once the provider's idempotency window has
 * expired — that case is human-review-only by design.
 */
export const requestReconciliation = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    sendAttemptId: v.id("sendAttempts"),
  },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null || attempt.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    if (attempt.state !== "uncertain") {
      throw domainError(
        "CONFLICT",
        `attempt is ${attempt.state}; reconciliation applies to uncertain attempts only`,
      );
    }
    const started = attempt.requestStartedAt ?? attempt.createdAt;
    if (started + RECONCILE_WINDOW_MS < Date.now()) {
      throw domainError(
        "CONFLICT",
        "the provider idempotency window has expired — a human must resolve the uncertain attempt instead",
      );
    }
    await ctx.scheduler.runAfter(
      0,
      internal.sending.reconcileUncertainAttempt,
      { sendAttemptId: args.sendAttemptId },
    );
    return { scheduled: true };
  },
});

/**
 * Cancel a `reserved` (pre-dispatch) send intent — the only attempt state a
 * human can retract, because nothing has reached the provider yet.
 */
export const cancelAttempt = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    sendAttemptId: v.id("sendAttempts"),
  },
  returns: vSendAttemptDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null || attempt.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    if (attempt.state !== "reserved") {
      throw domainError(
        "CONFLICT",
        `attempt is ${attempt.state}; only a reserved (pre-dispatch) intent can be cancelled`,
      );
    }
    const now = Date.now();
    await ctx.db.patch("sendAttempts", attempt._id, {
      state: "cancelled",
      error: { message: "cancelled by operator", at: now, reason: "manual" },
      updatedAt: now,
    });
    const reservation = await ctx.runMutation(
      internal.billing.reservations.getByOperationKey,
      {
        workspaceId: args.workspaceId,
        operationKey: attempt.operationKey,
      },
    );
    if (reservation !== null && reservation.state === "reserved") {
      await ctx.runMutation(internal.billing.reservations.release, {
        workspaceId: args.workspaceId,
        operationKey: attempt.operationKey,
      });
    }
    const draft = await ctx.db.get("drafts", attempt.draftId);
    if (draft !== null) {
      await recordActivityEvent(ctx, {
        workspaceId: args.workspaceId,
        kind: "send_attempt_cancelled",
        summary: "Reserved send intent cancelled by operator",
        actor: "operator",
        dedupeKey: `sendattempt:${attempt._id}:cancelled`,
        conversationId: attempt.conversationId,
      });
    }
    const updated = await ctx.db.get("sendAttempts", attempt._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "send attempt not found after update");
    }
    return updated;
  },
});

/**
 * Retire every parked `reserved` intent on a conversation — invoked by
 * `drafts` when a revision or inbound context invalidates the draft an
 * attempt was authorized against. `reserved` is provably pre-dispatch (the
 * commit point flips to `requesting`), so cancelling can never retract a
 * sent request; `requesting`/`uncertain` rows are untouched — those are
 * honest in-flight states the reconcile path owns.
 */
export const cancelParkedConversationAttempts = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    reason: v.string(),
  },
  returns: v.object({ cancelled: v.number() }),
  handler: async (ctx, args) => {
    const parked = await ctx.db
      .query("sendAttempts")
      .withIndex("by_conversationId_and_state", (q) =>
        q
          .eq("conversationId", args.conversationId)
          .eq("state", "reserved"),
      )
      .collect();
    const now = Date.now();
    for (const attempt of parked) {
      await ctx.db.patch("sendAttempts", attempt._id, {
        state: "cancelled",
        error: {
          message: args.reason.slice(0, 200),
          at: now,
          reason: "superseded",
        },
        updatedAt: now,
      });
      const reservation = await ctx.runMutation(
        internal.billing.reservations.getByOperationKey,
        {
          workspaceId: args.workspaceId,
          operationKey: attempt.operationKey,
        },
      );
      if (reservation !== null && reservation.state === "reserved") {
        await ctx.runMutation(internal.billing.reservations.release, {
          workspaceId: args.workspaceId,
          operationKey: attempt.operationKey,
        });
      }
      const draft = await ctx.db.get("drafts", attempt.draftId);
      if (draft !== null) {
        await recordActivityEvent(ctx, {
          workspaceId: args.workspaceId,
          kind: "send_attempt_cancelled",
          summary: `Parked send intent retired — ${args.reason.slice(0, 160)}`,
          actor: "workflow",
          dedupeKey: `sendattempt:${attempt._id}:cancelled`,
          conversationId: args.conversationId,
        });
      }
    }
    return { cancelled: parked.length };
  },
});

/**
 * Per-draft parked-cancel — the booking lifecycle's precise half of
 * `cancelParkedConversationAttempts`. Retiring the drafts that offer a
 * rescheduled or cancelled booking must not touch OTHER revisions' parked
 * intents on the same thread.
 */
export const cancelDraftParkedAttempts = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    draftId: v.id("drafts"),
    reason: v.string(),
  },
  returns: v.object({ cancelled: v.number() }),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get("drafts", args.draftId);
    if (draft === null || draft.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "draft not found");
    }
    const parked = await ctx.db
      .query("sendAttempts")
      .withIndex("by_draftId", (q) => q.eq("draftId", args.draftId))
      .collect();
    const now = Date.now();
    let cancelled = 0;
    for (const attempt of parked) {
      if (attempt.state !== "reserved") {
        continue;
      }
      await ctx.db.patch("sendAttempts", attempt._id, {
        state: "cancelled",
        error: {
          message: args.reason.slice(0, 200),
          at: now,
          reason: "superseded",
        },
        updatedAt: now,
      });
      const reservation = await ctx.runMutation(
        internal.billing.reservations.getByOperationKey,
        {
          workspaceId: args.workspaceId,
          operationKey: attempt.operationKey,
        },
      );
      if (reservation !== null && reservation.state === "reserved") {
        await ctx.runMutation(internal.billing.reservations.release, {
          workspaceId: args.workspaceId,
          operationKey: attempt.operationKey,
        });
      }
      await recordActivityEvent(ctx, {
        workspaceId: args.workspaceId,
        kind: "send_attempt_cancelled",
        summary: `Parked send intent retired — ${args.reason.slice(0, 160)}`,
        actor: "workflow",
        dedupeKey: `sendattempt:${attempt._id}:cancelled`,
        conversationId: attempt.conversationId,
      });
      cancelled += 1;
    }
    return { cancelled };
  },
});

/* ------------------------------------------------------------------ */
/* Public preflight preview (minimal honest surfacing)                   */
/* ------------------------------------------------------------------ */

/**
 * Dry-run the send preflight for a draft (member-readable). Reports the
 * first blocking gate and the send-window state — the same checks
 * `beginDispatch` will enforce, so the UI can show an honest "why not yet".
 */
export const preflight = query({
  args: {
    workspaceId: v.id("workspaces"),
    draftId: v.id("drafts"),
  },
  returns: v.object({
    permitted: v.boolean(),
    code: v.optional(v.string()),
    reason: v.optional(v.string()),
    nextPermittedAt: v.optional(v.number()),
    attempts: v.array(
      v.object({
        sendAttemptId: v.id("sendAttempts"),
        state: vSendAttemptState,
        resultCode: vSendResultCode,
        createdAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const draft = await getDraftInWorkspace(
      ctx,
      args.workspaceId,
      args.draftId,
    );
    const attempts = await ctx.db
      .query("sendAttempts")
      .withIndex("by_draftId", (q) => q.eq("draftId", draft._id))
      .collect();
    const attemptsView = attempts
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((attempt) => ({
        sendAttemptId: attempt._id,
        state: attempt.state,
        resultCode: sendResultCode(attempt),
        createdAt: attempt.createdAt,
      }));

    const conversation = await ctx.db.get(
      "conversations",
      draft.conversationId,
    );
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (conversation === null || workspace === null) {
      return {
        permitted: false,
        code: "workspace_paused",
        reason: "send context is incomplete",
        attempts: attemptsView,
      };
    }
    const agent =
      conversation.agentId === undefined
        ? null
        : await ctx.db.get("agents", conversation.agentId);
    const gate = await evaluateSendGates(ctx, {
      workspace,
      conversation,
      draft,
      agent,
    });
    if (!gate.ok) {
      return {
        permitted: false,
        code: gate.code,
        reason: gate.reason,
        attempts: attemptsView,
      };
    }
    const window = sendWindowStatus(workspace, Date.now());
    if (!window.permitted) {
      return {
        permitted: false,
        code: "outside_window",
        reason: "outside the workspace send window",
        nextPermittedAt: window.nextPermittedAt,
        attempts: attemptsView,
      };
    }
    const periodKey = localDayKey(Date.now(), workspace.timezone);
    const limit = effectiveSendLimit(workspace);
    const bucket = await ctx.db
      .query("usageBuckets")
      .withIndex(
        "by_workspaceId_and_scopeKey_and_metric_and_periodKey",
        (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("scopeKey", "workspace")
            .eq("metric", "sends")
            .eq("periodKey", periodKey),
      )
      .unique();
    const used =
      bucket === null
        ? 0
        : bucket.reserved + bucket.committed + bucket.uncertain;
    if (limit - used < 1) {
      return {
        permitted: false,
        code: "send_limit_reached",
        reason: `daily send allowance exhausted (${used}/${limit})`,
        nextPermittedAt: nextWindowStart(workspace, Date.now()),
        attempts: attemptsView,
      };
    }
    return { permitted: true, attempts: attemptsView };
  },
});
