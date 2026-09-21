/**
 * Org activity feed — architecture §4.2/§5.
 *
 * This domain owns the deduped receipt trail: `recordActivityEvent` is THE
 * write path, and every meaningful step lands here with an org-unique
 * `dedupeKey` so a replayed callback inserts nothing twice. It owns no
 * business rule of its own — callers decide what is worth recording.
 */
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { boundedString, domainError } from "../lib/validators";
import type { ActivityKindBell, ReplyDisposition } from "../lib/validators";
import type { GenericDatabaseWriter } from "convex/server";

/** Minimal writer context shared by mutations that record activity. */
export type WriteCtx = { db: GenericDatabaseWriter<DataModel> };

export type ActivityInput = {
  orgId: Id<"orgs">;
  /** One of the ACTIVITY_KINDS lists (lib/validators/activity.ts); stored as a
   *  bounded string. */
  kind: string;
  summary: string;
  /** identityKey for human actions; "workflow" / "system" otherwise. */
  actor: string;
  dedupeKey: string;
  prospectId?: string;
  conversationId?: string;
};

/**
 * Insert one activity event unless its `dedupeKey` already exists in the
 * org. Returns the existing row on a duplicate so callers can stay
 * idempotent without pre-checking.
 */
export async function recordActivityEvent(
  ctx: WriteCtx,
  event: ActivityInput,
): Promise<Doc<"activityEvents">> {
  const existing = await ctx.db
    .query("activityEvents")
    .withIndex("by_orgId_and_dedupeKey", (q) =>
      q.eq("orgId", event.orgId).eq("dedupeKey", event.dedupeKey),
    )
    .unique();
  if (existing !== null) {
    return existing;
  }
  const id = await ctx.db.insert("activityEvents", {
    orgId: event.orgId,
    kind: boundedString(event.kind, "kind", { min: 1, max: 64 }),
    summary: boundedString(event.summary, "summary", { min: 1, max: 500 }),
    actor: boundedString(event.actor, "actor", { min: 1, max: 300 }),
    dedupeKey: boundedString(event.dedupeKey, "dedupeKey", {
      min: 1,
      max: 200,
    }),
    createdAt: Date.now(),
    ...(event.prospectId !== undefined ? { prospectId: event.prospectId } : {}),
    ...(event.conversationId !== undefined
      ? { conversationId: event.conversationId }
      : {}),
  });
  const row = await ctx.db.get("activityEvents", id);
  if (row === null) {
    throw domainError("NOT_FOUND", "activity event not found after insert");
  }
  return row;
}

/* ------------------------------------------------------------------ */
/* The header bell (PLAN §5)                                           */
/* ------------------------------------------------------------------ */

/**
 * The bell is specified to show four things — a new reply, a meeting booked,
 * a run finished, credits low — and each has exactly ONE writer, below.
 *
 * They are helpers rather than a rule the caller writes out because the
 * dedupe key is the whole correctness story: the domains that produce these
 * facts are all re-driven by sweeps, so the same fact arrives more than once
 * and the key is what makes the second arrival a no-op. Each helper derives
 * the key from the fact itself — the thread and the inbound's arrival, the
 * booking, the run's end, the threshold crossed — so a caller cannot get it
 * wrong, and a caller's own retry is free.
 *
 * `actor` is `workflow` on all four: nobody pressed a button for any of them.
 * Copy stays white-label (PLAN §4) — the user reads what happened, never
 * which company we bought it from.
 */

/** What the bell's own events call themselves in one place. */
function bellEvent(
  kind: ActivityKindBell,
  event: Omit<ActivityInput, "kind" | "actor">,
): ActivityInput {
  return { ...event, kind, actor: "workflow" };
}

/** How a reply reads in the feed. Short by design: the bell never quotes
 *  someone's email, and the disposition is what the product decided. */
