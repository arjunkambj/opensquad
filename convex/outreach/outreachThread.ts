/**
 * The reads one outreach write needs about a THREAD: which conversation the
 * mail belongs on, what that thread has actually sent, and the personalisation
 * hooks a message may lean on.
 *
 * Kept apart from the claim so the claim reads as the decision it makes and
 * this reads as the facts it makes it from. Nothing here writes, except the
 * one staging call that creates or binds the conversation an outbound thread
 * needs before a draft can exist.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { CONVERSATION_SCAN_MAX } from "./outreachLeadState";

/** Earlier mails of a thread one follow-up prompt may carry. */
const THREAD_MESSAGE_MAX = 4;

/** Hooks a draft cites. The same ceiling research applies to its evidence. */
const HOOK_MAX = 3;

/** The topic `leads/researchState.ts` files a personalisation hook under; the
 *  stored observation is `"<topic>: <hook>"` and the prompt wants the hook. */
const HOOK_OBSERVATION_TOPIC = "Personalisation hook: ";

export type SentThread = {
  messages: { subject: string; body: string }[];
  subject?: string;
  lastMessageRef?: string;
};

/**
 * The thread this lead's mail belongs on: the one already open on the
 * workspace's inbox, or — for a first touch — a new one staged with the agent
 * frozen on it, so the send gates can fence the mode and the revision.
 *
 * A thread under human takeover or closed is never reused and never replaced:
 * a person owns it, and the send gates would refuse anything written for it.
 */
export async function resolveConversation(
  ctx: MutationCtx,
  args: {
    workspace: Doc<"workspaces">;
    agent: Doc<"agents">;
    lead: Doc<"prospects">;
    inboxRef: string;
    step: number;
  },
): Promise<Doc<"conversations"> | null> {
  const existing = await ctx.db
    .query("conversations")
    .withIndex("by_prospectId", (q) => q.eq("prospectId", args.lead._id))
    .take(CONVERSATION_SCAN_MAX);
  const usable = existing
    .filter(
      (conversation) =>
        conversation.workspaceId === args.workspace._id &&
        conversation.inboxRef === args.inboxRef &&
        conversation.state === "open" &&
        !conversation.humanTakeover,
    )
    .sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt));
  const open = usable[0];
  if (open !== undefined) {
    // The thread is frozen to the agent it was associated with, so a lead
    // re-pointed at another agent never silently retargets in-flight work.
    if (open.agentId !== undefined) {
      return open.agentId === args.agent._id ? open : null;
    }
    // An older thread with no agent on it would leave `evaluateSendGates`
    // with nothing to fence the mode and the revision against, and would give
    // the draft `agentRevision: 0`. Bind it before anything is written.
    return await ctx.runMutation(
      internal.outreach.conversationStaging.stageConversation,
      {
        conversationId: open._id,
        workspaceId: args.workspace._id,
        inboxRef: open.inboxRef,
        prospectId: args.lead._id,
        agentId: args.agent._id,
      },
    );
  }
  if (args.step > 0 || existing.length >= CONVERSATION_SCAN_MAX) {
    // A follow-up needs the thread its first mail went out on, and a lead
    // already holding a page of threads is not given another.
    return null;
  }
  return await ctx.runMutation(
    internal.outreach.conversationStaging.stageConversation,
    {
      workspaceId: args.workspace._id,
      inboxRef: args.inboxRef,
      prospectId: args.lead._id,
      agentId: args.agent._id,
      source: "live",
      state: "open",
    },
  );
}

/**
 * What this thread has actually SENT, oldest first — the only mail a
 * follow-up may refer to.
 *
 * Read from acknowledged send attempts rather than from the draft history: a
 * draft is a proposal, and a superseded or never-approved one was never seen
 * by the recipient. The last acknowledged message is also what a follow-up
 * threads onto, so the provider keeps it in one conversation.
 */
export async function sentThread(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
): Promise<SentThread> {
  const attempts = await ctx.db
    .query("sendAttempts")
    .withIndex("by_conversationId_and_createdAt", (q) =>
      q.eq("conversationId", conversation._id),
    )
    .order("asc")
    .take(THREAD_MESSAGE_MAX * 4);
  const messages: { subject: string; body: string }[] = [];
  let lastMessageRef: string | undefined;
  for (const attempt of attempts) {
    if (attempt.state !== "acknowledged") {
      continue;
    }
    const draft = await ctx.db.get("drafts", attempt.draftId);
    if (draft === null) {
      continue;
    }
    messages.push({ subject: draft.subject, body: draft.body });
    if (attempt.providerMessageRef !== undefined) {
      lastMessageRef = attempt.providerMessageRef;
    }
  }
  const trimmed = messages.slice(-THREAD_MESSAGE_MAX);
  return {
    messages: trimmed,
    ...(messages[0] !== undefined ? { subject: messages[0].subject } : {}),
    ...(lastMessageRef !== undefined ? { lastMessageRef } : {}),
  };
}

/**
 * The lead's personalisation hooks and the evidence rows they came from.
 *
 * Hooks are only ever the observations research stored from a page we
 * actually read (`leads/researchState.ts`), so a hook in a mail can always be
 * traced to a source — the draft cites the row ids it used.
 */
export async function personalisationHooks(
  ctx: MutationCtx,
  lead: Doc<"prospects">,
): Promise<{ observations: string[]; evidenceIds: string[] }> {
  const rows = await ctx.db
    .query("evidence")
    .withIndex("by_prospectId_and_createdAt", (q) =>
      q.eq("prospectId", lead._id),
    )
    .order("desc")
    .take(HOOK_MAX);
  return {
    observations: rows.map((row) =>
      row.observation.startsWith(HOOK_OBSERVATION_TOPIC)
        ? row.observation.slice(HOOK_OBSERVATION_TOPIC.length)
        : row.observation,
    ),
    evidenceIds: rows.map((row) => String(row._id)),
  };
}
