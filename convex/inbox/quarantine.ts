/**
 * Quarantine for verified provider events no org can claim (P11 —
 * `plan/integrations.md` §G3 "Unknown inboxes are quarantined",
 * architecture §4.3 and §8 step 2).
 *
 * WHY A DROP IS NOT AN OPTION HERE. `resolveOrgByInbox` refuses to guess
 * an org: §8 step 2 resolves one from the saved inbox assignment alone,
 * so zero claims and two claims both return `null`. What happened next was a
 * `console.info` and nothing else — and that loses the mail permanently. By
 * the time a callback runs, the component has already committed its `events`
 * row and marked the `event_id` ingested, so the provider's retry returns from
 * `handleEvent` before enqueueing anything; `@convex-dev/workpool` does not
 * retry mutations; and `receiptDrain.drainPendingInboundReceipts` scans
 * `emailEventReceipts`, which in this case has no row to scan. A customer's
 * reply vanished with one log line and no artefact anyone could replay.
 *
 * Both causes are ordinary and resolvable, not corruption: the AgentMail inbox
 * is provisioned before `conversationStaging.assignOrgInbox` commits, so there is a
 * real window during onboarding and during any re-provision; and two
 * orgs can transiently claim one `inboxRef` because that uniqueness is a
 * transactional convention, not a database constraint.
 *
 * WHAT IS STORED, AND WHAT IS NOT. Provider identifiers only — the same rule
 * the receipt table and the log lines follow. The message itself stays where
 * it already is, in the component's own `inboundMessages` row, which is what
 * makes a replay possible without this table becoming the second message
 * store §4.3 forbids. The bounded projection a receipt carries (`fromAddress`,
 * the opt-out verdict) is NOT carried across either: it is recomputed from the
 * component row at replay by the same two functions the callback uses, so a
 * replayed message is judged by today's rules rather than by a snapshot of the
 * rules in force when it was dropped.
 *
 * HOW IT GETS OUT. `conversationStaging.assignOrgInbox` schedules `replayForInbox`
 * for the inbox it just assigned, so the onboarding window closes itself.
 * An operator can also drive it by hand for an inbox whose ambiguity they have
 * resolved. Replay goes through `sendReceipts.recordReceipt` and the ordinary
 * `internal.inbox.inbound.applyInboundMessage` path — this module has no second
 * ingest of its own — so the application-key dedupe, the ordering guard and
 * every gate apply to a replayed message exactly as they would have at the
 * time.
 */
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { components, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  directionForApplicationKey,
  evaluateOptOutText,
  parseInboundSender,
  PROVIDER_REF_MAX_LENGTH,
  vQuarantineReason,
} from "../lib/validators";
import type { QuarantineReason } from "../lib/validators";
import { recordReceipt } from "../outreach/sendReceipts";
import { upsertMessage } from "./model";

/** Longest application key `recordReceipt` accepts. */
const APPLICATION_KEY_MAX_LENGTH = 500;
/** Longest note this module writes on a row. */
const QUARANTINE_NOTE_MAX_LENGTH = 300;
/** Rows a single replay run examines. */
const QUARANTINE_REPLAY_LIMIT = 25;
/**
 * How long an inbound event whose message the component can no longer produce
 * stays replayable before it is written off. Without this a row that can never
 * be replayed would occupy the replay window on every run — the same
 * starvation the receipt drain's index range exists to prevent.
 */
const QUARANTINE_UNREADABLE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Trim to a bound WITHOUT throwing. Every caller of `recordQuarantinedEvent`
 * is on the non-retried callback path, where a throw costs the event — which
 * is the exact failure this module exists to prevent, so it may not introduce
 * one of its own.
 */
function clipRef(value: string, max: number = PROVIDER_REF_MAX_LENGTH): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Hold one verified event that could not be attributed to an org.
 *
 * Deduped on `providerEventId` with `.first()` rather than `.unique()`: a
 * second row for one event is an anomaly worth surviving, not worth throwing
 * on. Returns quietly on anything it cannot record, for the same reason.
 */