const REPLY_SUMMARY: Record<ReplyDisposition, string> = {
  interested: "A lead replied and sounds interested.",
  question: "A lead replied with a question.",
  not_now: "A lead replied — not now, but not a no.",
  not_interested: "A lead replied that they are not interested.",
  unsubscribe: "A lead asked to be removed from the list.",
  automated: "An automatic reply came back on a thread.",
  needs_review: "A reply needs a person to look at it.",
};

/**
 * A reply was read and classified (`inbox/**`).
 *
 * `at` is the INBOUND's arrival, not the clock at classification: it is what
 * `lastDispositionAt` is stamped with, so the reply-redrive sweep handling
 * the same message again produces the same key and inserts nothing.
 */
export async function recordReplyClassified(
  ctx: WriteCtx,
  args: {
    orgId: Id<"orgs">;
    conversationId: Id<"conversations">;
    prospectId?: Id<"prospects">;
    disposition: ReplyDisposition;
    /** The inbound message's arrival, in epoch ms. */
    at: number;
  },
): Promise<void> {
  await recordActivityEvent(
    ctx,
    bellEvent("reply_classified", {
      orgId: args.orgId,
      summary: REPLY_SUMMARY[args.disposition],
      dedupeKey: `reply_classified:${args.conversationId}:${args.at}`,
      conversationId: args.conversationId,
      ...(args.prospectId !== undefined ? { prospectId: args.prospectId } : {}),
    }),
  );
}

/**
 * A proposal became a confirmed meeting (`bookings/**`, PLAN §9.5).
 *
 * Keyed on the booking, so the confirming mutation may be retried and the
 * feed still shows one meeting.
 */
export async function recordMeetingBooked(
  ctx: WriteCtx,
  args: {
    orgId: Id<"orgs">;
    bookingId: Id<"bookings">;
    prospectId: Id<"prospects">;
    /** The agreed start, in epoch ms, and the zone it was agreed in. */
    startsAt: number;
    timezone: string;
  },
): Promise<void> {
  await recordActivityEvent(
    ctx,
    bellEvent("meeting_booked", {
      orgId: args.orgId,
      summary: `Meeting booked for ${new Date(args.startsAt).toISOString()} (${args.timezone}).`,
      dedupeKey: `meeting_booked:${args.bookingId}`,
      prospectId: args.prospectId,
    }),
  );
}

/**
 * An agent run ended (`agents/**`).
 *
 * Keyed on the run's END, which is the same instant written to
 * `agents.lastRunAt`, so the fact and its key come from one value.
 */
export async function recordRunFinished(
  ctx: WriteCtx,
  args: {
    orgId: Id<"orgs">;
    agentId: Id<"agents">;
    /** The instant the run released its lease, in epoch ms. */
    finishedAt: number;
  },
): Promise<void> {
  await recordActivityEvent(
    ctx,
    bellEvent("run_finished", {
      orgId: args.orgId,
      summary: "Your agent finished a run.",
      dedupeKey: `run_finished:${args.agentId}:${args.finishedAt}`,
    }),
  );
}

/**
 * The org's remaining credits crossed a low-water mark (`billing/**`).
 *
 * Keyed on the THRESHOLD, not the balance: the balance moves with every paid
 * call, so keying on it would put a row in the feed for each one. Keyed on
 * the threshold, an org is told once that it has fallen under 50 and once
 * that it has run out — which is what the user needs to know.
 */
export async function recordCreditsLow(
  ctx: WriteCtx,
  args: { orgId: Id<"orgs">; threshold: number; remaining: number },
): Promise<void> {
  await recordActivityEvent(
    ctx,
    bellEvent("credits_low", {
      orgId: args.orgId,
      summary:
        args.remaining === 0
          ? "You are out of credits. Paid steps are paused until more are granted."
          : `Credits are running low — ${args.remaining} left.`,
      dedupeKey: `credits_low:${args.threshold}`,
    }),
  );
}
