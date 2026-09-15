/**
 * Inbound ingest — verified provider mail becomes conversation state (P11,
 * architecture §8 "Incoming message processing", integrations.md §G3).
 *
 * The webhook itself is not here and must not be rebuilt here. The
 * `@agentmail/convex` component verifies the svix signature over the raw body,
 * dedupes the provider `event_id` and stores the message; `convex/http.ts`
 * mounts it; `convex/integrations/agentmail.ts` receives its callbacks. What
 * this module owns is everything after that: deduping the APPLICATION EFFECT,
 * matching the message to a conversation, and applying it in an order that can
 * be read off the code.
 *
 * TWO DEDUPES, TWO DIFFERENT PROBLEMS.
 *
 * The component's `event_id` ledger stops one DELIVERY being ingested twice.
 * It does nothing about the same logical MESSAGE arriving under a second event
 * id — which is the case that would advance a conversation twice and strand an
 * approval granted in between. That is `emailEventReceipts.applicationKey`,
 * `incoming:<inboxRef>:<messageRef>`, enforced inside `recordReceipt` before
 * this module is ever scheduled (§4.3). `drafts.applyInboundContext` has its
 * own guard, but it compares only against the LAST applied message, so a
 * replay in the order A → B → A would slip past it; the receipt key is the
 * durable per-message gate and the reason nothing here re-checks arrival
 * order by hand.
 *
 * THE RECEIPT IS THE UNIT OF WORK. The callback records it and schedules this
 * module; the schedule commits with the row. Handling runs in its own
 * transaction so a throw in the business path cannot roll back the receipt
 * that makes the event replayable — it leaves the row `pending` and the
 * `inbound-receipt-drain` cron re-drives it. Conditions that will never
 * succeed are written as `failed` with a bounded reason instead of thrown, so
 * they are visible rather than looping.
 *
 * THE ORDER, which is the whole point of the card and what V16–V18 test:
 *
 *   1. `drafts.applyInboundContext` — advance `contextVersion`, supersede
 *      every open draft approval, cancel every parked follow-up;
 *   2. the inbound facts the conversation row owns;
 *   3. the deterministic opt-out rule — suppress a verified explicit request,
 *      freeze automation for an unclear one, guess at neither;
 *   4. the reply-automation gate, read after all of the above so it sees what
 *      they just changed;
 *   5. ONLY THEN may reply work start.
 *
 * All five are one transaction, so step 5 cannot commit unless step 1 did.
 * `applyToConversation` carries the argument for why that is provable rather
 * than merely intended.
 *
 * EVERY INBOUND STRING IS DATA. Svix proved the payload came from AgentMail
 * untampered; it proved nothing about the content, which was written by
 * whoever sent the email. `from` is stored as data and can only ever make a
 * later check refuse. `in_reply_to`/`references` are not read at all — they
 * can name any message id, including another tenant's, so they are never the
 * authority for conversation identity and are not used as a hint either.
 * Subjects and bodies never reach an app table from here and are never logged.
 */
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  boundedString,
  domainError,
  OPT_OUT_SIGNALS,
} from "./lib/validators";
import type { OptOutSignal } from "./lib/validators";
import type { AuthCtx } from "./lib/auth";
import {
  recordConversationNote,
  resolveOutboundRecipient,
} from "./conversations";
import { matchSuppression } from "./suppressions";

/* ------------------------------------------------------------------ */
/* Receipt facts                                                       */
/* ------------------------------------------------------------------ */

/**
 * The bounded projection the callback leaves on the receipt for this module
 * to read back.
 *
 * It lives on the receipt rather than in the scheduler argument because the
 * drain re-drives from the row alone — an argument would be lost the moment
 * handling failed once. `providerFacts` holds only facts a business decision
 * needs (§4.3: "only necessary verified facts and never another copy of full
 * message bodies"): no subject, no body, no headers.
 */
type InboundFacts = {
  /** Normalized `From`, when the header named exactly one parseable address. */
  fromAddress?: string;
  /** Verdict of the deterministic opt-out rule, computed at the callback. */
  optOutSignal: OptOutSignal;
  /** Which rule fired — a rule NAME, never a slice of the message. */
  optOutRule?: string;
};

