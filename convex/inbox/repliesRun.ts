/**
 * ONE inbound reply: read it, stop it for free if a rule says so, and only
 * then ask the model (EXECUTION T41, PLAN §9.1 "steps, not loops").
 *
 * THE ORDER OF THIS FILE IS THE GUARANTEE. Everything above the
 * `runStructured` call is free: the stored message is read, the deterministic
 * rules run, and a rule that fires returns from the handler. There is exactly
 * one call in this module that can reach `withCredits`, it is below all of
 * that, and nothing after a rule fires can reach it. That is what makes "an
 * unsubscribe still stops the sends with the org at zero credits and
 * the kill switch on" checkable by reading forty lines rather than believing
 * a comment.
 *
 * ONE PAID CALL, BETWEEN TWO TRANSACTIONS, NEVER A LOOP. The step is
 * idempotent by its operation key — conversation + message + agent revision
 * — so a re-driven wake replays what it already bought instead of buying a
 * second classification, and `runStructured` performs its own single retry of
 * an unusable object internally. A failure here is not retried blindly: it
 * ends with the thread handed to the user, visibly (PLAN §6 — never a silent
 * drop).
 */
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import {
  HANDLE_REPLY_MAX_OUTPUT_TOKENS,
  HANDLE_REPLY_SYSTEM,
  handleReplyInput,
  vHandleReplyResult,
} from "../ai/handleReply";
import { runStructured } from "../ai/run";
import { sameInboxRef } from "../lib/validators";
import { v } from "convex/values";
import type { ReplyContext } from "./repliesContext";
import { vReplyHandlingMode } from "./repliesModel";
import { detectReplyRule, readInboundMessageText } from "./repliesRules";
import type { InboundMessageText } from "./repliesRules";

const vRunReplyResult = v.object({ outcome: v.string() });

type RunReplyResult = typeof vRunReplyResult.type;

/** A message with no readable text — what the rules see when the store has
 *  nothing for it, so the receipt's own opt-out verdict still counts. */
const NO_MESSAGE: InboundMessageText = { body: "", headers: {} };

export const runReplyHandling = internalAction({
  args: {
    conversationId: v.id("conversations"),
    messageRef: v.string(),
    mode: vReplyHandlingMode,
  },
  returns: vRunReplyResult,
  handler: async (ctx, args): Promise<RunReplyResult> => {
    const context: ReplyContext = await ctx.runMutation(
      internal.inbox.repliesContext.beginReplyHandling,
      { conversationId: args.conversationId, messageRef: args.messageRef },
    );
    if (context.status === "skip") {
      return { outcome: `skipped:${context.reason}` };
    }

    /* ---------- free, and never blocked by money ------------------- */

    const stored = await readStoredMessage(ctx, {
      providerThreadRef: context.providerThreadRef,
      inboxRef: context.inboxRef,
      messageRef: args.messageRef,
    });
    const message = stored ?? NO_MESSAGE;
    const rule = detectReplyRule({
      message,
      receiptSignal: context.receiptSignal,
      outboundRecipient: context.outboundRecipient,
    });
    if (rule !== null) {
      await ctx.runMutation(internal.inbox.repliesSteps.applyFreeRuleOutcome, {
        conversationId: args.conversationId,
        messageRef: args.messageRef,
        kind: rule.kind,
        rule: rule.rule,
        ...(message.fromAddress !== undefined
          ? { fromAddress: message.fromAddress }
          : context.fromAddress !== undefined
            ? { fromAddress: context.fromAddress }
            : {}),
      });
      return { outcome: `rule:${rule.kind}` };
    }
    if (args.mode === "free_only") {
      // Some other gate is closed, so nothing beyond the rules may run. The
      // reply is in the Inbox; a person decides.
      return { outcome: "free_only:no_rule" };
    }

    /* ---------- the one paid call ---------------------------------- */

    const operationKey = context.operationKey;
    if (operationKey === undefined) {
      return { outcome: "skipped:no_agent" };
    }
    if (context.brief === undefined) {
      await fail(ctx, args.conversationId, "no_profile");
      return { outcome: "failed:no_profile" };
    }
    if (stored === null || message.body.trim() === "") {
      await fail(ctx, args.conversationId, "no_message_text");
      return { outcome: "failed:no_message_text" };
    }

    const brief = context.brief;
    const answered = await runStructured(ctx, {
      orgId: context.orgId,
      action: "handle_reply",
      tier: "fast",
      system: HANDLE_REPLY_SYSTEM,
      input: handleReplyInput({
        seller: brief.seller,
        lead: brief.lead,
        goal: brief.goal,
        tone: brief.tone,
        previousEmails: brief.previousEmails,
        ...(brief.instructions !== undefined
          ? { instructions: brief.instructions }
          : {}),
        ...(brief.bookingUrl !== undefined
          ? { bookingUrl: brief.bookingUrl }
          : {}),
        inbound: {
          body: message.body,
          ...(message.subject !== undefined ? { subject: message.subject } : {}),
        },
      }),
      result: vHandleReplyResult,
      operationKey,
      maxOutputTokens: HANDLE_REPLY_MAX_OUTPUT_TOKENS,
    });

    if (answered.kind === "refunded") {
      // Refused before the request left us — the kill switch, a spent budget,
      // an empty balance or our own unusable input. Nothing was charged.
      await fail(ctx, args.conversationId, "refused");
      return { outcome: `refused:${answered.reason}` };
    }
    if (answered.kind === "uncertain") {
      // The request may have left us. The hold parks as `uncertain` and the
      // recovery sweep owns it; the thread goes to the user meanwhile.
      await fail(ctx, args.conversationId, "uncertain");
      return { outcome: "uncertain" };
    }
    if (answered.replayed) {
      // This exact classification was already bought, and a replay carries no
      // object. Two runs of the same message can overlap — the inbound
      // schedule and a resume, seconds apart — so the honest question is
      // whether the FIRST one has since written a verdict. Re-reading the
      // gate answers it without spending anything: `already_handled` means it
      // did, and this run has nothing left to do.
      const settled: ReplyContext = await ctx.runMutation(
        internal.inbox.repliesContext.beginReplyHandling,
        { conversationId: args.conversationId, messageRef: args.messageRef },
      );
      if (settled.status === "skip") {
        return { outcome: `replayed:${settled.reason}` };
      }
      await fail(ctx, args.conversationId, "replayed_without_answer");
      return { outcome: "replayed_without_answer" };
    }
    if (answered.result.status !== "object") {
      // A completed generation, billed, whose object did not survive our own
      // validation twice over. Billed and unusable is still not a drop.
      await fail(ctx, args.conversationId, "invalid_response");
      return { outcome: "failed:invalid_response" };
    }

    const applied = await ctx.runMutation(
      internal.inbox.repliesDecide.applyReplyDecision,
      {
        conversationId: args.conversationId,
        messageRef: args.messageRef,
        mode: args.mode,
        operationKey,
        answer: answered.result.object,
      },
    );
    return { outcome: applied.outcome };
  },
});

