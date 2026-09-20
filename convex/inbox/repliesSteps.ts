/**
 * The FREE half of reply handling, as transactions: the gate that decides how
 * far a message may be taken, and the outcome of a rule that fired.
 *
 * Nothing in this file can spend money. It reads the gates, it applies the
 * deterministic rules' consequences — a suppression, a closed lead, a
 * disposition, a note — and it hands the rest to `repliesRun.ts`, which is
 * the only module with a paid call in it. That split is what makes "an
 * unsubscribe is honoured with the org at zero credits and the kill
 * switch on" a property of the code rather than a promise: the path from an
 * unsubscribe to a suppression never passes through `withCredits`.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { readInboundFacts } from "./inboundModel";
import { closeLeadLost, leadOfConversation } from "./repliesLead";
import {
  applyDisposition,
  AUTO_REPLY_LIMIT,
  automaticReplyCount,
  findInboundReceipt,
  holdForUser,
  noteOnThread,
  vReplyHandlingMode,
} from "./repliesModel";
import type { ReplyHandlingMode } from "./repliesModel";
import { resolveOutboundRecipient } from "./conversationsModel";
import { evaluateReplyAnswerGate, evaluateReplyHistory } from "./replyGate";

/* ------------------------------------------------------------------ */
/* The gate, and the dispatch                                          */
/* ------------------------------------------------------------------ */

const vHandleInboundReplyResult = v.object({
  outcome: v.string(),
  mode: v.optional(vReplyHandlingMode),
});

type HandleInboundReplyResult = typeof vHandleInboundReplyResult.type;

/**
 * Decide what may happen to one inbound message, and start it.
 *
 * Scheduled by the inbound transaction that stored the message and by the
 * resume that re-armed the thread (`repliesModel.scheduleReplyHandling`), so
 * it runs in its own transaction and a failure here can never roll back the
 * receipt that makes the message replayable.
 *
 * ORDER, and why it is this one:
 *   1. the HISTORY gate — a refusal here stops everything, including the free
 *      rules. Backfilled mail, mail older than the connection and mail in a
 *      thread we did not start are readable in the Inbox and nothing more.
 *   2. the ANSWER gate — a refusal here only stops the AGENT from speaking.
 *      The rules still run, because a paused agent must still stop mailing
 *      someone who asked it to.
 *   3. the ceiling — two automatic replies per thread, then a person takes it
 *      (PLAN §9.3). The hold is placed here, before the third answer could be
 *      written, and this message is still classified so the Inbox can say
 *      what it was.
 */
export const handleInboundReply = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageRef: v.string(),
  },
  returns: vHandleInboundReplyResult,
  handler: async (ctx, args): Promise<HandleInboundReplyResult> => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      return { outcome: "skipped:conversation_missing" };
    }
    const org = await ctx.db.get("orgs", conversation.orgId);
    if (org === null) {
      return { outcome: "skipped:org_missing" };
    }
    const receipt = await findInboundReceipt(
      ctx,
      conversation,
      args.messageRef,
    );
    if (receipt === null) {
      return { outcome: "skipped:receipt_missing" };
    }
    const facts = readInboundFacts(receipt);

    const history = await evaluateReplyHistory(ctx, {
      conversation,
      org,
      receipt,
      fromAddress: facts.fromAddress,
    });
    if (!history.handle) {
      return { outcome: `skipped:${history.blockedBy}` };
    }

    const answerGate = await evaluateReplyAnswerGate(
      ctx,
      conversation,
      facts.optOutSignal,
      facts.fromAddress,
    );
    let mode: ReplyHandlingMode = "free_only";
    if (answerGate.start) {
      const answered = await automaticReplyCount(ctx, conversation);
      if (answered >= AUTO_REPLY_LIMIT) {
        mode = "classify_only";
        await holdForUser(
          ctx,
          conversation,
          `Your agent has already answered this thread ${answered} times, which is the limit. This reply is classified for you but not answered — read it and take it from here, then use "Let the agent answer again" if you want automation back on this thread.`,
        );
      } else {
        mode = "answer";
      }
    } else if (answerGate.blockedBy === "agent_not_sending") {
      // PLAN §9.3: a Sourcing-only or Paused agent has its replies shown and
      // classified, and answers none of them.
      mode = "classify_only";
    }

    await ctx.scheduler.runAfter(0, internal.inbox.repliesRun.runReplyHandling, {
      conversationId: conversation._id,
      messageRef: args.messageRef,
      mode,
    });
    return { outcome: `dispatched:${mode}`, mode };
  },
});

/* ------------------------------------------------------------------ */
/* What a rule that fired does                                         */
/* ------------------------------------------------------------------ */

const vFreeRuleKind = v.union(
  v.literal("unsubscribe"),
  v.literal("bounce"),
  v.literal("auto_reply"),
  v.literal("ambiguous_opt_out"),
);

const vApplyFreeRuleResult = v.object({
  applied: v.boolean(),
  reason: v.optional(v.string()),
});

type ApplyFreeRuleResult = typeof vApplyFreeRuleResult.type;

