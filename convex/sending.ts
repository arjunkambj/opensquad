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
 *                        recorded `delivery_uncertain` decision is the
 *                        human-attention surface; a replacement send exists
 *                        only through that decision's §8.7 binding.
 *
 * The Workflow send boundary for P09 lives in `convex/workflows/send.ts`;
 * `approvals.approve` also schedules `sendApprovedDraft` directly so an
 * approved draft dispatches even where no owning workflow stage exists yet.
 * Both paths converge on the same idempotent gates below.
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
  invalid,
  localCivilToUtc,
  localDayKey,
  localDayParts,
  readReplacementAnswer,
  REPLACEMENT_ACKNOWLEDGEMENT,
  REPLACEMENT_ANSWER_FIELDS,
  sendWindowStatus,
  UNRESOLVED_ATTEMPT_STATES,
  vSendAttemptState,
} from "./lib/validators";
import { recordActivityEvent } from "./activity";
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
  "mission_inactive",
  "campaign_inactive",
  "conversation_not_open",
  "human_takeover",
  "draft_not_current",
  "context_changed",
  "no_current_approval",
  "policy_changed",
  "brief_changed",
  "inbox_unassigned",
  "inbox_mismatch",
  "suppressed_email",
  "suppressed_domain",
  "demo_recipient_blocked",
  "already_sent",
  "attempt_in_flight",
  "attempt_uncertain",
  "attempt_failed",
  "unresolved_attempt",
  "missing_replacement_authorization",
  "outside_window",
  "send_limit_reached",
  "workflow_superseded",
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
 * The §8.7 covering check for one `uncertain` attempt: a resolved
 * `delivery_uncertain` decision must name THIS attempt and the replacement
 * draft by ID + payload hash + live context version, and must not already
 * have been consumed by another attempt (one recorded replacement per
 * resolution, enforced transactionally via `by_replacementDecisionId`).
 */
async function coveringDecisionValid(
  ctx: AuthCtx,
  args: {
    decisionId: Id<"decisions">;
    /** The specific uncertain attempt the binding must name — `undefined`
     *  when validating that the decision authorizes THIS draft at all (the
     *  covered-attempt name is then not re-checked). */
    uncertainAttemptId?: Id<"sendAttempts">;
    draft: Doc<"drafts">;
    conversation: Doc<"conversations">;
    selfAttemptId?: Id<"sendAttempts">;
  },
): Promise<boolean> {
  const decision = await ctx.db.get("decisions", args.decisionId);
  if (
    decision === null ||
    decision.kind !== "delivery_uncertain" ||
    decision.state !== "resolved" ||
    decision.answer?.approved !== true
  ) {
    return false;
  }
  let binding;
  try {
    binding = readReplacementAnswer(decision.answer);
  } catch {
    return false;
  }
  if (
    (args.uncertainAttemptId !== undefined &&
      binding.unresolvedAttemptId !== String(args.uncertainAttemptId)) ||
    binding.replacementDraftId !== String(args.draft._id) ||
    binding.replacementPayloadHash !== args.draft.payloadHash ||
    binding.contextVersion !== args.conversation.contextVersion
  ) {
    return false;
  }
  // Consume-once: another attempt must not already carry this authorization.
  const consumed = await ctx.db
    .query("sendAttempts")
    .withIndex("by_replacementDecisionId", (q) =>
      q.eq("replacementDecisionId", args.decisionId),
    )
    .collect();
  return consumed.every(
    (attempt) =>
      attempt._id === args.selfAttemptId ||
      attempt.state === "cancelled" ||
      attempt.state === "definitively_failed",
  );
}

/**
 * Unwind §8.7 coverage when a covering attempt dies without sending: an
 * uncertain attempt whose `coveredByAttemptId` points at `attempt` was never
 * actually resolved by a send, so the across-revisions guard must treat it
 * as uncovered again (a fresh delivery_uncertain decision becomes required).
 * Coverage links only ever point within one conversation.
 */
