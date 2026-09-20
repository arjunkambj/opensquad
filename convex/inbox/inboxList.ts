/**
 * The Inbox screen's list — one query behind the four pills of reference 24
 * (Received / Interested / Unread / All), the count above them and the
 * company search beside them.
 *
 * It is separate from `inbox/conversations.list`, which serves the operator
 * queue by lifecycle state (open / unassigned / takeover / closed). This one
 * slices the same rows the way the product screen speaks: by what happened on
 * the thread, not by who owns it.
 *
 * EVERY PILL IS ONE RANGE ON `by_workspaceId_and_lastInboundAt`:
 *
 * - `received` — `lastInboundAt > 0`, newest reply first. A pure range, no
 *   predicate: a thread is "received" exactly when a reply has landed on it.
 * - `interested` — the same range, narrowed to `lastDisposition` values that
 *   mean interest. THE FILTER READS THE CONVERSATION ROW, not the lead's
 *   stage: `conversations.lastDisposition` is the only interest fact stored
 *   on the row itself, and joining `prospects.stage` would mean a point read
 *   per candidate and a post-filtered page. See the hand-off note — when the
 *   reply half starts writing a stage-derived flag onto the conversation, the
 *   predicate below is the one place that changes.
 * - `unread` — the same range, narrowed to `unreadCount > 0`. The counter is
 *   only ever raised by `applyInboundContext`, so every unread thread has an
 *   inbound message and the range can never hide one.
 * - `all` — the same index at `workspaceId` alone, which covers every thread
 *   in the workspace. Ordering is by latest reply, so threads that have not
 *   been replied to yet (a staged first-touch waiting for approval) sort
 *   after the answered ones rather than by their own last send. That is the
 *   honest best the declared indexes allow; the hand-off asks for
 *   `by_workspaceId_and_lastMessageAt` to order `all` by last activity.
 *
 * SEARCH is bounded and index-backed, and it is deliberately narrow: the only
 * search index that reaches a conversation is `prospects.search_company_name`,
 * so search matches the COMPANY NAME of the lead a thread is linked to.
 * Message bodies, subjects, people's names and sender addresses are NOT
 * searchable — none of them is indexed, and scanning for them is exactly what
 * §5 forbids. A search result is one bounded set, not a paged one.
 *
 * No provider identifier is projected: `inboxRef`, `providerThreadRef` and
 * `lastInboundMessageRef` stay server-side.
 */
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { requireWorkspaceMember } from "../lib/auth";
import {
  boundedLimit,
  boundedString,
  MAX_LIST_LIMIT,
  PROSPECT_COMPANY_NAME_MAX_LENGTH,
  vConversationState,
  vLeadStage,
  vMessageSource,
  vReplyDisposition,
} from "../lib/validators";
import type { ReplyDisposition } from "../lib/validators";
import { v } from "convex/values";

/** The four slices of reference 24, in the order the screen renders them. */
export const INBOX_PILLS = [
  "received",
  "interested",
  "unread",
  "all",
] as const;

export const vInboxPill = v.union(
  v.literal("received"),
  v.literal("interested"),
  v.literal("unread"),
  v.literal("all"),
);

export type InboxPill = (typeof INBOX_PILLS)[number];

/**
 * Dispositions that mean the lead showed interest. `interested` is the
 * classifier's own word for it; there is no meeting disposition, so a booked
 * meeting reaches this pill through the lead stage, not through here.
 */
const INTERESTED_DISPOSITIONS: readonly ReplyDisposition[] = ["interested"];

/** How many company matches a search reads before it stops. */
const SEARCH_LEAD_BOUND = 25;

/** How many threads per matched lead a search reads. */
const SEARCH_THREADS_PER_LEAD = 5;

/** How many recorded verdicts one draft revision can carry before we stop. */
const APPROVAL_PROBE_LIMIT = 10;

/** The lead behind a row — the name and company the list actually renders. */
const vInboxLeadRef = v.object({
  prospectId: v.id("prospects"),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  companyName: v.optional(v.string()),
  stage: vLeadStage,
});