export async function recordQuarantinedEvent(
  ctx: MutationCtx,
  args: {
    inboxRef: string;
    providerEventId: string;
    applicationKey: string;
    providerMessageRef: string;
    providerThreadRef?: string;
    eventType: string;
    reason: QuarantineReason;
    providerTimestamp?: number;
    /** A bounded application note — never provider text. */
    note?: string;
  },
): Promise<void> {
  const providerEventId = clipRef(args.providerEventId, 200);
  const providerMessageRef = clipRef(args.providerMessageRef);
  const applicationKey = clipRef(args.applicationKey, APPLICATION_KEY_MAX_LENGTH);
  const inboxRef = clipRef(args.inboxRef);
  const eventType = clipRef(args.eventType, 100);
  if (
    providerEventId.length === 0 ||
    providerMessageRef.length === 0 ||
    applicationKey.length === 0 ||
    inboxRef.length === 0 ||
    eventType.length === 0
  ) {
    return;
  }
  const existing = await ctx.db
    .query("quarantinedEmailEvents")
    .withIndex("by_providerEventId", (q) =>
      q.eq("providerEventId", providerEventId),
    )
    .first();
  if (existing !== null) {
    return;
  }
  const providerThreadRef =
    args.providerThreadRef === undefined
      ? undefined
      : clipRef(args.providerThreadRef);
  await ctx.db.insert("quarantinedEmailEvents", {
    inboxRef,
    providerEventId,
    applicationKey,
    providerMessageRef,
    eventType,
    reason: args.reason,
    receivedAt: Date.now(),
    state: "quarantined",
    ...(providerThreadRef !== undefined && providerThreadRef.length > 0
      ? { providerThreadRef }
      : {}),
    ...(args.providerTimestamp !== undefined
      ? { providerTimestamp: args.providerTimestamp }
      : {}),
    ...(args.note !== undefined
      ? { note: clipRef(args.note, QUARANTINE_NOTE_MAX_LENGTH) }
      : {}),
  });
}

const vReplayResult = v.object({
  released: v.number(),
  held: v.number(),
  discarded: v.number(),
  /** Set when the inbox STILL cannot be attributed — nothing was replayed. */
  blockedBy: v.optional(vQuarantineReason),
});

export type QuarantineReplayResult = typeof vReplayResult.type;

/**
 * Replay everything held for one inbox, now that it has exactly one claimant.
 *
 * Scheduled by `conversationStaging.assignOrgInbox` the moment an assignment commits,
 * and callable by hand once an operator has resolved a double claim. It
 * re-resolves the org itself rather than trusting a caller's — the
 * quarantine exists precisely because that resolution can fail, and a replay
 * into the wrong org would be worse than the drop it repairs.
 *
 * `receivedAt` is carried over unchanged, so a message replayed after newer
 * mail has already landed on its thread is refused by `applyInboundMessage`'s
 * own late-inbound guard instead of rewinding the conversation.
 */
export const replayForInbox = internalMutation({
  args: { inboxRef: v.string() },
  returns: vReplayResult,
  handler: async (ctx, args): Promise<QuarantineReplayResult> => {
    const inboxRef = clipRef(args.inboxRef);
    const claims = await ctx.db
      .query("orgs")
      .withIndex("by_inboxRef", (q) => q.eq("inboxRef", inboxRef))
      .collect();
    if (claims.length !== 1) {
      return {
        released: 0,
        held: 0,
        discarded: 0,
        blockedBy:
          claims.length === 0
            ? ("inbox_unassigned" as const)
            : ("inbox_ambiguous" as const),
      };
    }
    const org = claims[0];
    const rows = await ctx.db
      .query("quarantinedEmailEvents")
      .withIndex("by_inboxRef_and_state", (q) =>
        q.eq("inboxRef", inboxRef).eq("state", "quarantined"),
      )
      .take(QUARANTINE_REPLAY_LIMIT);

    let released = 0;
    let held = 0;
    let discarded = 0;
    for (const row of rows) {
      const outcome = await replayOne(ctx, org, row);
      if (outcome === "released") {
        released += 1;
      } else if (outcome === "discarded") {
        discarded += 1;
      } else {
        held += 1;
      }
    }
    return { released, held, discarded };
  },
});

