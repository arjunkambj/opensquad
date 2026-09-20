/**
 * The 30-day thread backfill (PLAN §4 "Manage inbox" step 5, §9.4).
 *
 * WHY IT EXISTS. Webhooks only deliver NEW mail, so a freshly connected inbox
 * would show an empty Inbox beside a mailbox full of conversations. Connect
 * therefore schedules a one-time import of the last 30 days.
 *
 * SHORT IDEMPOTENT STEPS, NEVER ONE LONG ACTION (PLAN §9.1). Each scheduled
 * step does exactly one provider request — one page of the thread listing, or
 * one thread — then writes its progress and schedules the next step in the
 * SAME transaction, so the chain cannot be lost between a write and a
 * schedule. The cursor lives on a `providerOperations` row keyed
 * `inbox_backfill:<connectedAt>`, which also makes the whole run idempotent:
 * re-running connect for the same `connectedAt` resumes rather than restarts,
 * and a NEW connect gets a new key and a fresh run.
 *
 * WHAT IT WRITES. Conversations marked `source: "backfill"` and one message
 * row per provider message through `inbox.model.upsertMessage` — the single
 * writer, which settles every backfilled row `handled` so history is readable
 * and never answered. Message BODIES are deliberately not imported: §4.3 keeps
 * one message store, and for backfilled history there is no component row to
 * be the second copy of. The import carries identity, sender and timestamps.
 *
 * COSTS NO CREDITS. Reading threads is not a metered operation in the ledger
 * (PLAN §6 meters AgentMail by `sends`), so the operation row carries no
 * reservation. It exists here as the durable cursor and progress record.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  getThread,
  listThreads,
  THREAD_MESSAGE_PAGE_LIMIT,
  THREAD_PAGE_LIMIT,
} from "../integrations/agentmailApi";
import type { AgentMailErrorCode } from "../integrations/agentmailApi";
import { decryptSecret } from "../lib/secrets";
import {
  computeResultDigest,
  parseInboundSender,
  PROVIDER_REF_MAX_LENGTH,
} from "../lib/validators";
import { mergeConversationSource, upsertMessage, backfillEventId } from "./model";
import { v } from "convex/values";

/** How far back the import reaches (PLAN §4 step 5). */
export const BACKFILL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Hard ceiling on one run, so the chain is bounded by construction. */
export const BACKFILL_MAX_THREADS = 300;

/** Re-drives allowed for one step before the run is recorded as failed. */
export const BACKFILL_MAX_ATTEMPTS = 5;

/** Back-off before re-driving a step the provider refused transiently. */
export const BACKFILL_RETRY_DELAY_MS = 30_000;

/** Provider failures a re-drive can plausibly fix. */
const TRANSIENT_CODES: ReadonlySet<AgentMailErrorCode> = new Set<AgentMailErrorCode>([
  "rate_limited",
  "provider_unavailable",
  "timeout",
  "transport_error",
]);

/** A refusal no re-drive and no other thread can get past. */
function isCredentialFailure(code: AgentMailErrorCode): boolean {
  return code === "unauthorized" || code === "forbidden";
}

export function backfillOperationKey(connectedAt: number): string {
  return `inbox_backfill:${connectedAt}`;
}

/**
 * The cursor. `pending` holds the thread ids of the page currently being
 * imported — one is consumed per step — and `pageToken` is where the listing
 * resumes once that page is empty.
 */
type BackfillProgress = {
  phase: "listing" | "threads";
  pageToken?: string;
  pending: string[];
  threadsImported: number;
  attempts: number;
};

const EMPTY_PROGRESS: BackfillProgress = {
  phase: "listing",
  pending: [],
  threadsImported: 0,
  attempts: 0,
};

function readProgress(row: Doc<"providerOperations">): BackfillProgress {
  const stored =
    row.resultRef?.kind === "inline"
      ? (row.resultRef.value as Partial<BackfillProgress> | null)
      : null;
  if (stored === null || typeof stored !== "object") {
    return EMPTY_PROGRESS;
  }
  return {
    phase: stored.phase === "threads" ? "threads" : "listing",
    ...(typeof stored.pageToken === "string"
      ? { pageToken: stored.pageToken }
      : {}),
    pending: Array.isArray(stored.pending)
      ? stored.pending.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    threadsImported:
      typeof stored.threadsImported === "number" ? stored.threadsImported : 0,
    attempts: typeof stored.attempts === "number" ? stored.attempts : 0,
  };
}