/**
 * Apply the consequence of one deterministic rule.
 *
 * WHICH ADDRESS IS SUPPRESSED, and by whom. Always one the APPLICATION
 * resolved — the address the last revision was authorized against, and the
 * address this thread's automation would mail next — exactly as
 * `inboundApply.enforceOptOut` requires. Nothing is ever read out of the
 * message, so a reply cannot nominate its own suppression target.
 *
 * AND WHO IS ALLOWED TO ASK. For an unsubscribe the SPEAKER must be the
 * person we mailed: an opt-out from a colleague on cc is a claim made on
 * someone else's behalf, so it is downgraded to the ambiguous hold and
 * suppresses nothing. A bounce is the opposite case by construction — it
 * comes from a mail system, never from the lead — so it suppresses the exact
 * address that failed and nothing else, which is the same rule
 * `outreach/sendReceipts.ts` applies to a provider bounce event.
 */
export const applyFreeRuleOutcome = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageRef: v.string(),
    kind: vFreeRuleKind,
    rule: v.string(),
    /** The verified sender, when the header named exactly one address. */
    fromAddress: v.optional(v.string()),
  },
  returns: vApplyFreeRuleResult,
  handler: async (ctx, args): Promise<ApplyFreeRuleResult> => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      return { applied: false, reason: "conversation_missing" };
    }
    if (conversation.lastInboundMessageRef !== args.messageRef) {
      return { applied: false, reason: "message_superseded" };
    }
    const rule = args.rule.slice(0, 100);

    if (args.kind === "auto_reply") {
      await applyDisposition(ctx, conversation, "automated");
      await noteOnThread(
        ctx,
        conversation,
        `This looks like an automatic answer (rule ${rule}), so your agent did not reply to it. Follow-ups on this thread stay cancelled — the lead has replied.`,
      );
      return { applied: true };
    }

    if (args.kind === "ambiguous_opt_out") {
      await applyDisposition(ctx, conversation, "needs_review");
      // The inbound transaction's own opt-out rule usually got here first and
      // wrote the hold and its note. Repeating them would bury what it said
      // under a paraphrase, so this only names the verdict for the Inbox.
      if (conversation.takeoverReason !== "ambiguous_opt_out") {
        await holdForUser(
          ctx,
          conversation,
          `This reply may be asking not to be contacted (rule ${rule}), but the words are not a clear request. Nothing was suppressed and your agent will not answer it — read it and decide. Settings → Blocklist is where a genuine one goes.`,
        );
      }
      return { applied: true };
    }

    const { recipient, latestDraft } = await resolveOutboundRecipient(
      ctx,
      conversation,
    );

    if (args.kind === "unsubscribe") {
      const verified =
        latestDraft !== null &&
        args.fromAddress !== undefined &&
        args.fromAddress === latestDraft.normalizedRecipient;
      if (!verified) {
        // Explicit words, unverified speaker. Hold, do not suppress.
        await applyDisposition(ctx, conversation, "needs_review");
        await holdForUser(
          ctx,
          conversation,
          `Someone on this thread asked not to be contacted (rule ${rule}), but the request did not come from the address the thread was sent to, so nothing was suppressed. Review it and use Settings → Blocklist if it is genuine.`,
        );
        return { applied: true };
      }
      const targets = new Set<string>([latestDraft.normalizedRecipient]);
      if (recipient !== null) {
        targets.add(recipient);
      }
      await suppress(ctx, conversation, targets, "unsubscribe");
      await applyDisposition(ctx, conversation, "unsubscribe");
      await stopLead(
        ctx,
        conversation,
        `They asked not to be contacted again (rule ${rule})`,
        `unsubscribe:${args.messageRef}`,
      );
      await noteOnThread(
        ctx,
        conversation,
        `Opt-out honoured: ${targets.size === 1 ? "this address is" : "the address that asked and this thread's outbound contact address are both"} suppressed for the organization, and the lead is closed. Remove the suppression in Settings → Blocklist to contact them again.`,
      );
      return { applied: true };
    }

    // A permanent delivery failure. The address that failed is the one the
    // last revision was mailed to — never one named in the notice.
    const failed = latestDraft?.normalizedRecipient;
    if (failed !== undefined) {
      await suppress(ctx, conversation, new Set([failed]), "bounce");
    }
    await applyDisposition(ctx, conversation, "automated");
    await stopLead(
      ctx,
      conversation,
      `Mail to this address is permanently undeliverable (rule ${rule})`,
      `bounce:${args.messageRef}`,
    );
    await noteOnThread(
      ctx,
      conversation,
      failed === undefined
        ? `The mail system reported a permanent delivery failure on this thread (rule ${rule}). No outbound address was on record to suppress; the lead is closed.`
        : `The mail system reported a permanent delivery failure (rule ${rule}). That address is suppressed for the organization and the lead is closed.`,
    );
    return { applied: true };
  },
});

/* ------------------------------------------------------------------ */
/* Shared writes                                                       */
/* ------------------------------------------------------------------ */

async function suppress(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  targets: ReadonlySet<string>,
  reason: "unsubscribe" | "bounce",
): Promise<void> {
  for (const value of targets) {
    await ctx.runMutation(internal.outreach.suppressions.recordSuppression, {
      orgId: conversation.orgId,
      // Always `email`. One person's opt-out — or one dead mailbox — never
      // implies the domain (`outreach/suppressions.ts` owns that rule).
      kind: "email",
      value,
      reason,
      sourceConversationId: conversation._id,
    });
  }
}

async function stopLead(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  reason: string,
  key: string,
): Promise<void> {
  const lead = await leadOfConversation(ctx, conversation);
  if (lead === null) {
    return;
  }
  await closeLeadLost(ctx, lead, {
    reason,
    operationKey: `lead:${lead._id}:${key}`,
  });
}
