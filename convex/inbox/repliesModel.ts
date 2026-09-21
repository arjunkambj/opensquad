/**
 * Reply handling — the small typed writes every step of it shares.
 *
 * The steps themselves are `repliesSteps.ts` and `repliesDecide.ts` (the
 * transactions), `repliesContext.ts` (what the model is given) and
 * `repliesRun.ts` (the one paid call between them). What lives here is the
 * vocabulary they must not each invent: how far a message may be taken, the
 * dedupe key a reply is bought and drafted under, how many automatic replies
 * a thread has already had, and the three writes every branch shares — the
 * disposition the Inbox reads, the "Needs you" hold and the note that says
 * why. The lead's own stage is `repliesLead.ts`.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { recordReplyClassified } from "../activity/model";
import { sha256Hex } from "../lib/validators";
import type { ReplyDisposition } from "../lib/validators";
import { recordConversationNote } from "./conversationNotes";
import { v } from "convex/values";

/**
 * The three depths reply handling runs at, decided once by the gates and
 * carried to the step that does the work.
 *
 * - `answer` — every gate open and the thread still under its ceiling: the
 *   reply is classified and, for an answerable class, answered.
 * - `classify_only` — PLAN §9.3's "shown, never answered": a Sourcing-only or
 *   Paused agent, or a thread that has already had its two automatic
 *   replies. The classification is bought and shown; nothing is drafted.
 * - `free_only` — some other gate is closed (takeover, suppression, a lead
 *   taken out of the pipeline). Only the free rules run, so an unsubscribe or
 *   a bounce is still honoured and not one credit is reserved.
 */
export const vReplyHandlingMode = v.union(
  v.literal("answer"),
  v.literal("classify_only"),
  v.literal("free_only"),
);

export type ReplyHandlingMode = typeof vReplyHandlingMode.type;

/**
 * PLAN §9.3: "at most 2 automatic replies per thread, then the thread is
 * handed to the user". The third reply is not queued, not drafted and not
 * paid for — the thread goes to `humanTakeover` with `needs_review`, which is
 * the state the Inbox renders as needing a person.
 */
export const AUTO_REPLY_LIMIT = 2;

/**
 * Prefix of every reply draft's `requestId`, and of the operation key the
 * model call is bought under.
 *
 * It does two jobs, which is why it is one string. `draftRevisions.createRevision`
 * dedupes on `(orgId, requestId)`, so a re-driven step replays the
 * revision it already wrote instead of proposing a second one; and the same
 * prefix is what marks a draft as this flow's, so `automaticReplyCount` can
 * tell an answer the agent sent from a first touch — measured from the sends
 * themselves rather than from a counter that could drift away from them.
 */
export const REPLY_REQUEST_PREFIX = "reply:";

/**
 * The key one classification is bought under: conversation + the inbound
 * message + the agent revision it was answered by.
 *
 * The message ref is what makes a re-driven step replay rather than re-buy,
 * and the revision is what makes a thread answered under new instructions a
 * genuinely new call rather than a free replay of the old one.
 *
 * It is a DIGEST of the message ref, not the ref itself: provider message
 * refs run to 400 characters while an operation key is capped at 150 and a
 * draft's `requestId` at 100. Hashing keeps the key deterministic — the same
 * message under the same revision always lands on the same key, which is the
 * whole point — and always in range.
 */
export async function replyOperationKey(args: {
  conversationId: Id<"conversations">;
  messageRef: string;
  agentRevision: number;
}): Promise<string> {
  const digest = (await sha256Hex(args.messageRef)).slice(0, 16);
  return `${REPLY_REQUEST_PREFIX}${args.conversationId}:${digest}:r${args.agentRevision}`;
}

/**
 * How many of one conversation's send attempts are scanned PER STATE.
 *
 * Per state, not over the whole thread: the states are read through
 * `by_conversationId_and_state`, so a thread whose history is mostly cancelled
 * retries cannot push the live attempts out of the window. A single
 * conversation holding more than this many attempts in ONE live state is not a
 * thread the ceiling can still be reasoned about, and the count saturates
 * safely above the limit either way.
 */
const ATTEMPT_SCAN_MAX = 32;

/**
 * Attempt states that ARE, or are about to be, a reply the recipient sees.
 *
 * Read as an explicit list rather than as "everything except cancelled and
 * definitively_failed", because it is ranged on the state index: the two
 * abandoned states are simply never queried. `reserved` and `requesting` count
 * for the reason the ceiling exists — three inbounds arriving inside one
 * send's lifetime would each see zero replies, and each would buy a model call
 * and send — and `uncertain` counts because it may well have been delivered.
 */
const LIVE_REPLY_STATES: readonly Doc<"sendAttempts">["state"][] = [
  "reserved",
  "requesting",
  "uncertain",
  "acknowledged",
];

/**
 * Automatic replies already MADE — or already under way — on this thread.
 *
 * Counted from the sends, not from the drafts: PLAN §9.3's ceiling is on
 * automatic replies, and a Review-mode draft is not a reply — it is a
 * suggestion sitting in front of a person who may never send it. Counting
 * those handed the thread to the user after two answers nobody had sent.
 *
 * Counted from EVERY live attempt, not only the acknowledged ones, because
 * the ceiling has to hold against the case it exists for: three inbounds
 * arriving inside one send's lifetime would each see a `reserved` or
 * `requesting` attempt as zero replies, and each would buy a model call and
 * send. An attempt in flight is a reply this thread is going to make; only a
 * `cancelled` or `definitively_failed` one is not. The draft behind each
 * attempt is what says whether the reply flow wrote it, because a `reply:`
 * request id is the one thing the first touch and its follow-ups never carry.
 * Deduped by that request id, so the retries of one answer count once.
 *
 * RANGED PER STATE, AND ONE READ PER DRAFT. Reading the newest N attempts of
 * the whole conversation could lose both real answers behind a wall of
 * cancelled retries — the ceiling would then fail to trip on exactly the
 * thread that churned most — so the four live states are ranged directly on
 * `by_conversationId_and_state` and the abandoned ones are never read at all.
 * Drafts are then looked up once EACH rather than once per attempt: retries of
 * one answer share its draft, and this runs inside a mutation where every
 * read is on the critical path.
 */