async function writeProgress(
  ctx: MutationCtx,
  row: Doc<"providerOperations">,
  progress: BackfillProgress,
  state: Doc<"providerOperations">["state"],
  error?: { code: string; message: string },
): Promise<void> {
  await ctx.db.patch("providerOperations", row._id, {
    state,
    resultRef: { kind: "inline" as const, value: progress },
    updatedAt: Date.now(),
    ...(error !== undefined ? { error } : {}),
  });
}

/* ------------------------------------------------------------------ */
/* The client-visible sync status                                      */
/* ------------------------------------------------------------------ */

export const vInboxSync = v.object({
  state: v.union(
    v.literal("idle"),
    v.literal("importing"),
    v.literal("imported"),
    v.literal("failed"),
  ),
  /** Threads imported so far — the `n` in "Syncing n threads…". */
  threads: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
});

export type InboxSync = typeof vInboxSync.type;

export async function readInboxSync(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  connectedAt: number | undefined,
): Promise<InboxSync> {
  if (connectedAt === undefined) {
    return { state: "idle" as const, threads: 0 };
  }
  const row = await ctx.db
    .query("providerOperations")
    .withIndex("by_workspaceId_and_provider_and_operationKey", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("provider", "agentmail")
        .eq("operationKey", backfillOperationKey(connectedAt)),
    )
    .unique();
  if (row === null) {
    return { state: "idle" as const, threads: 0 };
  }
  const progress = readProgress(row);
  const state =
    row.state === "completed"
      ? ("imported" as const)
      : row.state === "failed"
        ? ("failed" as const)
        : ("importing" as const);
  return {
    state,
    threads: progress.threadsImported,
    startedAt: row.createdAt,
    ...(row.state === "completed" || row.state === "failed"
      ? { completedAt: row.updatedAt }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* The chain                                                           */
/* ------------------------------------------------------------------ */

const vStepContext = v.union(
  v.object({
    run: v.literal(true),
    operationId: v.id("providerOperations"),
    inboxRef: v.string(),
    afterMs: v.number(),
    pageToken: v.optional(v.string()),
    threadId: v.optional(v.string()),
  }),
  v.object({ run: v.literal(false), reason: v.string() }),
);

/**
 * Create (or resume) the run for this connection and schedule its first step.
 * Idempotent on `(workspace, provider, operationKey)`: a second connect at the
 * same `connectedAt` finds the row and schedules nothing new unless the run
 * had failed.
 */
export const beginBackfill = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({ started: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (workspace === null) {
      return { started: false, reason: "organization not found" };
    }
    const { inboxRef, connectedAt } = workspace;
    if (inboxRef === undefined || connectedAt === undefined) {
      return { started: false, reason: "organization has no connected inbox" };
    }
    const operationKey = backfillOperationKey(connectedAt);
    const existing = await ctx.db
      .query("providerOperations")
      .withIndex("by_workspaceId_and_provider_and_operationKey", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("provider", "agentmail")
          .eq("operationKey", operationKey),
      )
      .unique();
    if (existing !== null) {
      if (existing.state === "completed") {
        return { started: false, reason: "already imported" };
      }
      // A failed or interrupted run resumes from its stored cursor.
      await writeProgress(
        ctx,
        existing,
        { ...readProgress(existing), attempts: 0 },
        "accepted",
      );
      await ctx.scheduler.runAfter(
        0,
        internal.inbox.backfill.runBackfillStep,
        { workspaceId: args.workspaceId },
      );
      return { started: true };
    }
    const now = Date.now();
    await ctx.db.insert("providerOperations", {
      workspaceId: args.workspaceId,
      provider: "agentmail" as const,
      operationKey,
      requestDigest: await computeResultDigest({
        provider: "agentmail",
        tool: "inbox_backfill",
        arguments: { inboxRef, afterMs: connectedAt - BACKFILL_WINDOW_MS },
      }),
      // No reservation: reading threads is not a metered operation.
      reservationIds: [],
      state: "accepted" as const,
      resultRef: { kind: "inline" as const, value: EMPTY_PROGRESS },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.inbox.backfill.runBackfillStep, {
      workspaceId: args.workspaceId,
    });
    return { started: true };
  },
});

/** What the next step must do, read in one transaction. */
export const nextStep = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: vStepContext,
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (
      workspace === null ||
      workspace.inboxRef === undefined ||
      workspace.connectedAt === undefined
    ) {
      return { run: false as const, reason: "organization has no connected inbox" };
    }
    const row = await ctx.db
      .query("providerOperations")
      .withIndex("by_workspaceId_and_provider_and_operationKey", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("provider", "agentmail")
          .eq("operationKey", backfillOperationKey(workspace.connectedAt as number)),
      )
      .unique();
    // `uncertain` still runs: the shared provider-operation sweep can relabel
    // a stalled row (see `sweepStalledBackfills`), and a relabelled run is
    // resumable — only `completed` and `failed` are terminal here.
    if (row === null || row.state === "completed" || row.state === "failed") {
      return { run: false as const, reason: "no run in progress" };
    }
    const progress = readProgress(row);
    const threadId = progress.pending[0];
    return {
      run: true as const,
      operationId: row._id,
      inboxRef: workspace.inboxRef,
      afterMs: (workspace.connectedAt as number) - BACKFILL_WINDOW_MS,
      ...(progress.pageToken !== undefined
        ? { pageToken: progress.pageToken }
        : {}),
      ...(threadId !== undefined ? { threadId } : {}),
    };
  },
});

