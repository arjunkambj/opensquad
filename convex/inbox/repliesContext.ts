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
import { getWorkspaceProfile, profileIsComplete } from "../company/model";
import { vAgentGoal, vAgentTone, vOptOutSignal } from "../lib/validators";
import { v } from "convex/values";
import { resolveOutboundRecipient } from "./conversationsModel";
import { readInboundFacts } from "./inboundModel";
import { leadOfConversation } from "./repliesLead";
import { findInboundReceipt, replyOperationKey } from "./repliesModel";
import { evaluateReplyHistory } from "./replyGate";

/** Our own sent mail carried into the prompt, oldest first. */
const THREAD_MESSAGE_MAX = 6;

const vReplyContext = v.union(
  v.object({ status: v.literal("skip"), reason: v.string() }),
  v.object({
    status: v.literal("ready"),
    workspaceId: v.id("workspaces"),
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
  },
  returns: vReplyContext,
  handler: async (ctx, args): Promise<ReplyContext> => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      return { status: "skip" as const, reason: "conversation_missing" };
    }
    const workspace = await ctx.db.get("workspaces", conversation.workspaceId);
    if (workspace === null) {
      return { status: "skip" as const, reason: "workspace_missing" };
    }
    const receipt = await findInboundReceipt(ctx, conversation, args.messageRef);
    if (receipt === null) {
      return { status: "skip" as const, reason: "receipt_missing" };
    }
    const facts = readInboundFacts(receipt);
    const history = await evaluateReplyHistory(ctx, {
      conversation,
      workspace,
      receipt,
      fromAddress: facts.fromAddress,
    });
    if (!history.handle) {
      return { status: "skip" as const, reason: history.blockedBy };
    }
    const { recipient } = await resolveOutboundRecipient(ctx, conversation);

    const agent =
      conversation.agentId === undefined
        ? null
        : await ctx.db.get("agents", conversation.agentId);
    const operationKey =
      agent === null || agent.workspaceId !== workspace._id
        ? undefined
        : await replyOperationKey({
            conversationId: conversation._id,
            messageRef: args.messageRef,
            agentRevision: agent.revision,
          });

    return {
      status: "ready" as const,
      workspaceId: workspace._id,
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
        : await brief(ctx, conversation, workspace, agent)),
    };
  },
});

/** The prompt's facts, or nothing when the company profile is not usable. */
async function brief(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  workspace: Doc<"workspaces">,
  agent: Doc<"agents">,
): Promise<{ brief?: ReplyBrief }> {
  const profile = await getWorkspaceProfile(ctx, workspace._id);
  if (!profileIsComplete(profile)) {
    return {};
  }
  const lead = await leadOfConversation(ctx, conversation);
  const instructions = agent.instructions ?? workspace.defaultInstructions;
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

