/**
 * The reply-automation gate: may the agent answer this thread itself?
 *
 * Read AFTER the inbound message has been applied, so it sees the takeover,
 * opt-out and context changes that message just caused. Every refusal is an
 * explicit block code — the gate never guesses.
 *
 * TWO GATES, and the difference between them is the whole of PLAN §9.4
 * "Never answer history".
 *
 *   `evaluateReplyHistory` — may reply handling TOUCH this message at all?
 *   Live, after the connection, on a thread one of our own accepted sends
 *   started, to a lead we know, from someone who is not us, not already
 *   handled. A refusal here stops even the free rules, because a backfilled
 *   message and a mail in a thread we did not start are readable in the Inbox
 *   and nothing more.
 *
 *   `evaluateReplyAutomation` (+ `evaluateReplyAnswerGate`) — may the agent
 *   SPEAK? Takeover, association, mode, pause, suppression, and the sender
 *   being the person we actually mailed. A refusal here still lets the free
 *   rules run: an org whose agent is paused must still stop mailing
 *   someone who asked it to.
 */
import type { Doc } from "../_generated/dataModel";
import type { AuthCtx } from "../lib/auth";
import { sameInboxRef, SENDING_AGENT_MODES } from "../lib/validators";
import type { OptOutSignal } from "../lib/validators";
import { matchSuppression } from "../outreach/suppressions";
import { resolveOutboundRecipient } from "./conversationsModel";
import type { InboundDeliveryClass } from "./inboundModel";
import { isOwnMailbox } from "./mailboxIdentity";
import { v } from "convex/values";

/**
 * Why automation did not answer this reply. Architecture §8 step 7: "if
 * takeover is active, the conversation is unassigned/closed, or no valid
 * prospect/campaign is linked, retain the reply for human review without a
 * reply workflow, draft or send."
 *
 * Names line up with `SEND_BLOCK_CODES` and `conversationResume.RESUME_BLOCK_CODES`
 * wherever the same gate exists, so the inbox, the resume path and the send
 * preflight speak one vocabulary.
 */
export const REPLY_GATE_BLOCK_CODES = [
  /** The message was written by this organization's own mailbox. */
  "sender_is_us",
  "opt_out_explicit",
  "opt_out_ambiguous",
  "conversation_unassigned",
  "conversation_closed",
  "human_takeover",
  "association_missing",
  "agent_mismatch",
  "agent_not_sending",
  "org_paused",
  "inbox_unassigned",
  "inbox_mismatch",
  "recipient_unknown",
  "sender_unverified",
  "sender_contact_mismatch",
  "suppressed_email",
  "suppressed_domain",
] as const;

export type ReplyGateBlockCode = (typeof REPLY_GATE_BLOCK_CODES)[number];

export const vReplyGateBlockCode = v.union(
  v.literal("sender_is_us"),
  v.literal("opt_out_explicit"),
  v.literal("opt_out_ambiguous"),
  v.literal("conversation_unassigned"),
  v.literal("conversation_closed"),
  v.literal("human_takeover"),
  v.literal("association_missing"),
  v.literal("agent_mismatch"),
  v.literal("agent_not_sending"),
  v.literal("org_paused"),
  v.literal("inbox_unassigned"),
  v.literal("inbox_mismatch"),
  v.literal("recipient_unknown"),
  v.literal("sender_unverified"),
  v.literal("sender_contact_mismatch"),
  v.literal("suppressed_email"),
  v.literal("suppressed_domain"),
);

export const vReplyGateVerdict = v.union(
  v.object({ start: v.literal(true) }),
  v.object({ start: v.literal(false), blockedBy: vReplyGateBlockCode }),
);

export type ReplyGateVerdict = typeof vReplyGateVerdict.type;

/**
 * THE gate every path to model work on an inbound reply passes through.
 *
 * It is a pure read, so it can be re-run — and must be. Ingest runs it here;
 * every later path to model work re-runs it before dispatch, because a
 * takeover, a close, an org pause or a suppression can land in between,
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
  if (prospect === null || prospect.orgId !== conversation.orgId) {
    return blocked("association_missing");
  }
  const agent = await ctx.db.get("agents", conversation.agentId);
  if (agent === null || agent.orgId !== conversation.orgId) {
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
  const org = await ctx.db.get("orgs", conversation.orgId);
  if (org === null || org.automationState !== "active") {
    return blocked("org_paused");
  }
  if (org.inboxRef === undefined) {
    return blocked("inbox_unassigned");
  }
  // A legacy platform inbox is RECEIVE-ONLY (PLAN §9.4 "Legacy inboxes"):
  // its mail is shown in the Inbox and never auto-answered. The same refusal
  // covers a key the provider rejected — an org that cannot send cannot
  // usefully start reply work either.
  if (org.inboxConnection !== "connected") {
    return blocked("inbox_unassigned");
  }
  // Through the ONE helper, like every other inbox-reference comparison:
  // provider inbox ids are addresses and a row whose id differs only in case
  // names the same inbox (`sameInboxRef`).
  if (!sameInboxRef(org.inboxRef, conversation.inboxRef)) {
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
    conversation.orgId,
    recipient,
  );
  if (suppression !== null) {
    return blocked(
      suppression.matchedBy === "domain" ? "suppressed_domain" : "suppressed_email",
    );
  }
  return { start: true };
}

/* ------------------------------------------------------------------ */
/* "Never answer history" (PLAN §9.4)                                   */
/* ------------------------------------------------------------------ */