/* ------------------------------------------------------------------ */
/* Reading the message                                                 */
/* ------------------------------------------------------------------ */

/**
 * The one stored inbound row for this message.
 *
 * Inbound bodies live in the mail component's own store, selected by the
 * conversation's OWN `providerThreadRef` and then filtered to its own
 * `inboxRef`: the component's `by_thread` index is global and provider thread
 * ids are per-inbox, so the inbox filter is what keeps a colliding thread id
 * in another inbox out of this org's reply flow — the same rule
 * `conversationThread.thread` keeps for the read surface.
 *
 * A failure here degrades to "no text" rather than ending the step: the
 * receipt's own opt-out verdict was computed at the callback and still
 * counts, so a clear unsubscribe is honoured even when the body cannot be
 * read.
 */
async function readStoredMessage(
  ctx: ActionCtx,
  args: {
    providerThreadRef: string | undefined;
    inboxRef: string;
    messageRef: string;
  },
): Promise<InboundMessageText | null> {
  const threadRef = args.providerThreadRef;
  if (threadRef === undefined) {
    return null;
  }
  let rows: Array<Record<string, unknown>>;
  try {
    rows = (await ctx.runQuery(components.agentmail.lib.listInboundMessages, {
      threadId: threadRef,
    })) as Array<Record<string, unknown>>;
  } catch {
    return null;
  }
  for (const row of rows) {
    // The inbox is compared case-insensitively (`sameInboxRef`): provider
    // inbox ids are addresses, and a stored row whose id differs only in case
    // is the same inbox. An exact match here would end classification on
    // `failed:no_message_text` for a message we do hold, instead of reading
    // it. The MESSAGE id stays exact — it is an opaque provider identifier.
    if (
      sameInboxRef(row.inboxId, args.inboxRef) &&
      row.messageId === args.messageRef
    ) {
      return readInboundMessageText(row);
    }
  }
  return null;
}

/** Every way this step can end without a verdict. */
type ReplyFailureCode =
  | "invalid_response"
  | "refused"
  | "uncertain"
  | "no_profile"
  | "no_message_text"
  | "replayed_without_answer";

/** Hand the thread to the user, with the reason in plain words. */
async function fail(
  ctx: ActionCtx,
  conversationId: Id<"conversations">,
  code: ReplyFailureCode,
): Promise<void> {
  await ctx.runMutation(internal.inbox.repliesDecide.failReplyHandling, {
    conversationId,
    code,
  });
}
