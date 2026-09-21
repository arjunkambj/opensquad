/**
 * What the model is given: every gate re-read, and the prompt's facts
 * assembled, in one transaction.
 *
 * It is the FIRST half of the reply step. `repliesRun.ts` performs the one
 * paid call after it and `repliesDecide.ts` owns what the answer may change,
 * so this module writes nothing at all — it only decides whether there is
 * still anything to ask, and hands over the facts to ask it with.
 *
 * THE GATES ARE READ AGAIN HERE, deliberately. A takeover, a closure, a
 * suppression or a newer reply can land between the schedule and the run, and
 * a stale wake must spend nothing: `evaluateReplyHistory` refusing here is
 * what makes a re-driven step, a double schedule and a resume on an
 * already-classified thread all free.
 */
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { getOrgProfile, profileIsComplete } from "../company/model";
import { vAgentGoal, vAgentTone, vOptOutSignal } from "../lib/validators";
import { v } from "convex/values";
import { resolveOutboundRecipient } from "./conversationsModel";
import { readInboundFacts } from "./inboundModel";
import { leadOfConversation } from "./repliesLead";
import {
  findInboundReceipt,
  replyOperationKey,
  vReplyHandlingMode,
} from "./repliesModel";
import type { ReplyHandlingMode } from "./repliesModel";
import { evaluateReplyAnswerGate, evaluateReplyHistory } from "./replyGate";
import type { ReplyGateBlockCode } from "./replyGate";

/** Our own sent mail carried into the prompt, oldest first. */
const THREAD_MESSAGE_MAX = 6;

const vReplyContext = v.union(
  v.object({ status: v.literal("skip"), reason: v.string() }),
  v.object({
    status: v.literal("ready"),
    orgId: v.id("orgs"),
    /** The provider thread whose stored messages hold the reply's text. */
    providerThreadRef: v.optional(v.string()),
    inboxRef: v.string(),
    /** Absent when the thread has no agent — free rules only. */
    operationKey: v.optional(v.string()),
    /** The opt-out verdict the callback already computed, for free. */
    receiptSignal: vOptOutSignal,
    fromAddress: v.optional(v.string()),
    /** The address automation would mail; resolved by the application. */
    outboundRecipient: v.union(v.string(), v.null()),
    /** Everything the prompt needs. Absent when it cannot be assembled. */
    brief: v.optional(
      v.object({
        seller: v.object({
          companyName: v.string(),
          industry: v.string(),
          description: v.string(),
          keyFeatures: v.array(v.string()),
          socialProof: v.array(v.string()),
          painPoints: v.string(),
        }),
        lead: v.object({
          firstName: v.optional(v.string()),
          jobTitle: v.optional(v.string()),
          companyName: v.optional(v.string()),
          companyIndustry: v.optional(v.string()),
        }),
        goal: vAgentGoal,
        tone: vAgentTone,
        instructions: v.optional(v.string()),
        bookingUrl: v.optional(v.string()),
        previousEmails: v.array(
          v.object({ subject: v.string(), body: v.string() }),
        ),
      }),
    ),
  }),
);

export type ReplyContext = typeof vReplyContext.type;

/** The prompt's facts, once they are known to be assembled. */
type ReplyBrief = NonNullable<
  Extract<ReplyContext, { status: "ready" }>["brief"]
>;

/**
 * Gate refusals that are the REASON for a mode rather than an objection to it.
 *
 * `classify_only` is entered from exactly two places: an agent that is not in
 * a sending mode, and the two-reply ceiling, which hands the thread to a
 * person (`human_takeover`) in the same transaction that chooses the mode. A
 * re-read would find both and refuse to classify the message it was told to
 * classify. The sender check is tolerated with them because a message from a
 * colleague on cc is still worth naming in the Inbox when nothing will be
 * answered anyway.
 */
const CLASSIFY_ONLY_TOLERATED: ReadonlySet<ReplyGateBlockCode> =
  new Set<ReplyGateBlockCode>([
    "agent_not_sending",
    "human_takeover",
    "sender_contact_mismatch",
  ]);

function tolerated(mode: ReplyHandlingMode): ReadonlySet<ReplyGateBlockCode> {
  return mode === "classify_only" ? CLASSIFY_ONLY_TOLERATED : new Set();
}

/**
 * Re-read every gate and assemble the prompt's facts, in one transaction.
 *
 * The gates are read AGAIN here rather than trusted from the dispatch: a
 * takeover, a closure, a suppression or a newer reply can land between the
 * schedule and the run, and a stale wake must spend nothing.
 */