export async function automaticReplyCount(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
): Promise<number> {
  const draftIds = new Set<Id<"drafts">>();
  for (const state of LIVE_REPLY_STATES) {
    const attempts = await ctx.db
      .query("sendAttempts")
      .withIndex("by_conversationId_and_state", (q) =>
        q.eq("conversationId", conversation._id).eq("state", state),
      )
      .take(ATTEMPT_SCAN_MAX);
    for (const attempt of attempts) {
      draftIds.add(attempt.draftId);
    }
  }
  const keys = new Set<string>();
  for (const draftId of draftIds) {
    const draft = await ctx.db.get("drafts", draftId);
    const requestId = draft?.requestId;
    if (requestId !== undefined && requestId.startsWith(REPLY_REQUEST_PREFIX)) {
      keys.add(requestId);
    }
  }
  return keys.size;
}

/**
 * Stamp what this reply was.
 *
 * `lastDisposition` + `lastDispositionAt` is the ONE fact the Inbox reads for
 * the row chip, the Interested pill and the thread header, and it doubles as
 * this message's "already handled" marker (`evaluateReplyHistory`) — which is
 * why it is stamped for every classified message, including the ones nothing
 * answers. Deliberately not a context bump: a classification invalidates no
 * approval, and bumping here would strand a draft a person approved a second
 * earlier.
 */
export async function applyDisposition(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  disposition: ReplyDisposition,
): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, conversation.lastInboundAt ?? 0);
  await ctx.db.patch("conversations", conversation._id, {
    lastDisposition: disposition,
    // The inbound's own arrival time, not `now`: the marker has to sit at or
    // after `lastInboundAt` for the message it describes, and a clock read
    // taken before a late `applyInboundContext` would sit below it.
    lastDispositionAt: at,
    updatedAt: now,
  });
  // The bell's "new reply" event (PLAN §5). Stamped with the SAME instant as
  // the marker above, so a sweep that re-drives this thread derives the same
  // dedupe key and writes nothing twice.
  await recordReplyClassified(ctx, {
    orgId: conversation.orgId,
    conversationId: conversation._id,
    ...(conversation.prospectId !== undefined
      ? { prospectId: conversation.prospectId }
      : {}),
    disposition,
    at,
  });
}

/**
 * Hand the thread to a person: automation frozen, reason recorded, note
 * written. `conversations.resume` is the only way back, which re-runs every
 * policy check before the agent may speak again.
 *
 * It does NOT advance `contextVersion`: the inbound bump already carried that
 * invalidation, and a second one would strand work an operator legitimately
 * approved in between — the same rule `inboundApply.holdForReview` keeps.
 */
export async function holdForUser(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  note: string,
): Promise<void> {
  const now = Date.now();
  if (!conversation.humanTakeover) {
    await ctx.db.patch("conversations", conversation._id, {
      humanTakeover: true,
      takeoverReason: "needs_review",
      takeoverBy: "system",
      takeoverAt: now,
      updatedAt: now,
    });
  }
  await recordConversationNote(ctx, {
    conversation,
    kind: "system",
    actor: "system",
    body: note,
  });
}

/** A system note on the thread, for a step that changed nothing else. */
export async function noteOnThread(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  body: string,
): Promise<void> {
  await recordConversationNote(ctx, {
    conversation,
    kind: "system",
    actor: "system",
    body,
  });
}

/**
 * Hand this thread's latest inbound message to reply handling.
 *
 * Called from the two places a message becomes answerable: the inbound
 * transaction that stored it, and the resume that re-armed the thread. It
 * schedules rather than runs, so the ingest transaction stays exactly as
 * small as it was and a failure in reply handling can never roll back the
 * receipt that makes the message replayable.
 *
 * Idempotent by the step itself: `evaluateReplyHistory` refuses a message
 * that already carries a disposition, so a second schedule is a no-op rather
 * than a second answer.
 */
export async function scheduleReplyHandling(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
): Promise<boolean> {
  const messageRef = conversation.lastInboundMessageRef;
  if (messageRef === undefined) {
    return false;
  }
  await ctx.scheduler.runAfter(
    0,
    internal.inbox.repliesSteps.handleInboundReply,
    { conversationId: conversation._id, messageRef },
  );
  return true;
}

/**
 * The inbound receipt for one message on one conversation.
 *
 * `(orgId, inboxRef, providerMessageRef)` is the message's identity
 * (`inbox/model.ts`), and the outbound delivery receipts for one of OUR
 * messages share the ref, so the inbound half is selected explicitly.
 */
export async function findInboundReceipt(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  messageRef: string,
): Promise<Doc<"emailEventReceipts"> | null> {
  const rows = await ctx.db
    .query("emailEventReceipts")
    .withIndex("by_org_inbox_providerMessageId", (q) =>
      q
        .eq("orgId", conversation.orgId)
        .eq("inboxRef", conversation.inboxRef)
        .eq("providerMessageRef", messageRef),
    )
    .take(8);
  return (
    rows
      .filter((row) => row.direction === "inbound")
      .sort((left, right) => left._creationTime - right._creationTime)[0] ?? null
  );
}