/**
 * One conversation row. `awaitingApproval` is the marker Review mode is built
 * around: a current draft with no recorded verdict for its revision is an
 * email waiting for the user's yes — including a first-touch thread that has
 * never been sent and therefore carries no inbound message at all.
 */
export const vInboxRow = v.object({
  conversationId: v.id("conversations"),
  state: vConversationState,
  source: vMessageSource,
  humanTakeover: v.boolean(),
  contextVersion: v.number(),
  unreadCount: v.number(),
  lastMessageAt: v.optional(v.number()),
  lastInboundAt: v.optional(v.number()),
  lastInboundFrom: v.optional(v.string()),
  lastDisposition: v.optional(vReplyDisposition),
  currentDraftId: v.optional(v.id("drafts")),
  awaitingApproval: v.boolean(),
  lead: v.union(vInboxLeadRef, v.null()),
});

export type InboxRow = typeof vInboxRow.type;

/** Does this thread hold a draft nobody has ruled on yet? */
async function isAwaitingApproval(
  ctx: QueryCtx,
  conversation: Doc<"conversations">,
): Promise<boolean> {
  if (conversation.currentDraftId === undefined) {
    return false;
  }
  const draft = await ctx.db.get("drafts", conversation.currentDraftId);
  if (
    draft === null ||
    draft.workspaceId !== conversation.workspaceId ||
    draft.state !== "current"
  ) {
    return false;
  }
  const verdicts = await ctx.db
    .query("approvals")
    .withIndex("by_draftId", (q) => q.eq("draftId", draft._id))
    .take(APPROVAL_PROBE_LIMIT);
  return !verdicts.some((verdict) => verdict.draftRevision === draft.revision);
}

/** Project one conversation to a row, resolving its lead and draft state. */
async function toInboxRow(
  ctx: QueryCtx,
  conversation: Doc<"conversations">,
): Promise<InboxRow> {
  const prospect =
    conversation.prospectId === undefined
      ? null
      : await ctx.db.get("prospects", conversation.prospectId);
  // A dangling or cross-workspace lead renders as "no lead linked" rather
  // than quoting another workspace's row into this list.
  const lead =
    prospect === null || prospect.workspaceId !== conversation.workspaceId
      ? null
      : {
          prospectId: prospect._id,
          ...(prospect.firstName === undefined
            ? {}
            : { firstName: prospect.firstName }),
          ...(prospect.lastName === undefined
            ? {}
            : { lastName: prospect.lastName }),
          ...(prospect.companyName === undefined
            ? {}
            : { companyName: prospect.companyName }),
          stage: prospect.stage,
        };
  return {
    conversationId: conversation._id,
    state: conversation.state,
    source: conversation.source,
    humanTakeover: conversation.humanTakeover,
    contextVersion: conversation.contextVersion,
    unreadCount: conversation.unreadCount,
    ...(conversation.lastMessageAt === undefined
      ? {}
      : { lastMessageAt: conversation.lastMessageAt }),
    ...(conversation.lastInboundAt === undefined
      ? {}
      : { lastInboundAt: conversation.lastInboundAt }),
    ...(conversation.lastInboundFrom === undefined
      ? {}
      : { lastInboundFrom: conversation.lastInboundFrom }),
    ...(conversation.lastDisposition === undefined
      ? {}
      : { lastDisposition: conversation.lastDisposition }),
    ...(conversation.currentDraftId === undefined
      ? {}
      : { currentDraftId: conversation.currentDraftId }),
    awaitingApproval: await isAwaitingApproval(ctx, conversation),
    lead,
  };
}

/** The pill's range, ordered newest reply first. */
function pillRange(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  pill: InboxPill,
) {
  const ranged = ctx.db
    .query("conversations")
    .withIndex("by_workspaceId_and_lastInboundAt", (q) =>
      pill === "all"
        ? q.eq("workspaceId", workspaceId)
        : q.eq("workspaceId", workspaceId).gt("lastInboundAt", 0),
    )
    .order("desc");
  if (pill === "interested") {
    return ranged.filter((q) =>
      q.or(
        ...INTERESTED_DISPOSITIONS.map((disposition) =>
          q.eq(q.field("lastDisposition"), disposition),
        ),
      ),
    );
  }
  if (pill === "unread") {
    return ranged.filter((q) => q.gt(q.field("unreadCount"), 0));
  }
  return ranged;
}