async function releaseCoverageLinks(
  ctx: MutationCtx,
  attempt: Doc<"sendAttempts">,
): Promise<void> {
  const uncovered = await ctx.db
    .query("sendAttempts")
    .withIndex("by_conversationId_and_state", (q) =>
      q.eq("conversationId", attempt.conversationId).eq("state", "uncertain"),
    )
    .collect();
  for (const other of uncovered) {
    if (other.coveredByAttemptId === attempt._id) {
      await ctx.db.patch("sendAttempts", other._id, {
        coveredByAttemptId: undefined,
        updatedAt: Date.now(),
      });
    }
  }
}

/**
 * Every send gate that does not depend on wall-clock window/capacity:
 * workspace/campaign/mission liveness, exact approval + context binding,
 * takeover/closed state, suppression, inbox match, demo allowlist, and the
 * across-revisions unresolved-attempt guard with the §8.7 exception.
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
    mission: Doc<"missions">;
    campaign: Doc<"campaigns">;
    excludeAttemptId?: Id<"sendAttempts">;
    replacementDecisionId?: Id<"decisions">;
  },
): Promise<GateResult> {
  const { workspace, conversation, draft, mission, campaign } = args;

  // --- liveness ------------------------------------------------------
  if (workspace.automationState !== "active") {
    return block(
      "workspace_paused",
      `workspace automation is ${workspace.automationState}`,
    );
  }
  if (
    mission.state === "paused" ||
    mission.state === "cancelled" ||
    mission.state === "failed" ||
    mission.state === "completed"
  ) {
    return block("mission_inactive", `mission is ${mission.state}`);
  }
  if (campaign.status !== "active") {
    return block("campaign_inactive", `campaign is ${campaign.status}`);
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
  if (campaign.briefVersion !== draft.campaignBriefVersion) {
    return block(
      "brief_changed",
      `campaign brief is v${campaign.briefVersion}; draft was written against v${draft.campaignBriefVersion}`,
    );
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
      `recipient is suppressed by a ${suppression.matchedBy} record (${suppression.suppression.reason})`,
    );
  }

  // --- demo scope --------------------------------------------------------
  if (workspace.demoMode) {
    const allowed = (process.env.OPENSQUAD_DEMO_ALLOWED_RECIPIENTS ?? "")
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
    if (allowed.length === 0) {
      return block(
        "demo_recipient_blocked",
        "demo workspace has no configured recipient allowlist — demo sending is disabled",
      );
    }
    if (!allowed.includes(draft.normalizedRecipient)) {
      return block(
        "demo_recipient_blocked",
        "recipient is not on the demo allowlist",
      );
    }
  }

  // --- across-revisions unresolved-attempt guard -------------------------
  // A carried replacement authorization must bind THIS draft even when no
  // uncovered attempt remains (the chain may already be fully covered) —
  // otherwise an unrelated decision id could decorate a send it never
  // authorized.
  if (args.replacementDecisionId !== undefined) {
    const authorized = await coveringDecisionValid(ctx, {
      decisionId: args.replacementDecisionId,
      uncertainAttemptId: undefined,
      draft,
      conversation,
      selfAttemptId: args.excludeAttemptId,
    });
    if (!authorized) {
      return block(
        "missing_replacement_authorization",
        "the replacement decision does not authorize this draft revision",
      );
    }
  }
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
      // An attempt already covered by a recorded replacement carries
      // `coveredByAttemptId` — its uncertainty was resolved when the human
      // authorized the replacement, so coverage is transitive down the
      // chain: only the LATEST still-uncovered uncertain attempt needs a
      // fresh delivery_uncertain decision on this dispatch.
      if (other.coveredByAttemptId !== undefined) {
        continue;
      }
      const covered =
        args.replacementDecisionId !== undefined &&
        (await coveringDecisionValid(ctx, {
          decisionId: args.replacementDecisionId,
          uncertainAttemptId: other._id,
          draft,
          conversation,
          selfAttemptId: args.excludeAttemptId,
        }));
      if (!covered) {
        return block(
          "missing_replacement_authorization",
          "an uncertain send attempt on this conversation requires a recorded delivery_uncertain replacement decision before anything else dispatches",
        );
      }
      continue;
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
  mission: Doc<"missions">;
  campaign: Doc<"campaigns">;
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
  const mission = await ctx.db.get("missions", draft.missionId);
  const campaign =
    mission === null
      ? null
      : await ctx.db.get("campaigns", mission.campaignId);
  if (
    conversation === null ||
    workspace === null ||
    mission === null ||
    campaign === null
  ) {
    throw domainError("NOT_FOUND", "send context is incomplete");
  }
  return { workspace, conversation, draft, mission, campaign };
}

/** Effective daily send cap — demo workspaces are additionally bounded by
 *  the deployment's demo cap (missing env ⇒ zero). */
