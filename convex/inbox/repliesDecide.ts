/**
 * What the answer may change (PLAN §1's reply branches, §9.5).
 *
 * The SECOND half of the reply step: `repliesContext.ts` read the gates and
 * assembled the prompt, `repliesRun.ts` performed the one paid call, and
 * every write a classification causes is here — in one place, so it can be
 * read against the plan rather than traced through three files.
 *
 * THE ANSWER IS A SIGNAL, NEVER AN AUTHORITY. A model that says `unsubscribe`
 * holds the thread for a person and suppresses nothing (the deterministic
 * rule already stopped every clear one, for free, before this ran). A model
 * that says they agreed a time moves the lead to `meeting_proposed` and
 * leaves `suggestsBooked` as a sentence for the person reading the thread —
 * `meeting_booked` is written by one click and nothing else.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import {
  boundReplyBody,
  boundResumeDays,
  classIsAnswerable,
  replyDisposition,
  vHandleReplyResult,
} from "../ai/handleReply";
import { v } from "convex/values";
import {
  advanceLead,
  closeLeadLost,
  leadOfConversation,
  scheduleLeadFollowUp,
} from "./repliesLead";
import {
  applyDisposition,
  holdForUser,
  noteOnThread,
  vReplyHandlingMode,
} from "./repliesModel";

/* ------------------------------------------------------------------ */
/* What the answer may change                                          */
/* ------------------------------------------------------------------ */

const vApplyDecisionResult = v.object({ outcome: v.string() });

type ApplyDecisionResult = typeof vApplyDecisionResult.type;

/**
 * Record the classification and take the next step (PLAN §1 reply branches).
 *
 * Every branch stamps the disposition first, because that is what the Inbox
 * reads and what marks this message handled — a thread nothing answers is
 * still a thread the user can see the verdict on.
 */
export const applyReplyDecision = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageRef: v.string(),
    mode: vReplyHandlingMode,
    operationKey: v.string(),
    answer: vHandleReplyResult,
  },
  returns: vApplyDecisionResult,
  handler: async (ctx, args): Promise<ApplyDecisionResult> => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      return { outcome: "skipped:conversation_missing" };
    }
    if (conversation.lastInboundMessageRef !== args.messageRef) {
      return { outcome: "skipped:message_superseded" };
    }
    const answer = args.answer;
    const disposition = replyDisposition(answer.disposition);
    await applyDisposition(ctx, conversation, disposition);

    const lead = await leadOfConversation(ctx, conversation);
    const key = (suffix: string) => `${args.operationKey}:${suffix}`;

    switch (answer.disposition) {
      case "unsubscribe": {
        // A classification never suppresses (`lib/validators/inbox.ts`): the
        // deterministic rule owns that, and it already ran for free.
        await holdForUser(
          ctx,
          conversation,
          "Your agent read this as a request not to be contacted, but the wording was not clear enough to act on by itself. Nothing was suppressed and no reply was sent — read it, and use Settings → Blocklist if that is what they meant.",
        );
        return { outcome: "held:unsubscribe" };
      }
      case "not_interested": {
        if (lead !== null) {
          await closeLeadLost(ctx, lead, {
            reason: "They said no in their reply",
            operationKey: key("closed"),
          });
        }
        await noteOnThread(
          ctx,
          conversation,
          "Read as a no. The lead is closed and your agent will not write to them again on this thread.",
        );
        return { outcome: "closed:not_interested" };
      }
      case "not_now":
      case "ooo": {
        const days = boundResumeDays(answer.resumeInDays);
        if (lead !== null) {
          await scheduleLeadFollowUp(ctx, lead, days);
        }
        await noteOnThread(
          ctx,
          conversation,
          answer.disposition === "ooo"
            ? `Read as an automatic answer. No reply was sent; the lead is marked for another look in about ${days} days.`
            : `Read as "not now". No reply was sent; the lead is marked for another look in about ${days} days.`,
        );
        return { outcome: `paused:${answer.disposition}` };
      }
      case "interested":
      case "question":
      case "objection":
        break;
    }

    if (lead !== null && answer.disposition === "interested") {
      await advanceLead(ctx, lead, "interested", {
        reason: "They said they are interested in their reply",
        operationKey: key("interested"),
      });
    }
    if (lead !== null && answer.proposesMeeting) {
      const moved = await advanceLead(ctx, lead, "meeting_proposed", {
        reason: "Their reply asked for a call or named a time",
        operationKey: key("meeting-proposed"),
      });
      if (moved.stage === "meeting_proposed") {
        // A stage with no row behind it is not a proposal: the booking-link
        // gate, the dashboard's proposed/booked split and every proposal
        // linkage read `bookings`, and this branch used to write none. The
        // writer is deliberately narrow — a `proposed` row carrying the
        // AGENT'S OWN booking link, never invented times, and never
        // `meeting_booked`, which only the user's click writes (PLAN §9.5).
        const recorded = await recordProposedBooking(ctx, conversation, lead, {
          operationKey: key("booking-proposed"),
        });
        await noteOnThread(
          ctx,
          conversation,
          recorded
            ? "They asked about a time, so the lead moved to Meeting proposed and your booking link is recorded as the proposal. It counts as booked only when you press Mark as booked."
            : "They asked about a time, so the lead moved to Meeting proposed. It counts as booked only when you press Mark as booked.",
        );
      }
    }
    if (answer.suggestsBooked === true) {
      await noteOnThread(
        ctx,
        conversation,
        "This reply reads like they confirmed a specific time. Nothing books a meeting on its own — press Mark as booked with the date and time if that is right.",
      );
    }

    if (args.mode !== "answer" || !classIsAnswerable(answer.disposition)) {
      await noteOnThread(
        ctx,
        conversation,
        "Classified for you. Your agent is not answering replies on this thread, so nothing was drafted.",
      );
      return { outcome: `classified:${disposition}` };
    }

    const body = answer.replyBody === undefined ? "" : boundReplyBody(answer.replyBody);
    if (body === "") {
      await holdForUser(
        ctx,
        conversation,
        "Your agent classified this reply but did not produce an answer it was willing to send. The thread is yours — write back yourself, or use \"Let the agent answer again\" after you have.",
      );
      return { outcome: "held:no_reply_body" };
    }

    const sent = await ctx.runMutation(
      internal.outreach.replyOutreach.draftAndSendReply,
      {
        conversationId: conversation._id,
        body,
        replyToMessageRef: args.messageRef,
        requestId: args.operationKey,
      },
    );
    if (!sent.drafted) {
      await noteOnThread(
        ctx,
        conversation,
        `An answer was written but not queued (${sent.reason}). Nothing was sent; the reply is here for you to handle.`,
      );
      return { outcome: `not_drafted:${sent.reason}` };
    }
    await noteOnThread(
      ctx,
      conversation,
      sent.queued
        ? "Your agent drafted an answer to this reply. It is waiting for your approval before it goes out."
        : "Your agent answered this reply. The send is with the mail boundary now.",
    );
    return { outcome: sent.queued ? "drafted" : "answered" };
  },
});