function readInboundFacts(receipt: Doc<"emailEventReceipts">): InboundFacts {
  // `providerFacts` is `v.record(v.string(), v.any())`, so read it as
  // `unknown` and narrow — the column is a projection of provider data and
  // nothing here may trust its shape.
  const stored: Record<string, unknown> = receipt.providerFacts;
  const fromAddress = stored.fromAddress;
  const rawSignal = stored.optOutSignal;
  const rule = stored.optOutRule;
  return {
    ...(typeof fromAddress === "string" && fromAddress.length > 0
      ? { fromAddress }
      : {}),
    // A receipt written before the opt-out rule existed, or by any other
    // path, carries no verdict. `none` is the only safe default: it can never
    // manufacture a suppression, only fail to stop one, and the next message
    // on the thread re-evaluates.
    optOutSignal:
      typeof rawSignal === "string"
        ? (OPT_OUT_SIGNALS.find((candidate) => candidate === rawSignal) ??
          "none")
        : "none",
    ...(typeof rule === "string" && rule.length > 0 ? { optOutRule: rule } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* The reply-automation gate                                           */
/* ------------------------------------------------------------------ */

/**
 * Why automation did not answer this reply. Architecture §8 step 7: "if
 * takeover is active, the conversation is unassigned/closed, or no valid
 * prospect/campaign is linked, retain the reply for human review without a
 * reply workflow, draft or send."
 *
 * Names line up with `SEND_BLOCK_CODES` and `conversations.RESUME_BLOCK_CODES`
 * wherever the same gate exists, so the inbox, the resume path and the send
 * preflight speak one vocabulary.
 */
export const REPLY_GATE_BLOCK_CODES = [
  "opt_out_explicit",
  "opt_out_ambiguous",
  "conversation_unassigned",
  "conversation_closed",
  "human_takeover",
  "association_missing",
  "campaign_mismatch",
  "campaign_inactive",
  "workspace_paused",
  "inbox_unassigned",
  "inbox_mismatch",
  "recipient_unknown",
  "suppressed_email",
  "suppressed_domain",
] as const;

export type ReplyGateBlockCode = (typeof REPLY_GATE_BLOCK_CODES)[number];

export const vReplyGateBlockCode = v.union(
  v.literal("opt_out_explicit"),
  v.literal("opt_out_ambiguous"),
  v.literal("conversation_unassigned"),
  v.literal("conversation_closed"),
  v.literal("human_takeover"),
  v.literal("association_missing"),
  v.literal("campaign_mismatch"),
  v.literal("campaign_inactive"),
  v.literal("workspace_paused"),
  v.literal("inbox_unassigned"),
  v.literal("inbox_mismatch"),
  v.literal("recipient_unknown"),
  v.literal("suppressed_email"),
  v.literal("suppressed_domain"),
);

export const vReplyGateVerdict = v.union(
  v.object({ start: v.literal(true) }),
  v.object({ start: v.literal(false), blockedBy: vReplyGateBlockCode }),
);

export type ReplyGateVerdict = typeof vReplyGateVerdict.type;

/* ------------------------------------------------------------------ */
/* Outcome                                                             */
/* ------------------------------------------------------------------ */

/**
 * What one inbound receipt did. Returned rather than thrown: the drain and
 * the probe both need to read the verdict, and a throw would roll back the
 * receipt transition that records it.
 */
export const vInboundOutcome = v.union(
  /** Matched an existing conversation; its context advanced. */
  v.literal("applied"),
  /** Matched nothing; a new unassigned conversation now holds it. */
  v.literal("queued"),
  /** Nothing to do — not pending, not inbound, or the row is gone. */
  v.literal("skipped"),
  /** Recorded on the receipt as `failed`; it will not be retried blindly. */
  v.literal("failed"),
);

export type InboundOutcome = typeof vInboundOutcome.type;

export const vApplyInboundMessageResult = v.object({
  outcome: vInboundOutcome,
  conversationId: v.optional(v.id("conversations")),
  /** The conversation version AFTER this message was applied. */
  contextVersion: v.optional(v.number()),
  /** Whether reply automation was allowed to run, and if not, why not. */
  replyWork: v.optional(vReplyGateVerdict),
  reason: v.optional(v.string()),
});

/**
 * Annotated explicitly, and every handler below that produces one says so.
 * A Convex handler's return type is otherwise inferred, and these handlers
 * reach other modules through the generated `internal` object — which is typed
 * from this module too, so the inference would be circular (TS7022/TS7023).
 * The same reason `drafts.retireConversationWork` returns `v.null()`.
 */
export type ApplyInboundMessageResult = typeof vApplyInboundMessageResult.type;

/** Bound on the `error` string a receipt carries. */
const RECEIPT_ERROR_MAX_LENGTH = 500;

/**
 * Record an unrecoverable condition on the receipt instead of throwing it.
 *
 * A throw would roll back the transaction, leave the row `pending`, and hand
 * the drain something it will retry on every sweep for as long as the row
 * lives. `failed` is terminal, visible in `sendAttempts.listReceipts`, and
 * still replayable by hand.
 */
async function fail(
  ctx: MutationCtx,
  receipt: Doc<"emailEventReceipts">,
  reason: string,
): Promise<{ outcome: "failed"; reason: string }> {
  await settleReceipt(ctx, receipt, "failed", reason);
  return { outcome: "failed", reason };
}

async function settleReceipt(
  ctx: MutationCtx,
  receipt: Doc<"emailEventReceipts">,
  handlingState: "handled" | "failed",
  error?: string,
): Promise<void> {
  await ctx.db.patch("emailEventReceipts", receipt._id, {
    handlingState,
    handledAt: Date.now(),
    ...(error === undefined
      ? {}
      : {
          error: boundedString(error, "error", {
            min: 1,
            max: RECEIPT_ERROR_MAX_LENGTH,
          }),
        }),
  });
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

/**
 * Resolve `(inboxRef, providerThreadRef)` to a conversation in the receipt's
 * OWN workspace.
 *
 * This follows `sending.linkConversationThread`, not `drafts.stageConversation`:
 * the pair's uniqueness is a transactional convention, not a database
 * constraint, and `by_inboxRef_and_providerThreadRef` is not workspace-scoped.
 * `.unique()` would throw on an already-violated pair and wedge the receipt
 * forever, and a row belonging to another workspace must neither block this
 * match nor have its id quoted into this workspace's feed — hence `.collect()`
 * then an explicit workspace filter.
 *
 * More than one in-workspace row is an anomaly, not a crash: the earliest
 * row wins deterministically and the caller records the ambiguity on the
 * receipt.
 */
async function matchConversation(
  ctx: MutationCtx,
  receipt: Doc<"emailEventReceipts">,
): Promise<{
  conversation: Doc<"conversations"> | null;
  ambiguous: boolean;
}> {
  const threadRef = receipt.providerThreadRef;
  if (threadRef === undefined) {
    // No provider thread reference is no match. It is never resolved from
    // RFC 5322 threading headers, which the sender controls.
    return { conversation: null, ambiguous: false };
  }
  const rows = await ctx.db
    .query("conversations")
    .withIndex("by_inboxRef_and_providerThreadRef", (q) =>
      q.eq("inboxRef", receipt.inboxRef).eq("providerThreadRef", threadRef),
    )
    .collect();
  const owned = rows
    .filter((row) => row.workspaceId === receipt.workspaceId)
    .sort((left, right) => left._creationTime - right._creationTime);
  if (owned.length === 0) {
    return { conversation: null, ambiguous: false };
  }
  return { conversation: owned[0], ambiguous: owned.length > 1 };
}

/* ------------------------------------------------------------------ */
/* The ordering rule                                                   */
/* ------------------------------------------------------------------ */

/**
 * Apply one verified inbound message to its conversation, in the order
 * architecture §8 requires and V17 tests.
 *
 * STEP 1 — `internal.drafts.applyInboundContext`, first and unconditionally.
 * One call, three invalidations, and this module reimplements none of them:
 * it advances `contextVersion` (which is what makes every live approval
 * refuse at preflight with `context_changed`), supersedes every open
 * `draft_approval` ask through `internal.decisions.supersedeDecision` (which
 * owns the `requiredDecisionCount` decrement, the `waiting_for_user → active`
 * un-park and the workflow wake-up), and calls
 * `internal.sending.cancelParkedConversationAttempts` (which releases each
 * `reserved` attempt's usage reservation and unwinds its coverage links) —
 * that last one being "cancel pending follow-ups".
 *
 * STEP 2 — the inbound facts P11 owns that step 1 does not touch.
 *
 * STEP 3 — opt-out enforcement (`enforceOptOut`).
 *
 * STEP 4 — the reply-automation gate (`evaluateReplyAutomation`), read AFTER
 * steps 1–3 so it sees the takeover an ambiguous opt-out just placed and the
 * suppression an explicit one just wrote.
 *
 * STEP 5 — and only here, with every invalidation above already committed to
 * this transaction, may reply work be started. Nothing above this line can
 * reach a model, and nothing that reaches a model may be placed above it.
 *
 * WHY THE ORDER IS PROVABLE, not merely intended. Steps 1–4 and the dispatch
 * at step 5 are one Convex transaction (`ctx.runMutation` from a mutation is a
 * sub-transaction), so a dispatch cannot commit unless the invalidation
 * committed with it. The only route to model work is
 * `internal.workerOperations.dispatchWorkerRequest`, which refuses a mission
 * with no `workflowId`; the mission does not exist until step 5; and a
 * workflow started with `startAsync` enqueues rather than running its first
 * step inside this transaction. The race in the other direction is closed too:
 * an approval attempted between the bump and the start hits
 * `approvals.resolveDraftDecision`, which re-checks both that the ask is still
 * open and that `conversation.contextVersion === draft.basedOnContextVersion`.
 *
 * The reply mission and its workflow are the next slice. Until they land this
 * returns the gate verdict, which is the value they will hang off — the
 * ordering above it is complete and already testable.
 */
async function applyToConversation(
  ctx: MutationCtx,
  receipt: Doc<"emailEventReceipts">,
  conversation: Doc<"conversations">,
  facts: InboundFacts,
): Promise<{ conversation: Doc<"conversations">; replyWork: ReplyGateVerdict }> {
  // 1. Version bump, approval invalidation, parked follow-up cancellation.
  await ctx.runMutation(internal.drafts.applyInboundContext, {
    conversationId: conversation._id,
    lastInboundMessageRef: receipt.providerMessageRef,
    // Ingest time, never the provider's `timestamp`: the component's
    // `parseTimestamp` silently falls back to `Date.now()` on a parse
    // failure, so the provider stamp is not an ordering authority.
    at: receipt.receivedAt,
    markUnread: true,
  });

  // 2. The sender, as data. Written after step 1 so it can never be the
  //    reason a version bump did or did not happen.
  const current = await ctx.db.get("conversations", conversation._id);
  if (current === null) {
    // Unreachable inside this transaction — step 1 already throws NOT_FOUND
    // when the row is gone, and nothing on this path deletes a conversation.
    // Refusing beats inventing a gate blocker that would misreport why.
    throw domainError("NOT_FOUND", "conversation not found");
  }
  if (
    facts.fromAddress !== undefined &&
    facts.fromAddress !== current.lastInboundFrom
  ) {
    await ctx.db.patch("conversations", current._id, {
      lastInboundFrom: facts.fromAddress,
      updatedAt: Date.now(),
    });
  }

  // 3. Opt-out, before anything could propose a reply.
  await enforceOptOut(ctx, current, facts);

  // 4. Re-read, then gate. The read is deliberate: steps 1 and 3 may have
  //    moved the very fields the gate tests.
  const settled = (await ctx.db.get("conversations", current._id)) ?? current;
  const replyWork = await evaluateReplyAutomation(
    ctx,
    settled,
    facts.optOutSignal,
  );

  // 5. The dispatch point. Nothing is started yet — the reply mission and its
  //    workflow are the next slice — but a policy refusal that would otherwise
  //    leave no trace is recorded now, because a thread with no mission can
  //    carry no activity row to explain itself (integrator decision D1).
  if (
    !replyWork.start &&
    NOTED_REPLY_GATE_BLOCKS.has(replyWork.blockedBy)
  ) {
    await recordConversationNote(ctx, {
      conversation: settled,
      kind: "system",
      actor: "system",
      body: `Reply automation did not run for this message (${replyWork.blockedBy}). The reply is retained for human review; no draft and no send were produced.`,
    });
  }

  return { conversation: settled, replyWork };
}

/* ------------------------------------------------------------------ */
/* Opt-out                                                             */
/* ------------------------------------------------------------------ */

/**
 * Act on the deterministic opt-out verdict the callback computed.
 *
 * WHAT GETS SUPPRESSED, AND BY WHOM. The address suppressed is always one the
 * APPLICATION resolved — the `normalizedRecipient` of the conversation's most
 * recent draft revision, i.e. the address we actually mailed. It is never read
 * out of the inbound payload, so a message cannot nominate its own suppression
 * target. Suppression is `kind: "email"`; an individual opt-out never implies
 * the domain (`suppressions.ts` keeps that rule and P11 does not weaken it).
 *
 * AND THE SENDER MUST BE THE PERSON WE MAILED. An explicit opt-out from some
 * other address — a colleague on cc, an assistant, an unparseable header — is
 * a claim made on someone else's behalf. Honouring it would let a third party
 * suppress an address in a workspace they have nothing to do with, so it is
 * downgraded to the ambiguous hold: automation still stops, but a human
 * decides whether to add the suppression through `suppressions.add`.
 *
 * WHAT AMBIGUOUS DOES, MECHANICALLY. Human takeover on, with
 * `takeoverReason: "ambiguous_opt_out"` — so `evaluateSendGates` returns
 * `human_takeover` on the very next preflight, the reply gate refuses, and
 * `conversations.resume` is the only way back. No suppression row is written:
 * `vSuppressionReason` is a closed union and there is no member meaning "a
 * rule was unsure". Step 1 already superseded every open approval and
 * cancelled every parked attempt for this message, so there is nothing left to
 * retire here, and the version is deliberately not bumped a second time — the
 * inbound bump already carried exactly this invalidation.
 *
 * A VERIFIED EXPLICIT OPT-OUT DOES NOT TAKE THE THREAD OVER. The suppression
 * row is the durable block, and it is honoured in both directions that matter:
 * `sending.evaluateSendGates` refuses dispatch with `suppressed_email`, and
 * both `conversations.resume` and the reply gate re-run `matchSuppression`. A
 * takeover flag on top would add a hold an operator has to clear by hand for
 * no additional protection.
 */
async function enforceOptOut(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  facts: InboundFacts,
): Promise<void> {
  if (facts.optOutSignal === "none") {
    return;
  }
  const rule = facts.optOutRule ?? "unnamed_rule";

  if (facts.optOutSignal === "explicit") {
    // The same helper `resume` and the gate use, so all three agree on what
    // "the address we mail" means.
    const { latestDraft } = await resolveOutboundRecipient(ctx, conversation);
    const verified =
      latestDraft !== null &&
      facts.fromAddress !== undefined &&
      facts.fromAddress === latestDraft.normalizedRecipient;
    if (verified) {
      await ctx.runMutation(internal.suppressions.recordSuppression, {
        workspaceId: conversation.workspaceId,
        kind: "email",
        value: latestDraft.normalizedRecipient,
        reason: "unsubscribe",
        sourceConversationId: conversation._id,
      });
      await recordConversationNote(ctx, {
        conversation,
        kind: "system",
        actor: "system",
        body: `Opt-out honoured: the verified sender asked to be removed (rule ${rule}). This address is suppressed for the workspace; remove the suppression to contact them again.`,
      });
      return;
    }
    // Explicit words, unverified speaker. Hold, do not suppress.
    await holdForReview(
      ctx,
      conversation,
      `Possible opt-out held for review: the request (rule ${rule}) did not come from the address this thread was sent to, so nothing was suppressed. Review the message and use Suppressions if it is genuine.`,
    );
    return;
  }

  await holdForReview(
    ctx,
    conversation,
    `Possible opt-out held for review (rule ${rule}). Automation is frozen and nothing was suppressed — a human decides whether this is an opt-out.`,
  );
}

/** Freeze automation pending review and say why, on the row and in a note. */
async function holdForReview(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  note: string,
): Promise<void> {
  const now = Date.now();
  await ctx.db.patch("conversations", conversation._id, {
    humanTakeover: true,
    takeoverReason: "ambiguous_opt_out",
    takeoverBy: "system",
    takeoverAt: now,
    updatedAt: now,
  });
  await recordConversationNote(ctx, {
    conversation,
    kind: "system",
    actor: "system",
    body: note,
  });
}

/* ------------------------------------------------------------------ */
/* The gate (its vocabulary is declared at the top of the file)        */
/* ------------------------------------------------------------------ */

/**
 * THE gate every path to model work on an inbound reply passes through.
 *
 * It is a pure read, so it can be re-run — and must be. Ingest runs it here;
 * the reply workflow re-runs it before each dispatch, because a takeover, a
 * close, a workspace pause or a suppression can land while a workflow is
 * queued, and a stale wake must then spend nothing.
 *
 * Order matters only for which blocker gets REPORTED, and it is chosen so the
 * operator sees the most specific cause of this particular message: the
 * opt-out that just arrived before the takeover it caused, and the missing
 * association before the policy checks that association would feed.
 */
export async function evaluateReplyAutomation(
  ctx: AuthCtx,
  conversation: Doc<"conversations">,
  optOutSignal: OptOutSignal,
): Promise<ReplyGateVerdict> {
  const blocked = (blockedBy: ReplyGateBlockCode): ReplyGateVerdict => ({
    start: false,
    blockedBy,
  });

  if (optOutSignal === "explicit") {
    return blocked("opt_out_explicit");
  }
  if (optOutSignal === "ambiguous") {
    return blocked("opt_out_ambiguous");
  }
  if (conversation.state === "unassigned") {
    return blocked("conversation_unassigned");
  }
  if (conversation.state === "closed") {
    return blocked("conversation_closed");
  }
  if (conversation.humanTakeover) {
    return blocked("human_takeover");
  }
  if (
    conversation.prospectId === undefined ||
    conversation.campaignId === undefined
  ) {
    return blocked("association_missing");
  }
  const prospect = await ctx.db.get("prospects", conversation.prospectId);
  if (prospect === null || prospect.workspaceId !== conversation.workspaceId) {
    return blocked("association_missing");
  }
  const campaign = await ctx.db.get("campaigns", conversation.campaignId);
  if (campaign === null || campaign.workspaceId !== conversation.workspaceId) {
    return blocked("association_missing");
  }
  // The campaign frozen on the conversation at association is the authority;
  // a lead re-campaigned since must not silently retarget in-flight work.
  if (prospect.campaignId !== conversation.campaignId) {
    return blocked("campaign_mismatch");
  }
  if (campaign.status !== "active") {
    return blocked("campaign_inactive");
  }
  const workspace = await ctx.db.get("workspaces", conversation.workspaceId);
  if (workspace === null || workspace.automationState !== "active") {
    return blocked("workspace_paused");
  }
  if (workspace.inboxRef === undefined) {
    return blocked("inbox_unassigned");
  }
  if (workspace.inboxRef !== conversation.inboxRef) {
    return blocked("inbox_mismatch");
  }
  const { recipient } = await resolveOutboundRecipient(ctx, conversation);
  if (recipient === null) {
    return blocked("recipient_unknown");
  }
  // P10's matcher, not a second one: email key first, then the explicit
  // domain key. An email suppression never implies its domain.
  const suppression = await matchSuppression(
    ctx,
    conversation.workspaceId,
    recipient,
  );
  if (suppression !== null) {
    return blocked(
      suppression.matchedBy === "domain" ? "suppressed_domain" : "suppressed_email",
    );
  }
  return { start: true };
}

/**
 * Blockers worth a note on the thread.
 *
 * The rest are already visible without one: an unassigned thread carries its
 * intake note and its takeover reason, a hold wrote its own note as it was
 * placed, and a closed thread is closed. Writing a note for those on every
 * inbound message would bury the ones that say something new under repetition.
 */
const NOTED_REPLY_GATE_BLOCKS: ReadonlySet<ReplyGateBlockCode> = new Set<
  ReplyGateBlockCode
>([
  "association_missing",
  "campaign_mismatch",
  "campaign_inactive",
  "workspace_paused",
  "inbox_unassigned",
  "inbox_mismatch",
  "recipient_unknown",
  "suppressed_email",
  "suppressed_domain",
]);

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Handle one pending inbound receipt. Scheduled by the AgentMail callback at
 * commit time, and re-driven by `inbound-receipt-drain` if that schedule was
 * lost or the first attempt threw.
 *
 * Idempotent by construction: it refuses a receipt that is not `pending`, and
 * `recordReceipt` already refused to create a second pending row for a message
 * this workspace has seen.
 */
export const applyInboundMessage = internalMutation({
  args: { receiptId: v.id("emailEventReceipts") },
  returns: vApplyInboundMessageResult,
  handler: async (ctx, args): Promise<ApplyInboundMessageResult> => {
    const receipt = await ctx.db.get("emailEventReceipts", args.receiptId);
    if (receipt === null) {
      return { outcome: "skipped" as const, reason: "receipt not found" };
    }
    if (receipt.eventType !== "message.received") {
      return {
        outcome: "skipped" as const,
        reason: "receipt is not an inbound message",
      };
    }
    if (receipt.handlingState !== "pending") {
      // Already applied, or recorded as a duplicate application key. Either
      // way the business effect has happened at most once.
      return { outcome: "skipped" as const, reason: "receipt is not pending" };
    }

    const facts = readInboundFacts(receipt);
    const { conversation, ambiguous } = await matchConversation(ctx, receipt);

    let target = conversation;
    let queued = false;
    if (target === null) {
      // Verified mail on a KNOWN inbox that matches no thread. It is not
      // dropped and it is not guessed at: it enters this workspace's
      // unassigned queue under human takeover, with no lead, no mission, no
      // reply workflow, no draft and no send (architecture §8 step 4).
      const threadRef = receipt.providerThreadRef;
      if (threadRef === undefined) {
        // Nothing to key a conversation on, so a row created here could never
        // be matched again by a later message on the same thread. Recording
        // the refusal beats minting an orphan.
        return await fail(
          ctx,
          receipt,
          "inbound message carries no provider thread reference",
        );
      }
      const ensured = await ctx.runMutation(
        internal.conversations.ensureUnassignedConversation,
        {
          workspaceId: receipt.workspaceId,
          inboxRef: receipt.inboxRef,
          providerThreadRef: threadRef,
          messageRef: receipt.providerMessageRef,
          at: receipt.receivedAt,
          ...(facts.fromAddress !== undefined
            ? { fromAddress: facts.fromAddress }
            : {}),
        },
      );
      if (!ensured.ok) {
        // Unrecoverable, so it is recorded rather than thrown: a throw would
        // leave the receipt `pending` and the drain would retry it forever.
        return await fail(ctx, receipt, ensured.reason);
      }
      target = ensured.conversation;
      queued = ensured.created;
    }

    const applied = await applyToConversation(ctx, receipt, target, facts);

    await settleReceipt(
      ctx,
      receipt,
      "handled",
      ambiguous ? "ambiguous_thread_mapping" : undefined,
    );
    return {
      outcome: queued ? ("queued" as const) : ("applied" as const),
      conversationId: applied.conversation._id,
      contextVersion: applied.conversation.contextVersion,
      replyWork: applied.replyWork,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Drain                                                               */
/* ------------------------------------------------------------------ */

/**
 * How stale a pending receipt must be before the drain re-drives it. Long
 * enough that the callback's own schedule, which runs at commit time, is not
 * raced by the cron.
 */
const DRAIN_MIN_AGE_MS = 2 * 60 * 1000;
/** Rows read per sweep. */
const DRAIN_SCAN_LIMIT = 200;
/** Rows re-driven per sweep. */
const DRAIN_DISPATCH_LIMIT = 50;

/**
 * Re-drive inbound receipts that never reached a terminal handling state —
 * the recovery path G3 asks for ("retain a small replay/reconciliation record
 * so failed callback handling is visible and recoverable").
 *
 * It exists because the callback that schedules handling cannot be retried:
 * Workpool does not retry mutations, and the component will not re-dispatch an
 * `event_id` it has already ingested. Without this, one lost schedule strands
 * a verified reply forever.
 *
 * Outbound delivery receipts also sit `pending` until `sending.ts` folds them
 * onto their attempt, so the scan is filtered to the inbound application-key
 * prefix — this sweep must never touch the send path's rows. It scans a wider
 * page than it dispatches so a run of outbound rows cannot starve the inbound
 * ones behind them. Each row is scheduled separately, not run inline, so one
 * poisoned receipt cannot roll back the whole sweep.
 */
export const drainPendingInboundReceipts = internalMutation({
  args: {},
  returns: v.object({ scanned: v.number(), scheduled: v.number() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - DRAIN_MIN_AGE_MS;
    const stale = await ctx.db
      .query("emailEventReceipts")
      .withIndex("by_handlingState_and_receivedAt", (q) =>
        q.eq("handlingState", "pending").lt("receivedAt", cutoff),
      )
      .take(DRAIN_SCAN_LIMIT);
    let scheduled = 0;
    for (const receipt of stale) {
      if (scheduled >= DRAIN_DISPATCH_LIMIT) {
        break;
      }
      if (!receipt.applicationKey.startsWith("incoming:")) {
        continue;
      }
      await ctx.scheduler.runAfter(0, internal.inbox.applyInboundMessage, {
        receiptId: receipt._id,
      });
      scheduled += 1;
    }
    return { scanned: stale.length, scheduled };
  },
});