/**
 * ONE step: either the next page of the thread listing, or the next thread.
 * It re-schedules itself through the recording mutation, so the whole chain is
 * a sequence of short actions each holding exactly one provider request.
 */
export const runBackfillStep = internalAction({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const step = await ctx.runQuery(internal.inbox.backfill.nextStep, {
      workspaceId: args.workspaceId,
    });
    if (!step.run) {
      return null;
    }
    const envelope = await ctx.runQuery(
      internal.workspaces.secrets.getEnvelope,
      { workspaceId: args.workspaceId, provider: "agentmail" },
    );
    if (envelope === null || envelope.status === "invalid") {
      await ctx.runMutation(internal.inbox.backfill.failBackfill, {
        operationId: step.operationId,
        code: "unauthorized",
        message: "the organization's mail key is no longer usable",
      });
      return null;
    }
    const apiKey = await decryptSecret(envelope);

    if (step.threadId !== undefined) {
      const thread = await getThread(apiKey, step.inboxRef, step.threadId, {
        limit: THREAD_MESSAGE_PAGE_LIMIT,
      });
      if (!thread.ok) {
        if (isCredentialFailure(thread.code)) {
          // Skipping every thread in turn would just burn the whole cursor
          // against a key that can no longer read anything.
          await ctx.runMutation(internal.inbox.backfill.failBackfill, {
            operationId: step.operationId,
            code: thread.code,
            message: "the mail key can no longer read this inbox",
          });
          return null;
        }
        await ctx.runMutation(internal.inbox.backfill.recordStepFailure, {
          operationId: step.operationId,
          workspaceId: args.workspaceId,
          code: thread.code,
          transient: TRANSIENT_CODES.has(thread.code),
          // A single thread that cannot be read is skipped rather than
          // blocking the whole import behind it.
          skipThread: !TRANSIENT_CODES.has(thread.code),
        });
        return null;
      }
      await ctx.runMutation(internal.inbox.backfill.recordThread, {
        workspaceId: args.workspaceId,
        operationId: step.operationId,
        inboxRef: step.inboxRef,
        threadId: step.threadId,
        messages: thread.value.messages.map((message) => ({
          messageId: message.messageId,
          ...(message.timestamp !== undefined
            ? { timestamp: message.timestamp }
            : {}),
          ...(message.from !== undefined ? { from: message.from } : {}),
        })),
      });
      return null;
    }

    const page = await listThreads(apiKey, step.inboxRef, {
      afterMs: step.afterMs,
      limit: THREAD_PAGE_LIMIT,
      ...(step.pageToken !== undefined ? { pageToken: step.pageToken } : {}),
    });
    if (!page.ok) {
      if (isCredentialFailure(page.code)) {
        await ctx.runMutation(internal.inbox.backfill.failBackfill, {
          operationId: step.operationId,
          code: page.code,
          message: "the mail key can no longer read this inbox",
        });
        return null;
      }
      await ctx.runMutation(internal.inbox.backfill.recordStepFailure, {
        operationId: step.operationId,
        workspaceId: args.workspaceId,
        code: page.code,
        transient: TRANSIENT_CODES.has(page.code),
        skipThread: false,
      });
      return null;
    }
    await ctx.runMutation(internal.inbox.backfill.recordThreadPage, {
      workspaceId: args.workspaceId,
      operationId: step.operationId,
      threadIds: page.value.threads.map((thread) => thread.threadId),
      ...(page.value.nextPageToken !== undefined
        ? { nextPageToken: page.value.nextPageToken }
        : {}),
    });
    return null;
  },
});

/**
 * Schedule the next step in the transaction that recorded this one.
 *
 * The run is complete when nothing is pending AND the listing has no further
 * page (`phase: "threads"`). An empty mailbox therefore completes on its first
 * step rather than looking like a failure.
 */