/** The same predicate, for the search path, which cannot use a range. */
function matchesPill(
  conversation: Doc<"conversations">,
  pill: InboxPill,
): boolean {
  if (pill === "all") {
    return true;
  }
  if (conversation.lastInboundAt === undefined) {
    return false;
  }
  if (pill === "unread") {
    return conversation.unreadCount > 0;
  }
  if (pill === "interested") {
    return (
      conversation.lastDisposition !== undefined &&
      INTERESTED_DISPOSITIONS.includes(conversation.lastDisposition)
    );
  }
  return true;
}

/** Newest activity first — the order both paths present rows in. */
function recencyOf(conversation: Doc<"conversations">): number {
  return (
    conversation.lastInboundAt ??
    conversation.lastMessageAt ??
    conversation.createdAt
  );
}

/**
 * One page of the Inbox list, plus the bounded count the header renders.
 *
 * The count is capped at `MAX_LIST_LIMIT` and paired with `hasMore` so the
 * header can say "50+" — §5 forbids an exact unlimited counter. `searched`
 * tells the screen it is looking at a bounded search result rather than a
 * page, so it can say so instead of offering a next page that does not exist.
 */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    pill: v.optional(vInboxPill),
    /** Company-name search; empty text is the ordinary list. */
    q: v.optional(v.string()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vInboxRow),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
    count: v.object({
      value: v.number(),
      hasMore: v.boolean(),
      bound: v.number(),
    }),
    searched: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const pill = args.pill ?? "received";
    const limit = boundedLimit(args.limit);
    const text =
      args.q === undefined
        ? ""
        : boundedString(args.q, "q", {
            max: PROSPECT_COMPANY_NAME_MAX_LENGTH,
          }).trim();

    if (text !== "") {
      const matches = await ctx.db
        .query("prospects")
        .withSearchIndex("search_company_name", (search) =>
          search.search("companyName", text).eq("workspaceId", args.workspaceId),
        )
        .take(SEARCH_LEAD_BOUND);
      const found: Doc<"conversations">[] = [];
      for (const prospect of matches) {
        const threads = await ctx.db
          .query("conversations")
          .withIndex("by_prospectId", (q) => q.eq("prospectId", prospect._id))
          .take(SEARCH_THREADS_PER_LEAD);
        for (const thread of threads) {
          if (
            thread.workspaceId === args.workspaceId &&
            matchesPill(thread, pill)
          ) {
            found.push(thread);
          }
        }
      }
      found.sort((a, b) => recencyOf(b) - recencyOf(a));
      const items: InboxRow[] = [];
      for (const conversation of found.slice(0, limit)) {
        items.push(await toInboxRow(ctx, conversation));
      }
      return {
        items,
        // A search reads two indexes that cannot share one opaque cursor, so
        // it returns a bounded set and says so rather than faking paging.
        cursor: null,
        hasMore: found.length > limit,
        count: {
          value: Math.min(found.length, MAX_LIST_LIMIT),
          hasMore: found.length > MAX_LIST_LIMIT,
          bound: MAX_LIST_LIMIT,
        },
        searched: true,
      };
    }

    const page = await pillRange(ctx, args.workspaceId, pill).paginate({
      numItems: limit,
      cursor: args.cursor ?? null,
    });
    const counted = await pillRange(ctx, args.workspaceId, pill).take(
      MAX_LIST_LIMIT + 1,
    );
    const items: InboxRow[] = [];
    for (const conversation of page.page) {
      items.push(await toInboxRow(ctx, conversation));
    }
    return {
      items,
      cursor: page.isDone ? null : page.continueCursor,
      hasMore: !page.isDone,
      count: {
        value: Math.min(counted.length, MAX_LIST_LIMIT),
        hasMore: counted.length > MAX_LIST_LIMIT,
        bound: MAX_LIST_LIMIT,
      },
      searched: false,
    };
  },
});
