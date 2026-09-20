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
  SENDING_AGENT_MODES,
} from "./lib/validators";
import type { OptOutSignal, TakeoverReason } from "./lib/validators";
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
  "agent_mismatch",
  "agent_not_sending",
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
  v.literal("agent_mismatch"),
  v.literal("agent_not_sending"),
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
 * One call, two invalidations, and this module reimplements neither: it
 * advances `contextVersion` (which is what makes every live approval refuse
 * at preflight with `context_changed`, and every recorded approval stop
 * applying), and calls
 * `internal.sending.cancelParkedConversationAttempts` (which releases each
 * `reserved` attempt's usage reservation) — that last one being "cancel
 * pending follow-ups".
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
 * WHY THE ORDER IS PROVABLE, not merely intended. Steps 1–4 are one Convex
 * transaction (`ctx.runMutation` from a mutation is a sub-transaction), so
 * nothing at step 5 can commit unless the invalidation committed with it. The
 * race in the other direction is closed too: an approval attempted between the
 * bump and the start hits `approvals.resolveDraft`, which re-checks that
 * `conversation.contextVersion === draft.basedOnContextVersion`.
 */
async function applyToConversation(
  ctx: MutationCtx,
  receipt: Doc<"emailEventReceipts">,
  conversation: Doc<"conversations">,
  facts: InboundFacts,
): Promise<{
  conversation: Doc<"conversations">;
  replyWork: ReplyGateVerdict;
}> {
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
  //
  //    TOTAL over the message, not conditional on it parsing. `lastInboundFrom`
  //    is documented as the sender of the message `lastInboundMessageRef`
  //    names, and `conversations.resume` treats it as the authority for the
  //    §8 verified-sender check: an undefined value lands on
  //    `sender_unverified`, a present one is compared against the address we
  //    mail. Writing it only when the new sender parsed left the PREVIOUS
  //    message's sender standing beside the new message's reference, so a
  //    message whose `From` carries two addresses (or any header
  //    `parseInboundSender` refuses) would be resumed on the strength of the
  //    one before it. Clearing the field is the honest answer — a Convex
  //    patch with `undefined` removes it — and `sender_unverified` is then
  //    reached for exactly the messages that cannot be verified.
  const current = await ctx.db.get("conversations", conversation._id);
  if (current === null) {
    // Unreachable inside this transaction — step 1 already throws NOT_FOUND
    // when the row is gone, and nothing on this path deletes a conversation.
    // Refusing beats inventing a gate blocker that would misreport why.
    throw domainError("NOT_FOUND", "conversation not found");
  }
  if (facts.fromAddress !== current.lastInboundFrom) {
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

  // 4b. The reply FACT, independent of the automation verdict (P19 §8): a
  //     verified inbound on a lead-bound thread stamps `lastReplyAt` and
  //     advances the lead to `replied` even when the gate freezes drafting —
  //     takeover, suppression and hold states stop model work, they do not
  //     un-reply the reply. Keyed on the message ref so the receipt drain's
  //     replay dedupes.
  if (settled.prospectId !== undefined) {
    await ctx.runMutation(internal.prospects.markReplied, {
      conversationId: settled._id,
      messageRef: receipt.providerMessageRef,
      at: receipt.receivedAt,
    });
  }

  // 5. The dispatch point, and the only one. Everything above has committed
  //    to this transaction before any model work could be started.
  if (!replyWork.start) {
    // A policy refusal that would otherwise leave no trace is recorded.
    if (NOTED_REPLY_GATE_BLOCKS.has(replyWork.blockedBy)) {
      await recordConversationNote(ctx, {
        conversation: settled,
        kind: "system",
        actor: "system",
        body: `Reply automation did not run for this message (${replyWork.blockedBy}). The reply is retained for human review; no draft and no send were produced.`,
      });
    }
    return { conversation: settled, replyWork };
  }

  // The gate passed, so reply automation MAY run for this message. Nothing
  // runs it today: the conversation stays un-classified and needs a human.
  // AI classify/draft: reimplemented via Convex AI Gateway (see plan)
  return { conversation: settled, replyWork };
}

/* ------------------------------------------------------------------ */
/* Opt-out                                                             */
/* ------------------------------------------------------------------ */

/**
 * Act on the deterministic opt-out verdict the callback computed.
 *
 * WHAT GETS SUPPRESSED, AND BY WHOM. Every address suppressed is one the
 * APPLICATION resolved: the `normalizedRecipient` of the conversation's most
 * recent draft revision (the address we actually mailed) and, when it differs,
 * the address `resolveOutboundRecipient` says this thread's automation would
 * mail next — the linked lead's contact. Neither is ever read out of the
 * inbound payload, so a message cannot nominate its own suppression target.
 * Suppression is `kind: "email"` for each; an individual opt-out never implies
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
    // TWO addresses, and they are not always the same one.
    //
    // The SPEAKER must be the person we mailed — `latestDraft
    // .normalizedRecipient`, the address the last revision was actually
    // authorized against. An explicit opt-out from anyone else is a claim
    // made on someone else's behalf, so it is only ever the verification
    // target.
    //
    // The address automation would mail NEXT is `resolveOutboundRecipient`'s
    // `recipient`, which prefers the LINKED LEAD'S CONTACT and falls back to
    // that revision only when the lead has none. The two genuinely diverge,
    // because `drafts.revise` lets an operator redirect a revision to the
    // real buyer while the lead row still carries the generic contact — and
    // `recipient` is the value `evaluateReplyAutomation` feeds to
    // `matchSuppression` and the value `installReplyDraft` addresses a draft
    // to. Suppressing only the revision's address therefore left the gate
    // checking an address nothing had suppressed, and the next inbound on the
    // thread drafted a reply to the company that had just asked to be removed.
    const { recipient, latestDraft } = await resolveOutboundRecipient(
      ctx,
      conversation,
    );
    const verified =
      latestDraft !== null &&
      facts.fromAddress !== undefined &&
      facts.fromAddress === latestDraft.normalizedRecipient;
    if (verified) {
      // Both, when they differ. Both are the APPLICATION'S own addresses —
      // one from a revision it authorized, one from the linked lead's
      // contact record — and neither is ever read out of the inbound
      // payload, so a message still cannot nominate its own suppression
      // target. Still `kind: "email"` for each: an individual opt-out never
      // implies the domain, and `suppressions.ts` keeps that rule.
      const targets = new Set<string>([latestDraft.normalizedRecipient]);
      if (recipient !== null) {
        targets.add(recipient);
      }
      for (const value of targets) {
        await ctx.runMutation(internal.suppressions.recordSuppression, {
          workspaceId: conversation.workspaceId,
          kind: "email",
          value,
          reason: "unsubscribe",
          sourceConversationId: conversation._id,
        });
      }
      await recordConversationNote(ctx, {
        conversation,
        kind: "system",
        actor: "system",
        body:
          `Opt-out honoured: the verified sender asked to be removed (rule ${rule}). ` +
          (targets.size === 1
            ? "This address is suppressed for the workspace"
            : "The address that asked and this thread's outbound contact address are both suppressed for the workspace") +
          "; remove the suppression to contact them again.",
      });
      return;
    }
    // Explicit words, unverified speaker. Hold, do not suppress.
    await holdForReview(
      ctx,
      conversation,
      "ambiguous_opt_out",
      `Possible opt-out held for review: the request (rule ${rule}) did not come from the address this thread was sent to, so nothing was suppressed. Review the message and use Suppressions if it is genuine.`,
    );
    return;
  }

  await holdForReview(
    ctx,
    conversation,
    "ambiguous_opt_out",
    `Possible opt-out held for review (rule ${rule}). Automation is frozen and nothing was suppressed — a human decides whether this is an opt-out.`,
  );
}

/**
 * Freeze automation pending review and say why, on the row and in a note.
 *
 * It deliberately does NOT advance `contextVersion`. Every caller runs either
 * inside the inbound transaction, whose bump already carried exactly this
 * invalidation, or after a classification that produced no draft — so there
 * is nothing authorized against an older version left to retire, and a second
 * bump would only strand work an operator legitimately approved in between.
 */
async function holdForReview(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  reason: TakeoverReason,
  note: string,
): Promise<void> {
  const now = Date.now();
  await ctx.db.patch("conversations", conversation._id, {
    humanTakeover: true,
    takeoverReason: reason,
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
 * every later path to model work re-runs it before dispatch, because a
 * takeover, a close, a workspace pause or a suppression can land in between,
 * and a stale wake must then spend nothing.
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
    conversation.agentId === undefined
  ) {
    return blocked("association_missing");
  }
  const prospect = await ctx.db.get("prospects", conversation.prospectId);
  if (prospect === null || prospect.workspaceId !== conversation.workspaceId) {
    return blocked("association_missing");
  }
  const agent = await ctx.db.get("agents", conversation.agentId);
  if (agent === null || agent.workspaceId !== conversation.workspaceId) {
    return blocked("association_missing");
  }
  // The agent frozen on the conversation at association is the authority; a
  // lead re-pointed since must not silently retarget in-flight work.
  if (prospect.agentId !== conversation.agentId) {
    return blocked("agent_mismatch");
  }
  // Sourcing-only and paused agents are shown their replies and answer none
  // of them (PLAN §9.3).
  if (!SENDING_AGENT_MODES.includes(agent.mode)) {
    return blocked("agent_not_sending");
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
  "agent_mismatch",
  "agent_not_sending",
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
 *
 * And ORDER-SAFE by construction: a receipt older than the inbound the
 * conversation already carries is settled without being applied, so the drain
 * — the one path that can deliver an older message after a newer one — can
 * never rewind the thread.
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
      // unassigned queue under human takeover, with no lead, no draft and no
      // send (architecture §8 step 4).
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

    // A LATE inbound must never rewind the conversation.
    //
    // The drain exists precisely so a receipt whose callback schedule was
    // lost is re-driven minutes or hours later — by which time a NEWER
    // message on the same thread may already have been applied. Everything
    // `applyToConversation` writes describes "the latest inbound":
    // `lastInboundMessageRef`, `lastInboundAt`, `lastInboundFrom` and a
    // `contextVersion` bump that invalidates every recorded approval.
    // Replaying an older message through it would rewind all four —
    // invalidating the draft an operator is looking at for the newer message
    // and answering the older one instead.
    //
    // `drafts.applyInboundContext` already clamps `lastMessageAt` for exactly
    // this reason and says so; its own guard compares only the LAST applied
    // message, so it cannot see a late A behind an applied B. This is that
    // same clamp for everything the late message would otherwise carry.
    // Settled `handled`, not `failed`: nothing went wrong — the message is
    // real, it simply arrived after the thread had moved past it, and the
    // reason makes that readable in `sendAttempts.listReceipts`.
    const lastInboundAt = target.lastInboundAt;
    if (lastInboundAt !== undefined && receipt.receivedAt < lastInboundAt) {
      await settleReceipt(ctx, receipt, "handled", "late_inbound_superseded");
      return {
        outcome: "skipped" as const,
        conversationId: target._id,
        contextVersion: target.contextVersion,
        reason: "late_inbound_superseded",
      };
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
/** Rows re-driven per sweep. */
const DRAIN_DISPATCH_LIMIT = 50;
/**
 * How old an outbound receipt that matches no send attempt must be before the
 * sweep settles it.
 *
 * An attempt records its `providerMessageRef` in the same transaction as the
 * provider's acceptance, so a receipt for mail this application sent finds its
 * attempt within seconds. A day later, no attempt in the workspace carries
 * that reference and none ever will — the message was sent from the shared
 * inbox by something other than OpenSquad, or it belongs to an attempt an
 * operator resolved as "not sent" and replaced under a new provider id.
 */
const OUTBOUND_REAP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** Outbound rows examined per sweep. */
const OUTBOUND_REAP_LIMIT = 50;

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
 * THE SCAN IS A RANGE, NOT A FILTERED PAGE. The two halves of the mail path
 * reach a terminal `handlingState` by completely different routes: an inbound
 * row through `applyInboundMessage`, an outbound one only once a send attempt
 * carries its `providerMessageRef`. An outbound receipt whose reference never
 * lands on an attempt therefore stays `pending` forever — and those rows, by
 * definition the oldest pending rows in the table, filled an oldest-first
 * page taken on `handlingState` alone. Two hundred of them and this sweep
 * returned `{scanned: 200, scheduled: 0}` on every run, silently, with the
 * recovery path for a lost inbound callback dead. `direction` leads the index
 * so the sweep ranges over inbound rows only (§5 — a post-filtered page is
 * not a filtered result). Each row is scheduled separately, not run inline, so
 * one poisoned receipt cannot roll back the whole sweep.
 *
 * The same run settles the outbound rows that produced that starvation, so
 * they stop accumulating — but only after proving the claim, by looking for
 * the attempt they would have folded onto.
 */
export const drainPendingInboundReceipts = internalMutation({
  args: {},
  returns: v.object({
    scanned: v.number(),
    scheduled: v.number(),
    reaped: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - DRAIN_MIN_AGE_MS;
    const stale = await ctx.db
      .query("emailEventReceipts")
      .withIndex("by_direction_and_handlingState_and_receivedAt", (q) =>
        q
          .eq("direction", "inbound")
          .eq("handlingState", "pending")
          .lt("receivedAt", cutoff),
      )
      .take(DRAIN_DISPATCH_LIMIT);
    for (const receipt of stale) {
      await ctx.scheduler.runAfter(0, internal.inbox.applyInboundMessage, {
        receiptId: receipt._id,
      });
    }
    const reaped = await reapUnmatchedOutboundReceipts(ctx, now);
    return { scanned: stale.length, scheduled: stale.length, reaped };
  },
});

/**
 * Settle outbound delivery receipts that can no longer reach an attempt.
 *
 * `sendAttempts.recordReceipt` folds a delivery fact onto its attempt the
 * moment either side knows about the other — at insert when the attempt
 * already carries the provider message reference, and from
 * `sending.recordSendOutcome` when the acknowledgement lands afterwards.
 * Nothing settles a receipt whose reference never appears on an attempt at
 * all: mail sent from the shared AgentMail inbox by something other than
 * OpenSquad, or the original of a timed-out send an operator resolved as
 * "not sent" and replaced under a new provider id. Those rows sat `pending`
 * forever.
 *
 * The claim is PROVED, not assumed: the same `by_providerMessageRef` lookup
 * the fold uses runs first, and a receipt whose attempt turns up is left
 * alone for the fold to handle. `failed` with a stated reason keeps the row
 * auditable in `sendAttempts.listReceipts` and replayable by hand.
 */
async function reapUnmatchedOutboundReceipts(
  ctx: MutationCtx,
  now: number,
): Promise<number> {
  const cutoff = now - OUTBOUND_REAP_MIN_AGE_MS;
  const rows = await ctx.db
    .query("emailEventReceipts")
    .withIndex("by_direction_and_handlingState_and_receivedAt", (q) =>
      q
        .eq("direction", "outbound")
        .eq("handlingState", "pending")
        .lt("receivedAt", cutoff),
    )
    .take(OUTBOUND_REAP_LIMIT);
  let reaped = 0;
  for (const receipt of rows) {
    const candidates = await ctx.db
      .query("sendAttempts")
      .withIndex("by_providerMessageRef", (q) =>
        q.eq("providerMessageRef", receipt.providerMessageRef),
      )
      .collect();
    if (
      candidates.some(
        (attempt) => attempt.workspaceId === receipt.workspaceId,
      )
    ) {
      continue;
    }
    await settleReceipt(ctx, receipt, "failed", "no_matching_send_attempt");
    reaped += 1;
  }
  return reaped;
}