/**
 * Why reply handling did not even LOOK at this message.
 *
 * - `message_superseded` — a newer inbound has landed; that one drives.
 * - `already_handled` — this message already carries a disposition.
 * - `not_live_source` — a backfilled import. History is read, never answered.
 * - `before_connection` — older than `orgs.connectedAt`, or the
 *   org has no connection time at all.
 * - `thread_not_ours` — no accepted send of ours predates this message on this
 *   thread, or it is not bound to a lead. Someone else's conversation is not
 *   ours to work, and a send made after the message cannot be what it answers.
 * - `sender_is_us` — our own inbox address. An echo is not a reply.
 * - `sender_unverified` — the `From` header did not name exactly one address,
 *   so there is nobody to attribute the message to.
 * - `delivery_unverified` — the provider flagged the delivery itself as spam,
 *   blocked or unauthenticated (`inbox/inboundRoute.ts` ingests those three
 *   variants so they are not lost). They are readable in the Inbox and never
 *   answered: an unauthenticated delivery is exactly the one a forged `From`
 *   arrives on, and the whole answer gate downstream trusts that header.
 */
export const REPLY_HISTORY_BLOCK_CODES = [
  "message_superseded",
  "already_handled",
  "not_live_source",
  "before_connection",
  "thread_not_ours",
  "sender_is_us",
  "sender_unverified",
  "delivery_unverified",
] as const;

export type ReplyHistoryBlockCode = (typeof REPLY_HISTORY_BLOCK_CODES)[number];

export const vReplyHistoryBlockCode = v.union(
  v.literal("message_superseded"),
  v.literal("already_handled"),
  v.literal("not_live_source"),
  v.literal("before_connection"),
  v.literal("thread_not_ours"),
  v.literal("sender_is_us"),
  v.literal("sender_unverified"),
  v.literal("delivery_unverified"),
);

export const vReplyHistoryVerdict = v.union(
  v.object({ handle: v.literal(true) }),
  v.object({ handle: v.literal(false), blockedBy: vReplyHistoryBlockCode }),
);

export type ReplyHistoryVerdict = typeof vReplyHistoryVerdict.type;

/**
 * How many ACKNOWLEDGED send attempts are read looking for one that predates
 * the inbound. The state-bucketed index is what makes the bound safe: revision
 * churn writes `reserved`, `cancelled` and `definitively_failed` rows, and
 * none of them are scanned, so the oldest accepted sends are the first rows
 * back and the question is answered rather than truncated.
 */
const STARTED_BY_US_SCAN_MAX = 8;

/**
 * Did one of OUR sends start this thread, BEFORE this message arrived?
 *
 * `acknowledged` is the only state that means the provider took the message —
 * a reserved, requesting or failed attempt never reached anyone, so it cannot
 * be what a reply is replying to. A conversation the unassigned queue minted
 * from a stranger's mail has no attempts at all, which is exactly the case
 * this refuses.
 *
 * And the send must PREDATE the inbound. Without that, a stranger's mail that
 * landed on an associated thread becomes answerable the moment we send
 * anything on it afterwards — the reply would be validated by a message it
 * could not have been a reply to. Ascending order makes the first row the
 * oldest accepted send, so a page of them answers the question for every
 * message that arrives later.
 */
async function threadStartedByUs(
  ctx: AuthCtx,
  conversation: Doc<"conversations">,
  receivedAt: number,
): Promise<boolean> {
  const attempts = await ctx.db
    .query("sendAttempts")
    .withIndex("by_conversationId_and_state", (q) =>
      q.eq("conversationId", conversation._id).eq("state", "acknowledged"),
    )
    .order("asc")
    .take(STARTED_BY_US_SCAN_MAX);
  return attempts.some(
    (attempt) =>
      attempt.orgId === conversation.orgId && attempt.createdAt <= receivedAt,
  );
}