export const beginReplyHandling = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageRef: v.string(),
    /**
     * How far the dispatch decided this message may be taken. It is what says
     * WHICH gates must still hold here: `answer` has to satisfy the whole
     * answer gate again, `classify_only` everything except the two blockers
     * that put it in that mode, and `free_only` nothing at all — the free
     * rules run for an org at zero credits with the kill switch on.
     */
    mode: vReplyHandlingMode,
  },
  returns: vReplyContext,
  handler: async (ctx, args): Promise<ReplyContext> => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      return { status: "skip" as const, reason: "conversation_missing" };
    }
    const org = await ctx.db.get("orgs", conversation.orgId);
    if (org === null) {
      return { status: "skip" as const, reason: "org_missing" };
    }
    const receipt = await findInboundReceipt(ctx, conversation, args.messageRef);
    if (receipt === null) {
      return { status: "skip" as const, reason: "receipt_missing" };
    }
    const facts = readInboundFacts(receipt);
    const history = await evaluateReplyHistory(ctx, {
      conversation,
      org,
      receipt,
      fromAddress: facts.fromAddress,
      ...(facts.deliveryClass !== undefined
        ? { deliveryClass: facts.deliveryClass }
        : {}),
    });
    if (!history.handle) {
      return { status: "skip" as const, reason: history.blockedBy };
    }
    // THE WHOLE GATE, not only the history half.
    //
    // `replyGate.evaluateReplyAutomation` promises that every later path to
    // model work re-runs it before dispatch, "because a takeover, a close, an
    // org pause or a suppression can land in between, and a stale wake must
    // then spend nothing". Re-running only `evaluateReplyHistory` did not keep
    // that promise: none of those four changes the history verdict, so the
    // paid classification went ahead and only the later DRAFT step refused —
    // after the credit was spent.
    //
    // The tolerated blockers are the ones that DEFINE the mode rather than
    // contradict it: `classify_only` exists precisely because the agent is not
    // sending, or because the ceiling handed the thread to a person a moment
    // ago (PLAN §9.3's "shown, never answered" still shows what the reply
    // was). Everything else — closed, unassigned, org paused, suppressed,
    // opted out, association gone — stops the spend.
    if (args.mode !== "free_only") {
      const gate = await evaluateReplyAnswerGate(
        ctx,
        conversation,
        facts.optOutSignal,
        facts.fromAddress,
      );
      if (!gate.start && !tolerated(args.mode).has(gate.blockedBy)) {
        return { status: "skip" as const, reason: gate.blockedBy };
      }
    }
    const { recipient } = await resolveOutboundRecipient(ctx, conversation);

    const agent =
      conversation.agentId === undefined
        ? null
        : await ctx.db.get("agents", conversation.agentId);
    const operationKey =
      agent === null || agent.orgId !== org._id
        ? undefined
        : await replyOperationKey({
            conversationId: conversation._id,
            messageRef: args.messageRef,
            agentRevision: agent.revision,
          });

    return {
      status: "ready" as const,
      orgId: org._id,
      inboxRef: conversation.inboxRef,
      receiptSignal: facts.optOutSignal,
      outboundRecipient: recipient,
      ...(conversation.providerThreadRef !== undefined
        ? { providerThreadRef: conversation.providerThreadRef }
        : {}),
      ...(facts.fromAddress !== undefined
        ? { fromAddress: facts.fromAddress }
        : {}),
      ...(operationKey !== undefined ? { operationKey } : {}),
      ...(agent === null
        ? {}
        : await brief(ctx, conversation, org, agent)),
    };
  },
});

/** The prompt's facts, or nothing when the company profile is not usable. */
async function brief(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  org: Doc<"orgs">,
  agent: Doc<"agents">,
): Promise<{ brief?: ReplyBrief }> {
  const profile = await getOrgProfile(ctx, org._id);
  if (!profileIsComplete(profile)) {
    return {};
  }
  const lead = await leadOfConversation(ctx, conversation);
  const instructions = agent.instructions ?? org.defaultInstructions;
  return {
    brief: {
      seller: {
        companyName: profile.companyName,
        industry: profile.industry,
        description: profile.description,
        keyFeatures: profile.keyFeatures,
        socialProof: profile.socialProof,
        painPoints: profile.painPoints,
      },
      lead: {
        ...(lead?.firstName !== undefined ? { firstName: lead.firstName } : {}),
        ...(lead?.jobTitle !== undefined ? { jobTitle: lead.jobTitle } : {}),
        ...(lead?.companyName !== undefined
          ? { companyName: lead.companyName }
          : {}),
        ...(lead?.company?.industry !== undefined
          ? { companyIndustry: lead.company.industry }
          : {}),
      },
      goal: agent.goal,
      tone: agent.tone,
      ...(instructions !== undefined && instructions.trim() !== ""
        ? { instructions }
        : {}),
      ...(agent.bookingUrl !== undefined ? { bookingUrl: agent.bookingUrl } : {}),
      previousEmails: await sentMail(ctx, conversation),
    },
  };
}

/** Our accepted sends on this thread, oldest first and bounded. */
async function sentMail(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
): Promise<Array<{ subject: string; body: string }>> {
  const attempts = await ctx.db
    .query("sendAttempts")
    .withIndex("by_conversationId_and_createdAt", (q) =>
      q.eq("conversationId", conversation._id),
    )
    .order("asc")
    .take(THREAD_MESSAGE_MAX * 4);
  const messages: Array<{ subject: string; body: string }> = [];
  for (const attempt of attempts) {
    if (attempt.state !== "acknowledged") {
      continue;
    }
    const draft = await ctx.db.get("drafts", attempt.draftId);
    if (draft !== null) {
      messages.push({ subject: draft.subject, body: draft.body });
    }
  }
  return messages.slice(-THREAD_MESSAGE_MAX);
}