async function continueOrFinish(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  row: Doc<"providerOperations">,
  progress: BackfillProgress,
  delayMs = 0,
): Promise<void> {
  const done = progress.pending.length === 0 && progress.phase === "threads";
  if (done || progress.threadsImported >= BACKFILL_MAX_THREADS) {
    await writeProgress(ctx, row, progress, "completed");
    return;
  }
  await writeProgress(ctx, row, progress, "accepted");
  await ctx.scheduler.runAfter(
    delayMs,
    internal.inbox.backfill.runBackfillStep,
    { workspaceId },
  );
}

export const recordThreadPage = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    operationId: v.id("providerOperations"),
    threadIds: v.array(v.string()),
    nextPageToken: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("providerOperations", args.operationId);
    if (row === null) {
      return null;
    }
    const previous = readProgress(row);
    const room = Math.max(
      0,
      BACKFILL_MAX_THREADS - previous.threadsImported - previous.pending.length,
    );
    const accepted = args.threadIds.slice(0, room);
    const moreToList =
      args.nextPageToken !== undefined && room - accepted.length > 0;
    const progress: BackfillProgress = {
      // `listing` means "a further listing request is due"; pending threads
      // are still drained first, because `nextStep` prefers them.
      phase: moreToList ? "listing" : "threads",
      ...(moreToList ? { pageToken: args.nextPageToken } : {}),
      pending: [...previous.pending, ...accepted],
      threadsImported: previous.threadsImported,
      attempts: 0,
    };
    await continueOrFinish(ctx, args.workspaceId, row, progress);
    return null;
  },
});

/** The bounded per-message projection the import stores. No bodies. */
const vBackfillMessage = v.object({
  messageId: v.string(),
  timestamp: v.optional(v.number()),
  from: v.optional(v.string()),
});

export const recordThread = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    operationId: v.id("providerOperations"),
    inboxRef: v.string(),
    threadId: v.string(),
    messages: v.array(vBackfillMessage),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("providerOperations", args.operationId);
    if (row === null) {
      return null;
    }
    await importThread(ctx, args);
    const previous = readProgress(row);
    const progress: BackfillProgress = {
      // Carried, not recomputed: only the listing step decides whether more
      // pages remain.
      phase: previous.phase,
      ...(previous.pageToken !== undefined
        ? { pageToken: previous.pageToken }
        : {}),
      pending: previous.pending.filter((id) => id !== args.threadId),
      threadsImported: previous.threadsImported + 1,
      attempts: 0,
    };
    await continueOrFinish(ctx, args.workspaceId, row, progress);
    return null;
  },
});

/**
 * One imported thread: its conversation and its messages.
 *
 * The conversation is created `unassigned` under human takeover, exactly as an
 * unmatched live message would be — backfilled history has no lead, no agent
 * and no approval behind it, and nothing here guesses one. An EXISTING
 * conversation (our own outbound thread, or one the webhook already created)
 * is merged into, never restated: timestamps only ever move forward and the
 * source only ever moves toward `live`.
 */
async function importThread(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    inboxRef: string;
    threadId: string;
    messages: Array<{ messageId: string; timestamp?: number; from?: string }>;
  },
): Promise<void> {
  const newest = args.messages.reduce<
    { messageId: string; timestamp?: number; from?: string } | undefined
  >((best, message) => {
    if (best === undefined) return message;
    return (message.timestamp ?? 0) >= (best.timestamp ?? 0) ? message : best;
  }, undefined);
  const at = newest?.timestamp ?? Date.now();

  const ensured = await ctx.runMutation(
    internal.inbox.unassignedQueue.ensureUnassignedConversation,
    {
      workspaceId: args.workspaceId,
      inboxRef: args.inboxRef,
      providerThreadRef: args.threadId,
      messageRef: newest?.messageId ?? args.threadId,
      at,
      source: "backfill" as const,
      ...(newest?.from !== undefined &&
      parseInboundSender(newest.from) !== undefined
        ? { fromAddress: parseInboundSender(newest.from) as string }
        : {}),
    },
  );
  if (!ensured.ok) {
    return;
  }
  const conversation = await ctx.db.get("conversations", ensured.conversation._id);
  if (conversation !== null) {
    await mergeConversationSource(ctx, conversation, "backfill");
    // Forward-only: a live message already applied to this thread must not be
    // rewound by older history.
    const advances =
      conversation.lastMessageAt === undefined || at > conversation.lastMessageAt;
    if (advances) {
      await ctx.db.patch("conversations", conversation._id, {
        lastMessageAt: at,
        updatedAt: Date.now(),
      });
    }
  }

  for (const message of args.messages) {
    if (message.messageId.length > PROVIDER_REF_MAX_LENGTH) {
      continue;
    }
    const fromAddress =
      message.from === undefined ? undefined : parseInboundSender(message.from);
    await upsertMessage(ctx, {
      workspaceId: args.workspaceId,
      inboxRef: args.inboxRef,
      providerMessageRef: message.messageId,
      providerThreadRef: args.threadId,
      providerEventId: await backfillEventId(args.inboxRef, message.messageId),
      source: "backfill" as const,
      ...(message.timestamp !== undefined ? { receivedAt: message.timestamp } : {}),
      providerFacts: {
        ...(fromAddress !== undefined ? { fromAddress } : {}),
        // History is never answered, so no opt-out verdict is computed from
        // it: the rule runs on live mail, where it can stop a real send.
        optOutSignal: "none",
      },
    });
  }
}