async function replayOne(
  ctx: MutationCtx,
  org: Doc<"orgs">,
  row: Doc<"quarantinedEmailEvents">,
): Promise<"released" | "held" | "discarded"> {
  if (directionForApplicationKey(row.applicationKey) === "outbound") {
    // A delivery fact needs no body: the receipt carries only the provider's
    // own timestamp, and `recordReceipt` folds it onto the matching attempt
    // (or parks it) exactly as it would have at the time.
    await recordReceipt(ctx, {
      orgId: org._id,
      inboxRef: row.inboxRef,
      providerEventId: row.providerEventId,
      applicationKey: row.applicationKey,
      providerMessageRef: row.providerMessageRef,
      eventType: row.eventType,
      receivedAt: row.receivedAt,
      ...(row.providerThreadRef !== undefined
        ? { providerThreadRef: row.providerThreadRef }
        : {}),
      providerFacts:
        row.providerTimestamp === undefined
          ? {}
          : { timestamp: row.providerTimestamp },
    });
    await settle(ctx, row, "released", org._id, "replayed as a delivery receipt");
    return "released";
  }

  const threadRef = row.providerThreadRef;
  if (threadRef === undefined) {
    // `applyInboundMessage` would refuse it for the same reason: a
    // conversation keyed on nothing could never be matched again.
    await settle(
      ctx,
      row,
      "discarded",
      undefined,
      "no provider thread reference, so it could never be matched to a conversation",
    );
    return "discarded";
  }

  const message = await readComponentMessage(
    ctx,
    threadRef,
    row.inboxRef,
    row.providerMessageRef,
  );
  if (message === null) {
    if (row.receivedAt + QUARANTINE_UNREADABLE_MAX_AGE_MS < Date.now()) {
      await settle(
        ctx,
        row,
        "discarded",
        undefined,
        "the mail provider component no longer holds this message, so it can no longer be replayed",
      );
      return "discarded";
    }
    return "held";
  }

  // Recomputed from the component row by the same two functions the callback
  // uses, so a replayed message is judged by today's rules. Neither ever
  // becomes a routing decision; both can only make a later check refuse.
  const fromAddress = parseInboundSender(message.from);
  const optOut = evaluateOptOutText({
    subject: message.subject,
    text: message.text,
    extractedText: message.extractedText,
  });
  // Through the single writer (PLAN §9.4), never a direct insert: a message
  // the backfill imported while this row waited is MERGED and promoted to
  // `live` rather than duplicated.
  const { receipt, startsHandling } = await upsertMessage(ctx, {
    orgId: org._id,
    inboxRef: row.inboxRef,
    providerEventId: row.providerEventId,
    providerMessageRef: row.providerMessageRef,
    providerThreadRef: threadRef,
    source: "live" as const,
    receivedAt: row.receivedAt,
    providerFacts: {
      ...(fromAddress !== undefined ? { fromAddress } : {}),
      optOutSignal: optOut.signal,
      ...(optOut.rule !== undefined ? { optOutRule: optOut.rule } : {}),
    },
  });
  if (startsHandling) {
    // Scheduled, not inlined: a throw in the business path must not roll back
    // the receipt that makes the event replayable a second time.
    await ctx.scheduler.runAfter(0, internal.inbox.inbound.applyInboundMessage, {
      receiptId: receipt._id,
    });
  }
  await settle(
    ctx,
    row,
    "released",
    org._id,
    startsHandling
      ? "replayed into inbound processing"
      : "already recorded under this organization; no second application effect",
  );
  return "released";
}

/**
 * Read one inbound message back through the component — the ONLY message
 * store (§4.3). Bounded by the thread rather than the inbox: the component's
 * `{inboxId}` form is an unbounded `.collect()` over everything the inbox has
 * ever received, while `{threadId}` is bounded by one conversation. The
 * component's `by_thread` index is global and AgentMail thread ids are
 * per-inbox, so the inbox is matched before the message id.
 */
async function readComponentMessage(
  ctx: MutationCtx,
  threadRef: string,
  inboxRef: string,
  messageRef: string,
): Promise<Record<string, unknown> | null> {
  const rows = (await ctx.runQuery(
    components.agentmail.lib.listInboundMessages,
    { threadId: threadRef },
  )) as Array<Record<string, unknown>>;
  return (
    rows.find(
      (candidate) =>
        candidate.inboxId === inboxRef && candidate.messageId === messageRef,
    ) ?? null
  );
}

async function settle(
  ctx: MutationCtx,
  row: Doc<"quarantinedEmailEvents">,
  state: "released" | "discarded",
  releasedTo: Doc<"orgs">["_id"] | undefined,
  note: string,
): Promise<void> {
  await ctx.db.patch("quarantinedEmailEvents", row._id, {
    state,
    releasedAt: Date.now(),
    ...(releasedTo !== undefined ? { releasedTo } : {}),
    note:
      note.length > QUARANTINE_NOTE_MAX_LENGTH
        ? note.slice(0, QUARANTINE_NOTE_MAX_LENGTH)
        : note,
  });
}