/**
 * THE history gate. Everything it reads is a fact the application recorded —
 * the receipt's own source and arrival time, our send attempts, the
 * org's connection time — except the sender, which is compared against
 * our own inbox address and can only ever cause a refusal.
 */
export async function evaluateReplyHistory(
  ctx: AuthCtx,
  args: {
    conversation: Doc<"conversations">;
    org: Doc<"orgs">;
    receipt: Doc<"emailEventReceipts">;
    fromAddress: string | undefined;
    /** The provider's flag on this delivery, when it carried one. */
    deliveryClass?: InboundDeliveryClass;
  },
): Promise<ReplyHistoryVerdict> {
  const blocked = (blockedBy: ReplyHistoryBlockCode): ReplyHistoryVerdict => ({
    handle: false,
    blockedBy,
  });
  const { conversation, org, receipt } = args;

  if (conversation.lastInboundMessageRef !== receipt.providerMessageRef) {
    return blocked("message_superseded");
  }
  if (
    conversation.lastDispositionAt !== undefined &&
    conversation.lastInboundAt !== undefined &&
    conversation.lastDispositionAt >= conversation.lastInboundAt
  ) {
    // A disposition is only ever written for the LATEST inbound, so a stamp
    // at or after this message's arrival is that message's own verdict.
    return blocked("already_handled");
  }
  if (receipt.source !== "live") {
    return blocked("not_live_source");
  }
  // A delivery the provider itself would not vouch for. Recorded, shown, and
  // never taken further by automation — the checks below all rest on a `From`
  // header, which is the one thing an unauthenticated delivery does not prove.
  if (args.deliveryClass !== undefined) {
    return blocked("delivery_unverified");
  }
  const connectedAt = org.connectedAt;
  if (connectedAt === undefined || receipt.receivedAt <= connectedAt) {
    return blocked("before_connection");
  }
  if (
    conversation.prospectId === undefined ||
    !(await threadStartedByUs(ctx, conversation, receipt.receivedAt))
  ) {
    return blocked("thread_not_ours");
  }
  if (args.fromAddress === undefined) {
    return blocked("sender_unverified");
  }
  // The org's own mailbox is the one address a reply may never come from.
  // `isOwnMailbox` compares the stored ADDRESS and the stored id, both
  // case-insensitively, so the check holds whether or not the provider's
  // inbox id happens to be the address (`inbox/mailboxIdentity.ts`).
  if (isOwnMailbox(org, args.fromAddress)) {
    return blocked("sender_is_us");
  }
  return { handle: true };
}

/* ------------------------------------------------------------------ */
/* May the agent speak?                                                 */
/* ------------------------------------------------------------------ */

/**
 * The automation gate plus the verified-sender check `conversations.resume`
 * already applies: the agent answers the person it mailed, and nobody else.
 *
 * A colleague on cc, an assistant forwarding the thread or a delivery daemon
 * can all land verified mail on an associated thread. Answering any of them
 * would put our words in front of someone the org never chose to
 * contact, so the address must match either the lead's contact or the
 * address the last revision was authorized against. It can refuse, never
 * grant — the send recipient is always resolved by the application.
 */
export async function evaluateReplyAnswerGate(
  ctx: AuthCtx,
  conversation: Doc<"conversations">,
  optOutSignal: OptOutSignal,
  fromAddress: string | undefined,
): Promise<ReplyGateVerdict> {
  const verdict = await evaluateReplyAutomation(ctx, conversation, optOutSignal);
  if (!verdict.start) {
    return verdict;
  }
  const { recipient, latestDraft } = await resolveOutboundRecipient(
    ctx,
    conversation,
  );
  if (fromAddress === undefined) {
    return { start: false, blockedBy: "sender_unverified" };
  }
  const matches =
    fromAddress === recipient ||
    (latestDraft !== null && fromAddress === latestDraft.normalizedRecipient);
  return matches
    ? { start: true }
    : { start: false, blockedBy: "sender_contact_mismatch" };
}

/**
 * Blockers worth a note on the thread.
 *
 * The rest are already visible without one: an unassigned thread carries its
 * intake note and its takeover reason, a hold wrote its own note as it was
 * placed, and a closed thread is closed. Writing a note for those on every
 * inbound message would bury the ones that say something new under repetition.
 */
export const NOTED_REPLY_GATE_BLOCKS: ReadonlySet<ReplyGateBlockCode> = new Set<
  ReplyGateBlockCode
>([
  "association_missing",
  "agent_mismatch",
  "agent_not_sending",
  "org_paused",
  "inbox_unassigned",
  "inbox_mismatch",
  "recipient_unknown",
  "sender_unverified",
  "sender_contact_mismatch",
  "suppressed_email",
  "suppressed_domain",
]);