export const recordStepFailure = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    operationId: v.id("providerOperations"),
    code: v.string(),
    transient: v.boolean(),
    skipThread: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("providerOperations", args.operationId);
    if (row === null) {
      return null;
    }
    const previous = readProgress(row);
    if (args.skipThread && previous.pending.length > 0) {
      const progress: BackfillProgress = {
        ...previous,
        pending: previous.pending.slice(1),
        attempts: 0,
      };
      await continueOrFinish(ctx, args.workspaceId, row, progress);
      return null;
    }
    const attempts = previous.attempts + 1;
    if (!args.transient || attempts >= BACKFILL_MAX_ATTEMPTS) {
      await writeProgress(ctx, row, { ...previous, attempts }, "failed", {
        code: args.code,
        message: "the thread import could not be completed",
      });
      return null;
    }
    await writeProgress(ctx, row, { ...previous, attempts }, "accepted");
    await ctx.scheduler.runAfter(
      BACKFILL_RETRY_DELAY_MS,
      internal.inbox.backfill.runBackfillStep,
      { workspaceId: args.workspaceId },
    );
    return null;
  },
});

/** A run whose next step has not moved for this long has lost its schedule. */
export const BACKFILL_STALL_MS = 10 * 60 * 1000;

/**
 * Rows one sweep examines. The index is global and every provider's
 * `accepted` operations share it, so the page is deliberately wide: a wedged
 * operation belonging to another provider would otherwise sit at the head of
 * the oldest-first range and starve this sweep.
 */
export const BACKFILL_SWEEP_SCAN = 100;

/**
 * The belt for the chain (PLAN §9.1 "Recovery"). Every step schedules the next
 * inside its own transaction, so the only way a run stalls is a lost
 * scheduled function — which this re-drives. Re-driving is safe because every
 * step is idempotent: the cursor says exactly what is still to do, and
 * `upsertMessage` refuses a second row for a message already imported.
 */
export const sweepStalledBackfills = internalMutation({
  args: {},
  returns: v.object({ resumed: v.number() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - BACKFILL_STALL_MS;
    let resumed = 0;
    // `uncertain` is swept too, and not because this file ever writes it:
    // `integrations/firecrawl.sweepStaleFirecrawlOperations` scans the same
    // global `by_state_and_updatedAt` index WITHOUT filtering by provider, so
    // it can relabel a stalled backfill row before this sweep sees it. That
    // relabelling is harmless — the row carries no reservation — as long as
    // the run stays resumable, which is what including the state here buys.
    for (const state of ["accepted", "uncertain"] as const) {
      const rows = await ctx.db
        .query("providerOperations")
        .withIndex("by_state_and_updatedAt", (q) =>
          q.eq("state", state).lt("updatedAt", cutoff),
        )
        .take(BACKFILL_SWEEP_SCAN);
      for (const row of rows) {
        if (
          row.provider !== "agentmail" ||
          !row.operationKey.startsWith("inbox_backfill:")
        ) {
          continue;
        }
        // Stamped before the schedule so the next sweep does not re-drive the
        // same run while this one is still working.
        await ctx.db.patch("providerOperations", row._id, {
          state: "accepted" as const,
          updatedAt: Date.now(),
        });
        await ctx.scheduler.runAfter(
          0,
          internal.inbox.backfill.runBackfillStep,
          { workspaceId: row.workspaceId },
        );
        resumed += 1;
      }
    }
    return { resumed };
  },
});

export const failBackfill = internalMutation({
  args: {
    operationId: v.id("providerOperations"),
    code: v.string(),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("providerOperations", args.operationId);
    if (row === null) {
      return null;
    }
    await writeProgress(ctx, row, readProgress(row), "failed", {
      code: args.code,
      message: args.message,
    });
    return null;
  },
});
