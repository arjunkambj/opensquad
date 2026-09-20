/**
 * What the dashboard reads out of `sendAttempts`, `conversations` and
 * `bookings` — the half of the funnel that happens after a lead is found.
 *
 * Each loader states exactly which rows it counts, because the Inbox and the
 * agent's own funnel have to agree with these numbers over the same window.
 * `model.ts` holds the bounds and the rules they follow.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { ConversationState } from "../lib/validators";
import {
  DASHBOARD_SCAN_BOUND,
  filled,
  type Bounded,
  type Range,
} from "./model";

/**
 * Sends the provider ACCEPTED inside the window — `sendAttempts` in state
 * `acknowledged` with `updatedAt` in range, an exact range on
 * `by_workspaceId_and_state_and_updatedAt`.
 *
 * `acknowledged` means accepted, never delivered (PLAN §4.3), and `updatedAt`
 * on such a row is when it was accepted. A follow-up is its own attempt, so
 * the attempt count is emails and the distinct conversation count is people:
 * both are returned, and the stat card shows the second with the first
 * underneath it.
 */
export async function loadAcknowledgedSends(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  range: Range,
): Promise<{
  rows: Doc<"sendAttempts">[];
  emails: Bounded;
  contacted: Bounded;
}> {
  const page = await ctx.db
    .query("sendAttempts")
    .withIndex("by_workspaceId_and_state_and_updatedAt", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("state", "acknowledged")
        .gte("updatedAt", range.from)
        .lte("updatedAt", range.to),
    )
    .take(DASHBOARD_SCAN_BOUND + 1);
  const rows = page.slice(0, DASHBOARD_SCAN_BOUND);
  const conversations = new Set(rows.map((row) => row.conversationId));
  const hasMore = page.length > DASHBOARD_SCAN_BOUND;
  return {
    rows,
    emails: filled(page, DASHBOARD_SCAN_BOUND),
    contacted: { count: conversations.size, hasMore },
  };
}

/**
 * Every conversation state, as a total map over the union: a state added to
 * `vConversationState` fails this build until it is listed, which is what
 * stops the partition below quietly losing a bucket of threads.
 */
const STATE_PARTITION = {
  open: true,
  closed: true,
  unassigned: true,
} satisfies Record<ConversationState, true>;

const CONVERSATION_STATES = Object.keys(STATE_PARTITION) as ConversationState[];

/**
 * Threads a real reply landed in during the window — `conversations` whose
 * `lastInboundAt` is in range, newest reply first. These are exactly the rows
 * the Inbox lists as having been replied to.
 *
 * `conversations` has no `lastInboundAt` index, so this walks the three
 * `by_workspaceId_and_state_and_lastMessageAt` ranges from `from` forward.
 * That is sound rather than convenient: `lastMessageAt` is bumped by every
 * message, inbound included, so `lastMessageAt >= lastInboundAt` always and
 * no thread whose reply is in the window can sort below `from`. There is no
 * upper bound on the scan for the same reason — a thread we answered after
 * the window still had its reply inside it.
 *
 * The integrator should add `conversations.by_workspaceId_and_lastInboundAt`;
 * this becomes one exact range.
 */
export async function loadRepliedConversations(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  range: Range,
): Promise<{ rows: Doc<"conversations">[]; bounded: Bounded }> {
  const rows: Doc<"conversations">[] = [];
  let hasMore = false;
  for (const state of CONVERSATION_STATES) {
    const page = await ctx.db
      .query("conversations")
      .withIndex("by_workspaceId_and_state_and_lastMessageAt", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .eq("state", state)
          .gte("lastMessageAt", range.from),
      )
      .order("desc")
      .take(DASHBOARD_SCAN_BOUND + 1);
    hasMore = hasMore || page.length > DASHBOARD_SCAN_BOUND;
    for (const row of page) {
      const at = row.lastInboundAt;
      if (at !== undefined && at >= range.from && at <= range.to) {
        rows.push(row);
      }
    }
  }
  rows.sort((a, b) => (b.lastInboundAt ?? 0) - (a.lastInboundAt ?? 0));
  return {
    rows,
    bounded: { count: Math.min(rows.length, DASHBOARD_SCAN_BOUND), hasMore },
  };
}

/* ------------------------------------------------------------------ */
/* Meetings                                                            */
/* ------------------------------------------------------------------ */

/**
 * Meetings, counted the way PLAN §9.5 defines them: CONFIRMED bookings only,
 * whose meeting time falls inside the window. A confirmed booking always
 * carries `startsAt`, so this is an exact range on
 * `by_workspaceId_and_state_and_startsAt`.
 *
 * A booking link in an email and a model reading agreement out of a reply are
 * both proposals — they are counted separately, below, and never here.
 */
export async function countConfirmedMeetings(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  range: Range,
): Promise<Bounded> {
  const page = await ctx.db
    .query("bookings")
    .withIndex("by_workspaceId_and_state_and_startsAt", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("state", "confirmed")
        .gte("startsAt", range.from)
        .lte("startsAt", range.to),
    )
    .take(DASHBOARD_SCAN_BOUND + 1);
  return filled(page, DASHBOARD_SCAN_BOUND);
}

/**
 * Proposals still open, right now. Not window-scoped: a proposal has no
 * agreed time to place it in a window — that is the whole difference between
 * it and a meeting — so this is the live count of `proposed` bookings.
 */
export async function countProposedMeetings(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
): Promise<Bounded> {
  const page = await ctx.db
    .query("bookings")
    .withIndex("by_workspaceId_and_state_and_startsAt", (q) =>
      q.eq("workspaceId", workspaceId).eq("state", "proposed"),
    )
    .take(DASHBOARD_SCAN_BOUND + 1);
  return filled(page, DASHBOARD_SCAN_BOUND);
}