function effectiveSendLimit(workspace: Doc<"workspaces">): number {
  if (!workspace.demoMode) {
    return workspace.dailySendLimit;
  }
  const raw = process.env.OPENSQUAD_DEMO_MAX_DAILY_SENDS;
  const cap = raw === undefined ? 0 : Number.parseInt(raw, 10);
  if (!Number.isFinite(cap) || cap < 0) {
    return 0;
  }
  return Math.min(workspace.dailySendLimit, cap);
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
  await ctx.runMutation(internal.usage.reserve, {
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
    replacementDecisionId?: Id<"decisions">;
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
    ...(args.replacementDecisionId !== undefined
      ? { replacementDecisionId: args.replacementDecisionId }
      : {}),
    ...(args.nextPermittedAt !== undefined
      ? { nextPermittedAt: args.nextPermittedAt }
      : {}),
  });
  if (args.replacementDecisionId !== undefined) {
    // Chain link for §8.7 transitive coverage: the decision binds which
    // uncertain attempt this replacement covers. The covered attempt keeps
    // its honest `uncertain` state — the link only tells the
    // across-revisions guard the uncertainty was resolved by replacement.
    const covering = await ctx.db.get(
      "decisions",
      args.replacementDecisionId,
    );
    if (covering?.sendAttemptId !== undefined) {
      const covered = await ctx.db.get(
        "sendAttempts",
        covering.sendAttemptId as Id<"sendAttempts">,
      );
      // An existing link is honored only while the covering attempt can
      // still send — a link at a dead (cancelled/failed) attempt is stale
      // and a later authorized replacement may take it over.
      const linked =
        covered?.coveredByAttemptId !== undefined
          ? await ctx.db.get("sendAttempts", covered.coveredByAttemptId)
          : null;
      const linkLive =
        linked !== null &&
        linked?.state !== "cancelled" &&
        linked?.state !== "definitively_failed";
      if (
        covered !== null &&
        covered.state === "uncertain" &&
        (covered.coveredByAttemptId === undefined || !linkLive)
      ) {
        await ctx.db.patch("sendAttempts", covered._id, {
          coveredByAttemptId: attemptId,
          updatedAt: now,
        });
      }
    }
  }
  await recordActivityEvent(ctx, {
    workspaceId: workspace._id,
    missionId: args.context.mission._id,
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
    replacementDecisionId: v.optional(v.id("decisions")),
    expectedWorkflowGeneration: v.optional(v.number()),
  },
  returns: vReserveResult,
  handler: async (ctx, args): Promise<Infer<typeof vReserveResult>> => {
    const context = await loadAttemptContext(ctx, args.draftId);
    const { draft, workspace, conversation, mission } = context;

    // A superseded mission workflow abandons at preflight — its dispatch
    // trigger must never produce a new intent.
    if (
      args.expectedWorkflowGeneration !== undefined &&
      mission.workflowGeneration !== args.expectedWorkflowGeneration
    ) {
      return blockResult(
        "workflow_superseded",
        `mission workflow generation is ${mission.workflowGeneration}, not ${args.expectedWorkflowGeneration}`,
      );
    }

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
        "an earlier attempt for this revision is still uncertain — reconcile it or record a replacement decision; never blind-retry",
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
      mission,
      campaign: context.campaign,
      replacementDecisionId: args.replacementDecisionId,
    });
    if (!gate.ok) {
      await recordActivityEvent(ctx, {
        workspaceId: workspace._id,
        missionId: mission._id,
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
        replacementDecisionId: args.replacementDecisionId,
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
        replacementDecisionId: args.replacementDecisionId,
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
      replacementDecisionId: args.replacementDecisionId,
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
    const { workspace, conversation, draft, mission } = context;
    const gate = await evaluateSendGates(ctx, {
      workspace,
      conversation,
      draft,
      mission,
      campaign: context.campaign,
      excludeAttemptId: attempt._id,
      replacementDecisionId: attempt.replacementDecisionId,
    });
    const cancel = async (code: SendBlockCode, reason: string) => {
      await ctx.db.patch("sendAttempts", attempt._id, {
        state: "cancelled",
        error: { message: reason, at: Date.now(), reason: code },
        updatedAt: Date.now(),
      });
      await releaseCoverageLinks(ctx, attempt);
      // Release any deferred reservation the parked attempt holds.
      const reservation = await ctx.runMutation(
        internal.usage.getByOperationKey,
        {
          workspaceId: workspace._id,
          operationKey: attempt.operationKey,
        },
      );
      if (reservation !== null && reservation.state === "reserved") {
        await ctx.runMutation(internal.usage.release, {
          workspaceId: workspace._id,
          operationKey: attempt.operationKey,
        });
      }
      await recordActivityEvent(ctx, {
        workspaceId: workspace._id,
        missionId: mission._id,
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
      internal.usage.getByOperationKey,
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
        await ctx.runMutation(internal.usage.release, {
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
      missionId: mission._id,
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
    const mission = await ctx.db.get("missions", draft.missionId);
    const settle = async (
      target: "committed" | "released" | "uncertain",
      providerReference?: string,
    ) => {
      const reservation = await ctx.runMutation(
        internal.usage.getByOperationKey,
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
          ? internal.usage.commit
          : target === "released"
            ? internal.usage.release
            : internal.usage.markUncertain;
      await ctx.runMutation(fn, {
        workspaceId: attempt.workspaceId,
        operationKey: attempt.operationKey,
        ...(providerReference !== undefined ? { providerReference } : {}),
      });
    };

    // Retire the delivery_uncertain ask for this attempt once a confirmed
    // verdict exists — superseded, never resolved by the system.
    const retireUncertaintyAsk = async (note: string) => {
      if (mission === null) {
        return;
      }
      const open = await ctx.db
        .query("decisions")
        .withIndex("by_missionId_and_state", (q) =>
          q.eq("missionId", mission._id).eq("state", "open"),
        )
        .collect();
      for (const decision of open) {
        if (
          decision.kind === "delivery_uncertain" &&
          decision.sendAttemptId === String(attempt._id)
        ) {
          await ctx.runMutation(internal.decisions.supersedeDecision, {
            decisionId: decision._id,
            reason: note,
          });
        }
      }
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
      await retireUncertaintyAsk(
        "reconciled: provider acknowledged the original request",
      );
      await recordActivityEvent(ctx, {
        workspaceId: attempt.workspaceId,
        missionId: draft.missionId,
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
      // A definitively failed replacement never sent — release the coverage
      // link so the covered uncertain attempt blocks dispatch again until a
      // fresh delivery_uncertain decision authorizes another replacement.
      await releaseCoverageLinks(ctx, attempt);
      await retireUncertaintyAsk(
        "reconciled: provider definitively refused the request",
      );
      await recordActivityEvent(ctx, {
        workspaceId: attempt.workspaceId,
        missionId: draft.missionId,
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
        missionId: draft.missionId,
        kind: "send_attempt_uncertain",
        summary: `Send outcome is uncertain — ${providerError.slice(0, 200)}`,
        actor: "workflow",
        dedupeKey: `sendattempt:${attempt._id}:uncertain`,
        conversationId: attempt.conversationId,
      });
      // Open the Needs-you ask inside this transaction: if the calling action
      // dies after this commit, the attempt can never be left uncertain with
      // no ask. Idempotent per attempt via askKey (replay/reconcile safe).
      await ctx.runMutation(internal.sending.openDeliveryUncertainAsk, {
        sendAttemptId: attempt._id,
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

/**
 * Open the required `delivery_uncertain` decision for an uncertain attempt
 * (§8.7 — the Needs-you surface). Idempotent per attempt via askKey; skips
 * cleanly when the attempt is no longer uncertain or the mission is already
 * terminal (the attempt row remains the durable record either way).
 */
export const openDeliveryUncertainAsk = internalMutation({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: v.object({ opened: v.boolean() }),
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    if (attempt.state !== "uncertain") {
      return { opened: false };
    }
    const draft = await ctx.db.get("drafts", attempt.draftId);
    if (draft === null) {
      return { opened: false };
    }
    const mission = await ctx.db.get("missions", draft.missionId);
    if (
      mission === null ||
      mission.workflowId === undefined ||
      mission.state === "completed" ||
      mission.state === "cancelled" ||
      mission.state === "failed"
    ) {
      return { opened: false };
    }
    await ctx.runMutation(internal.decisions.openRequiredDecision, {
      missionId: mission._id,
      kind: "delivery_uncertain",
      reason:
        `Delivery of the send to ${draft.normalizedRecipient} is uncertain ` +
        `(attempt ${attempt._id}). The provider may or may not have accepted ` +
        `it — reconcile with the same idempotency key, or record a reviewed ` +
        `replacement decision before anything else sends on this thread.`,
      askKey: `delivery_uncertain:${attempt._id}`,
      required: true,
      draftId: String(draft._id),
      sendAttemptId: String(attempt._id),
      targetWorkflowId: mission.workflowId,
    });
    return { opened: true };
  },
});

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
    internal.usage.getByOperationKey,
    {
      workspaceId: attempt.workspaceId,
      operationKey: attempt.operationKey,
    },
  );
  if (reservation !== null && reservation.state === "reserved") {
    await ctx.runMutation(internal.usage.markUncertain, {
      workspaceId: attempt.workspaceId,
      operationKey: attempt.operationKey,
    });
  }
  const draft = await ctx.db.get("drafts", attempt.draftId);
  if (draft !== null) {
    await recordActivityEvent(ctx, {
      workspaceId: attempt.workspaceId,
      missionId: draft.missionId,
      kind: "send_attempt_uncertain",
      summary: "Send attempt lost its acknowledgement — marked uncertain",
      actor: "system",
      dedupeKey: `sendattempt:${attempt._id}:uncertain`,
      conversationId: attempt.conversationId,
    });
  }
  await ctx.runMutation(internal.sending.openDeliveryUncertainAsk, {
    sendAttemptId: attempt._id,
  });
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
 * from `approvals.approve`, the public `requestDispatch` trigger, the
 * delivery-uncertain replacement path and P09's journaled workflow step
 * (`workflows/send.ts` invokes this by name with `retry: false`).
 * Idempotent on the draft's operation key; `expectedWorkflowGeneration` lets
 * a superseded mission workflow abandon at preflight.
 */
export const sendApprovedDraft = internalAction({
  args: {
    draftId: v.id("drafts"),
    expectedWorkflowGeneration: v.optional(v.number()),
    replacementDecisionId: v.optional(v.id("decisions")),
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
 * `delivery_uncertain` decision stays open.
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
    const { workspace, conversation, draft, mission, campaign } = context;
    const gate = await evaluateSendGates(ctx, {
      workspace,
      conversation,
      draft,
      mission,
      campaign,
      excludeAttemptId: attempt._id,
      replacementDecisionId: attempt.replacementDecisionId,
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
      // Make sure the human-attention ask exists even if the sweep raced.
      await ctx.runMutation(internal.sending.openDeliveryUncertainAsk, {
        sendAttemptId: args.sendAttemptId,
      });
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
      // stay uncertain and leave the ask open.
      await ctx.runMutation(internal.sending.openDeliveryUncertainAsk, {
        sendAttemptId: args.sendAttemptId,
      });
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
    replacementDecisionId: v.optional(v.id("decisions")),
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
        ...(args.replacementDecisionId !== undefined
          ? { replacementDecisionId: args.replacementDecisionId }
          : {}),
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
        "the provider idempotency window has expired — resolve the delivery_uncertain decision instead",
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
 * Resolve a `delivery_uncertain` ask (owner/operator) — §8.7's recorded
 * human decision.
 *
 * With `replacementDraftId` + `acknowledgeDuplicate: true` the resolution
 * binds the uncertain attempt, the exact replacement draft (ID + payload
 * hash) and the live context version, then dispatches the replacement — the
 * ONLY way a new send may cover an uncertain attempt, and it is consumed
 * once transactionally.
 *
 * Without a replacement draft the ask is resolved with no replacement: the
 * attempt stays `uncertain` forever (its reservation keeps capacity blocked)
 * as the honest record of "unknown, reviewed".
 */
export const resolveDeliveryUncertainty = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    decisionId: v.id("decisions"),
    expectedVersion: v.number(),
    requestId: v.string(),
    reason: v.string(),
    replacementDraftId: v.optional(v.id("drafts")),
    acknowledgeDuplicate: v.optional(v.boolean()),
  },
  returns: v.object({
    resolved: v.boolean(),
    replayed: v.boolean(),
    dispatched: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const reason = boundedString(args.reason, "reason", {
      min: 1,
      max: 2000,
    });
    const decision = await ctx.db.get("decisions", args.decisionId);
    if (decision === null || decision.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "decision not found");
    }
    if (decision.kind !== "delivery_uncertain") {
      throw invalid("decision is not a delivery_uncertain ask");
    }
    if (
      decision.state === "resolved" &&
      decision.resolutionRequestId === requestId
    ) {
      // Report what the original call actually did — `dispatched` is true
      // iff a replacement attempt carries this decision's authorization.
      const replacement = await ctx.db
        .query("sendAttempts")
        .withIndex("by_replacementDecisionId", (q) =>
          q.eq("replacementDecisionId", decision._id),
        )
        .first();
      return {
        resolved: true,
        replayed: true,
        dispatched: replacement !== null,
      };
    }
    if (decision.state !== "open") {
      throw domainError(
        "CONFLICT",
        `decision is ${decision.state}; it is no longer open`,
      );
    }
    if (decision.version !== args.expectedVersion) {
      throw domainError(
        "CONFLICT",
        `decision version is ${decision.version}, not ${args.expectedVersion}`,
      );
    }
    if (decision.sendAttemptId === undefined) {
      throw invalid("delivery_uncertain decision is not bound to an attempt");
    }
    const attempt = await ctx.db.get(
      "sendAttempts",
      decision.sendAttemptId as Id<"sendAttempts">,
    );
    if (attempt === null || attempt.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    if (attempt.state !== "uncertain") {
      throw domainError(
        "CONFLICT",
        `attempt is already ${attempt.state} — the uncertainty resolved elsewhere`,
      );
    }
    const conversation = await ctx.db.get(
      "conversations",
      attempt.conversationId,
    );
    if (conversation === null) {
      throw domainError("NOT_FOUND", "conversation not found");
    }

    let dispatched = false;
    if (args.replacementDraftId !== undefined) {
      if (args.acknowledgeDuplicate !== true) {
        throw invalid(
          "acknowledgeDuplicate must be true — a replacement may cause duplicate delivery and the reviewer must accept that",
        );
      }
      const replacement = await getDraftInWorkspace(
        ctx,
        args.workspaceId,
        args.replacementDraftId,
      );
      if (replacement.conversationId !== conversation._id) {
        throw invalid(
          "replacement draft belongs to a different conversation",
        );
      }
      if (
        conversation.currentDraftId !== replacement._id ||
        replacement.supersededAt !== undefined
      ) {
        throw domainError(
          "CONFLICT",
          "replacement draft is not the conversation's current revision",
        );
      }
      // The replacement must already carry a live exact approval — the
      // dispatch gate re-verifies it anyway, and failing here surfaces the
      // gap while the reviewer still holds the ask.
      const approval = await currentApproval(ctx, replacement, conversation);
      if (approval === null) {
        throw domainError(
          "CONFLICT",
          "replacement draft has no current exact approval",
        );
      }
      const consumed = await ctx.db
        .query("sendAttempts")
        .withIndex("by_replacementDecisionId", (q) =>
          q.eq("replacementDecisionId", decision._id),
        )
        .first();
      if (consumed !== null) {
        throw domainError(
          "CONFLICT",
          "this decision already authorized a replacement attempt",
        );
      }

      const F = REPLACEMENT_ANSWER_FIELDS;
      const answer = {
        approved: true,
        body: reason,
        fields: {
          [F.unresolvedAttemptId]: String(attempt._id),
          [F.replacementDraftId]: String(replacement._id),
          [F.replacementPayloadHash]: replacement.payloadHash,
          [F.contextVersion]: String(conversation.contextVersion),
          [F.acknowledgement]: REPLACEMENT_ACKNOWLEDGEMENT,
          [F.reason]: reason.slice(0, 500),
        },
      };
      await ctx.runMutation(internal.decisions.resolveBound, {
        workspaceId: args.workspaceId,
        decisionId: decision._id,
        expectedVersion: args.expectedVersion,
        requestId,
        answer,
        resolvedBy: identityKey,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.sending.sendApprovedDraft,
        {
          draftId: replacement._id,
          replacementDecisionId: decision._id,
        },
      );
      dispatched = true;
    } else {
      await ctx.runMutation(internal.decisions.resolveBound, {
        workspaceId: args.workspaceId,
        decisionId: decision._id,
        expectedVersion: args.expectedVersion,
        requestId,
        answer: {
          approved: false,
          body: reason,
          fields: { uncertaintyResolution: "left_unresolved" },
        },
        resolvedBy: identityKey,
      });
    }
    return { resolved: true, replayed: false, dispatched };
  },
});

/**
 * Cancel a still-`reserved` intent (owner/operator). Only the pre-dispatch
 * state is cancellable — `requesting` may already be at the provider and can
 * never be recalled; terminal states are already history.
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
    await releaseCoverageLinks(ctx, attempt);
    const reservation = await ctx.runMutation(
      internal.usage.getByOperationKey,
      {
        workspaceId: args.workspaceId,
        operationKey: attempt.operationKey,
      },
    );
    if (reservation !== null && reservation.state === "reserved") {
      await ctx.runMutation(internal.usage.release, {
        workspaceId: args.workspaceId,
        operationKey: attempt.operationKey,
      });
    }
    const draft = await ctx.db.get("drafts", attempt.draftId);
    if (draft !== null) {
      await recordActivityEvent(ctx, {
        workspaceId: args.workspaceId,
        missionId: draft.missionId,
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
      await releaseCoverageLinks(ctx, attempt);
      const reservation = await ctx.runMutation(
        internal.usage.getByOperationKey,
        {
          workspaceId: args.workspaceId,
          operationKey: attempt.operationKey,
        },
      );
      if (reservation !== null && reservation.state === "reserved") {
        await ctx.runMutation(internal.usage.release, {
          workspaceId: args.workspaceId,
          operationKey: attempt.operationKey,
        });
      }
      const draft = await ctx.db.get("drafts", attempt.draftId);
      if (draft !== null) {
        await recordActivityEvent(ctx, {
          workspaceId: args.workspaceId,
          missionId: draft.missionId,
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
    const mission = await ctx.db.get("missions", draft.missionId);
    const campaign =
      mission === null
        ? null
        : await ctx.db.get("campaigns", mission.campaignId);
    if (
      conversation === null ||
      workspace === null ||
      mission === null ||
      campaign === null
    ) {
      return {
        permitted: false,
        code: "mission_inactive",
        reason: "send context is incomplete",
        attempts: attemptsView,
      };
    }
    const gate = await evaluateSendGates(ctx, {
      workspace,
      conversation,
      draft,
      mission,
      campaign,
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