/**
 * Record the `bookings` row behind a `meeting_proposed` stage, when there is
 * an honest proposal to record.
 *
 * There is one exactly when the agent has a booking link configured. A model
 * reading "how about Tuesday?" has not agreed a time, and the slots form of a
 * proposal names specific future intervals — inventing those would put times
 * in the pipeline that nobody offered. So an agent with no booking link moves
 * the stage and records no booking, which is the truth: the lead asked, and
 * there is nothing yet to send them.
 */
async function recordProposedBooking(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  lead: Doc<"prospects">,
  args: { operationKey: string },
): Promise<boolean> {
  if (conversation.agentId === undefined) {
    return false;
  }
  const agent = await ctx.db.get("agents", conversation.agentId);
  const bookingUrl = agent?.bookingUrl;
  if (
    agent === null ||
    agent.orgId !== conversation.orgId ||
    bookingUrl === undefined ||
    bookingUrl.trim() === ""
  ) {
    return false;
  }
  const recorded = await ctx.runMutation(
    internal.bookings.proposals.recordAgentProposal,
    {
      orgId: conversation.orgId,
      prospectId: lead._id,
      conversationId: conversation._id,
      bookingUrl,
      operationKey: args.operationKey,
    },
  );
  // A replay, an already-live booking and a refused URL all mean "no new
  // proposal was recorded"; only a row created here changes what the note says.
  return recorded.recorded;
}

/* ------------------------------------------------------------------ */
/* When the step cannot finish                                         */
/* ------------------------------------------------------------------ */

const vReplyFailureCode = v.union(
  /** The gateway completed and neither answer survived validation. */
  v.literal("invalid_response"),
  /** Refused before the request left us; nothing was charged. */
  v.literal("refused"),
  /** The request may have left us; the recovery sweep owns the hold. */
  v.literal("uncertain"),
  /** No usable company profile, so there was nothing honest to answer with. */
  v.literal("no_profile"),
  /** The message's own text is not in our store, so there is nothing to read. */
  v.literal("no_message_text"),
  /** This exact call was already bought and stored nothing usable. */
  v.literal("replayed_without_answer"),
);

/**
 * End a classification that could not be completed, visibly.
 *
 * Never a silent drop (PLAN §6): the thread is handed to the user with the
 * reason in plain words, which is the same "Needs you" state the two-reply
 * ceiling produces, and `conversations.resume` is the way back.
 */
export const failReplyHandling = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    code: vReplyFailureCode,
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args): Promise<{ applied: boolean }> => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      return { applied: false };
    }
    await holdForUser(ctx, conversation, FAILURE_NOTE[args.code]);
    return { applied: true };
  },
});

const FAILURE_NOTE: Record<typeof vReplyFailureCode.type, string> = {
  invalid_response:
    "Your agent could not make sense of this reply well enough to answer it. Nothing was sent and the thread is yours.",
  refused:
    "Your agent did not read this reply — your organization could not run the classification right now (credits, a limit, or a pause). The reply is here and nothing was sent.",
  uncertain:
    "Reading this reply did not complete, and we do not know whether it ran. Nothing was sent and nothing was drafted; the thread is yours.",
  no_profile:
    "Your agent has no complete company profile to answer from, so it did not reply. Finish Settings → Company and use \"Let the agent answer again\" on this thread.",
  no_message_text:
    "This reply arrived without any text we can read, so your agent did not try to answer it. Open it in the thread and take it from there.",
  replayed_without_answer:
    "Reading this reply was already attempted once and produced nothing usable, so it was not attempted again. Nothing was sent and the thread is yours.",
};
