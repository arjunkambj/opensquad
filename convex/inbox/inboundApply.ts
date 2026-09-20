/**
 * Applying a matched inbound message to its conversation, in the order the
 * card fixes: context invalidation, then the inbound facts, then the
 * deterministic opt-out rule, then the review hold.
 *
 * All of it is one transaction, so reply work cannot commit unless the
 * context invalidation did.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { domainError } from "../lib/validators";
import type { TakeoverReason } from "../lib/validators";
import { recordConversationNote } from "./conversationNotes";
import { resolveOutboundRecipient } from "./conversationsModel";
import type { InboundFacts } from "./inboundModel";
import { mergeConversationSource } from "./model";
import {
  evaluateReplyAutomation,
  NOTED_REPLY_GATE_BLOCKS,
} from "./replyGate";
import type { ReplyGateVerdict } from "./replyGate";

/**
 * Apply one verified inbound message to its conversation, in the order
 * architecture §8 requires and V17 tests.
 *
 * STEP 1 — `internal.outreach.conversationStaging.applyInboundContext`, first and unconditionally.
 * One call, two invalidations, and this module reimplements neither: it
 * advances `contextVersion` (which is what makes every live approval refuse
 * at preflight with `context_changed`, and every recorded approval stop
 * applying), and calls
 * `internal.outreach.sendControls.cancelParkedConversationAttempts` (which releases each
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
export async function applyToConversation(
  ctx: MutationCtx,
  receipt: Doc<"emailEventReceipts">,
  conversation: Doc<"conversations">,
  facts: InboundFacts,
): Promise<{
  conversation: Doc<"conversations">;
  replyWork: ReplyGateVerdict;
}> {
  // 1. Version bump, approval invalidation, parked follow-up cancellation.
  await ctx.runMutation(internal.outreach.conversationStaging.applyInboundContext, {
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

  // 2b. The thread-level source stamp. A live message on a thread the connect
  //     backfill imported PROMOTES it — `mergeMessageSource` is the one
  //     definition of that rule, shared with the message-row writer, and a
  //     later backfill can never move it back (PLAN §9.4).
  await mergeConversationSource(ctx, current, receipt.source);

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
    await ctx.runMutation(internal.leads.mutations.markReplied, {
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
 * the domain (`outreach/suppressions.ts` keeps that rule and P11 does not weaken it).
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
 * `sendGates.evaluateSendGates` refuses dispatch with `suppressed_email`, and
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
      // implies the domain, and `outreach/suppressions.ts` keeps that rule.
      const targets = new Set<string>([latestDraft.normalizedRecipient]);
      if (recipient !== null) {
        targets.add(recipient);
      }
      for (const value of targets) {
        await ctx.runMutation(internal.outreach.suppressions.recordSuppression, {
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
