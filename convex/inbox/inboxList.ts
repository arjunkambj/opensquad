/**
 * The Inbox screen's list — one query behind the four pills of reference 24
 * (Received / Interested / Unread / All), the count above them and the
 * company search beside them.
 *
 * It is separate from the operator queue, which serves the same rows by
 * lifecycle state (open / unassigned / takeover / closed). This one slices
 * the rows the way the product screen speaks: by what happened on the thread,
 * not by who owns it.
 *
 * EVERY PILL IS ONE RANGE ON `by_orgId_and_lastInboundAt`:
 *
 * - `received` — `lastInboundAt > 0`, newest reply first. A pure range, no
 *   predicate: a thread is "received" exactly when a reply has landed on it.
 * - `interested` — the same range, narrowed by `isInterestedThread`: the
 *   thread's own `lastDisposition`, OR the linked lead standing at
 *   `interested` / `meeting_proposed` / `meeting_booked`. It has to read the
 *   lead, because `applyDisposition` overwrites `lastDisposition` on every
 *   classified inbound — so a thread whose meeting is booked leaves the pill
 *   the moment a later message is classified `question`, which is the exact
 *   opposite of what the pill is for. That is one point read per candidate row
 *   and a page that can come back shorter than its limit; the alternative is a
 *   pill that loses the hottest threads. A stage-derived flag written onto the
 *   conversation row would make it a pure range again (hand-off note).
 * - `unread` — the same range, narrowed to `unreadCount > 0`. The counter is
 *   only ever raised by `applyInboundContext`, so every unread thread has an
 *   inbound message and the range can never hide one.
 * - `all` — the same index at `orgId` alone, which covers every thread
 *   in the org. Ordering is by latest reply, so threads that have not
 *   been replied to yet (a staged first-touch waiting for approval) sort
 *   after the answered ones rather than by their own last send. That is the
 *   honest best the declared indexes allow; the hand-off asks for
 *   `by_orgId_and_lastMessageAt` to order `all` by last activity.
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
import { requireOrgMember } from "../lib/auth";
import { paged } from "../lib/pagination";
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
import type { LeadStage, ReplyDisposition } from "../lib/validators";
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
 * classifier's own word for it, and there is no meeting disposition at all.
 */
const INTERESTED_DISPOSITIONS: readonly ReplyDisposition[] = ["interested"];

/**
 * Lead stages that mean this thread is hot, whatever the last message was
 * classified as.
 *
 * THE DISPOSITION ALONE LOSES THE BEST THREADS. `applyDisposition` overwrites
 * `lastDisposition` on EVERY classified inbound, so a lead who said yes and
 * then asked one logistics question — classified `question` — dropped straight
 * out of this pill, and so did every thread whose meeting is already proposed
 * or booked. The comment that used to sit here claimed a booked meeting
 * reached the pill "through the lead stage"; nothing read the lead stage.
 * Now it does.
 */
const INTERESTED_LEAD_STAGES: ReadonlySet<LeadStage> = new Set<LeadStage>([
  "interested",
  "meeting_proposed",
  "meeting_booked",
]);

/**
 * Is this a thread the Interested pill should hold?
 *
 * The disposition is checked first because it needs no second read; the lead
 * is only loaded for a thread the disposition did not already claim.
 */
async function isInterestedThread(
  ctx: QueryCtx,
  conversation: Doc<"conversations">,
): Promise<boolean> {
  if (
    conversation.lastDisposition !== undefined &&
    INTERESTED_DISPOSITIONS.includes(conversation.lastDisposition)
  ) {
    return true;
  }
  if (conversation.prospectId === undefined) {
    return false;
  }
  const lead = await ctx.db.get("prospects", conversation.prospectId);
  return (
    lead !== null &&
    lead.orgId === conversation.orgId &&
    INTERESTED_LEAD_STAGES.has(lead.stage)
  );
}

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
    draft.orgId !== conversation.orgId ||
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
  // A dangling or cross-org lead renders as "no lead linked" rather
  // than quoting another org's row into this list.
  const lead =
    prospect === null || prospect.orgId !== conversation.orgId
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
  orgId: Id<"orgs">,
  pill: InboxPill,
) {
  const ranged = ctx.db
    .query("conversations")
    .withIndex("by_orgId_and_lastInboundAt", (q) =>
      pill === "all"
        ? q.eq("orgId", orgId)
        : q.eq("orgId", orgId).gt("lastInboundAt", 0),
    )
    .order("desc");
  if (pill === "interested") {
    // No index-level filter: "interested" is a fact of the thread OR of its
    // lead, and an index range cannot join to `prospects`. The range is the
    // superset (every thread with an inbound) and `isInterestedThread` decides
    // each row — which is what the list already does for `awaitingApproval`.
    return ranged;
  }
  if (pill === "unread") {
    // Paginated `.filter` keeps the requested page size after the unread
    // predicate. An extra index on `unreadCount` would rewrite on every
    // inbound and mark-read. Convex documents this as the exception for
    // `.filter` on `.paginate()`.
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
  // `interested` is not decided here: it needs the lead row, so both paths ask
  // `isInterestedThread` instead (the one definition).
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
    orgId: v.id("orgs"),
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
    await requireOrgMember(ctx, args.orgId);
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
          search.search("companyName", text).eq("orgId", args.orgId),
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
            thread.orgId === args.orgId &&
            matchesPill(thread, pill) &&
            (pill !== "interested" || (await isInterestedThread(ctx, thread)))
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

    const page = await pillRange(ctx, args.orgId, pill).paginate({
      numItems: limit,
      cursor: args.cursor ?? null,
    });
    const counted = await pillRange(ctx, args.orgId, pill).take(
      MAX_LIST_LIMIT + 1,
    );
    // The Interested pill is the one slice whose predicate needs the LEAD, so
    // it is applied after the page rather than inside the range. Paging is
    // unaffected — the cursor still walks the underlying range — and both the
    // page and the bounded count go through the same one definition, so the
    // list and the number above it can never disagree.
    const inPill = async (
      conversation: Doc<"conversations">,
    ): Promise<boolean> =>
      pill !== "interested" || (await isInterestedThread(ctx, conversation));
    const items: InboxRow[] = [];
    for (const conversation of page.page) {
      if (await inPill(conversation)) {
        items.push(await toInboxRow(ctx, conversation));
      }
    }
    let countValue = 0;
    for (const conversation of counted) {
      if (await inPill(conversation)) {
        countValue += 1;
      }
    }
    return {
      ...paged(page, items),
      count: {
        value: Math.min(countValue, MAX_LIST_LIMIT),
        hasMore: countValue > MAX_LIST_LIMIT,
        bound: MAX_LIST_LIMIT,
      },
      searched: false,
    };
  },
});
