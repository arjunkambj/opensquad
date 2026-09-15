/**
 * Drafts — immutable exact-send-payload revisions (architecture §4.3/§8).
 *
 * A draft ROW is one immutable revision of {recipient, sender inbox,
 * subject, body, reply parent}; `payloadHash` commits to the canonical
 * serialization of those fields (`computePayloadHash`). Nothing here edits
 * a row in place — `revise`/`createRevision` insert revision N+1, move
 * `conversations.currentDraftId`, advance `contextVersion` (a new current
 * draft is an explicit context change), supersede the old open
 * `draft_approval` decision and open a fresh one through the P06 decision
 * APIs. Old revisions keep `supersededAt` so history stays auditable.
 *
 * CONVERSATION HELPERS BELOW ARE A MINIMAL P10 SEAM: P11 owns the real
 * `convex/conversations.ts` module (inbox listing, inbound association,
 * takeover UI entry points). `stageConversation`/`applyInboundContext`
 * exist so preflight facts can be staged and inbound-driven invalidation
 * exercised before that module lands — they are internal-only.
 */
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  requireWorkspaceEditor,
  requireWorkspaceMember,
} from "./lib/auth";
import type { AuthCtx } from "./lib/auth";
import {
  boundedLimit,
  boundedString,
  computePayloadHash,
  domainError,
  DRAFT_BODY_MAX_LENGTH,
  DRAFT_EVIDENCE_ID_MAX_LENGTH,
  DRAFT_EVIDENCE_MAX_ITEMS,
  DRAFT_SUBJECT_MAX_LENGTH,
  invalid,
  normalizeEmailAddress,
  PROVIDER_REF_MAX_LENGTH,
  vConversationState,
} from "./lib/validators";
import type { EndpointOperation } from "./lib/validators";
import { recordActivityEvent } from "./activity";
import { conversationFields, draftFields } from "./schema";

export const vConversationDoc = v.object({
  _id: v.id("conversations"),
  _creationTime: v.number(),
  ...conversationFields,
});

export const vDraftDoc = v.object({
  _id: v.id("drafts"),
  _creationTime: v.number(),
  ...draftFields,
});

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

export async function getConversationInWorkspace(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
  conversationId: Id<"conversations">,
): Promise<Doc<"conversations">> {
  const conversation = await ctx.db.get("conversations", conversationId);
  if (conversation === null || conversation.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "conversation not found");
  }
  return conversation;
}

export async function getDraftInWorkspace(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
  draftId: Id<"drafts">,
): Promise<Doc<"drafts">> {
  const draft = await ctx.db.get("drafts", draftId);
  if (draft === null || draft.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "draft not found");
  }
  return draft;
}

function endpointFor(replyToMessageRef: string | undefined): EndpointOperation {
  return replyToMessageRef === undefined ? "send" : "reply";
}

/**
 * Supersede every OPEN `draft_approval` decision bound to drafts of this
 * conversation (there is at most one by askKey uniqueness, but a stale ask
 * on an older revision is retired too). The lookup is by draft, not by
 * mission: a revision installed under a different mission (a P11 reply
 * mission revising an outreach conversation) must still retire the ask the
 * outgoing revision left open — otherwise that ask stays bound to a
 * superseded draft forever, unresolvable and pinning `requiredDecisionCount`
 * on the originating mission.
 */
async function supersedeOpenDraftDecisions(
  ctx: MutationCtx,
  conversationId: Id<"conversations">,
): Promise<Doc<"decisions">[]> {
  const draftsOfConversation = await ctx.db
    .query("drafts")
    .withIndex("by_conversationId_and_revision", (q) =>
      q.eq("conversationId", conversationId),
    )
    .collect();
  const retired: Doc<"decisions">[] = [];
  for (const draft of draftsOfConversation) {
    const bound = await ctx.db
      .query("decisions")
      .withIndex("by_draftId", (q) => q.eq("draftId", draft._id))
      .collect();
    for (const decision of bound) {
      if (decision.kind === "draft_approval" && decision.state === "open") {
        await ctx.runMutation(internal.decisions.supersedeDecision, {
          decisionId: decision._id,
          reason: "replaced by a newer draft revision",
        });
        retired.push(decision);
      }
    }
  }
  return retired;
}

/**
 * Open the fresh `draft_approval` ask for a new current draft. Binds to the
 * superseded decision's workflow when there is one (a branch child workflow
 * stays the waiter), else the mission's own workflow.
 */
async function openDraftApprovalDecision(
  ctx: MutationCtx,
  args: {
    mission: Doc<"missions">;
    draft: Doc<"drafts">;
    targetWorkflowId?: string;
  },
): Promise<void> {
  const targetWorkflowId =
    args.targetWorkflowId ?? args.mission.workflowId;
  if (targetWorkflowId === undefined) {
    // A mission without a dispatched workflow has nothing to wake — this is
    // reachable only on staged/probe data; the draft exists but cannot gain
    // an approval path until a workflow owns the ask.
    return;
  }
  await ctx.runMutation(internal.decisions.openRequiredDecision, {
    missionId: args.mission._id,
    kind: "draft_approval",
    reason:
      `Approve the exact draft (revision ${args.draft.revision}) to ` +
      `${args.draft.normalizedRecipient}. Approving binds this revision's ` +
      `payload hash and the current conversation context only.`,
    askKey: `draft_approval:${args.draft._id}`,
    required: true,
    draftId: args.draft._id,
    targetWorkflowId,
  });
}

/**
 * The single immutable-revision write path shared by `revise` and
 * `createRevision`. Runs entirely inside the caller's transaction: insert
 * the new revision row, move `currentDraftId`, advance `contextVersion`,
 * supersede the old open ask and open the fresh one.
 */
async function installRevision(
  ctx: MutationCtx,
  args: {
    workspace: Doc<"workspaces">;
    conversation: Doc<"conversations">;
    mission: Doc<"missions">;
    campaign: Doc<"campaigns">;
    recipient: string;
    subject: string;
    body: string;
    evidenceIds: string[];
    replyToMessageRef?: string;
    createdBy: string;
    requestId?: string;
    /** Workflow that should wait on the fresh approval ask. */
    targetWorkflowId?: string;
    openDecision: boolean;
  },
): Promise<Doc<"drafts">> {
  const normalizedRecipient = normalizeEmailAddress(args.recipient);
  const subject = boundedString(args.subject, "subject", {
    min: 1,
    max: DRAFT_SUBJECT_MAX_LENGTH,
  });
  const body = boundedString(args.body, "body", {
    min: 1,
    max: DRAFT_BODY_MAX_LENGTH,
  });
  if (args.evidenceIds.length > DRAFT_EVIDENCE_MAX_ITEMS) {
    throw invalid(
      `evidenceIds allows at most ${DRAFT_EVIDENCE_MAX_ITEMS} entries`,
    );
  }
  const evidenceIds = args.evidenceIds.map((id, index) =>
    boundedString(id, `evidenceIds[${index}]`, {
      min: 1,
      max: DRAFT_EVIDENCE_ID_MAX_LENGTH,
    }),
  );
  const replyToMessageRef =
    args.replyToMessageRef === undefined
      ? undefined
      : boundedString(args.replyToMessageRef, "replyToMessageRef", {
          min: 1,
          max: PROVIDER_REF_MAX_LENGTH,
        });

  const latest = await ctx.db
    .query("drafts")
    .withIndex("by_conversationId_and_revision", (q) =>
      q.eq("conversationId", args.conversation._id),
    )
    .order("desc")
    .first();
  const revision = (latest?.revision ?? 0) + 1;
  const endpointOperation = endpointFor(replyToMessageRef);
  const payloadHash = await computePayloadHash({
    endpointOperation,
    inboxRef: args.conversation.inboxRef,
    normalizedRecipient,
    subject,
    body,
    replyToMessageRef: replyToMessageRef ?? null,
  });

  const now = Date.now();
  if (latest !== null && latest.supersededAt === undefined) {
    await ctx.db.patch("drafts", latest._id, { supersededAt: now });
  }
  const draftId = await ctx.db.insert("drafts", {
    workspaceId: args.workspace._id,
    conversationId: args.conversation._id,
    inboxRef: args.conversation.inboxRef,
    missionId: args.mission._id,
    revision,
    recipient: boundedString(args.recipient, "recipient", {
      min: 3,
      max: PROVIDER_REF_MAX_LENGTH,
    }),
    normalizedRecipient,
    subject,
    body,
    payloadHash,
    // A new current draft is an explicit context change (§8): bump the
    // version first so this revision binds the post-change context.
    basedOnContextVersion: args.conversation.contextVersion + 1,
    campaignBriefVersion: args.campaign.briefVersion,
    policyVersion: args.workspace.policyVersion,
    evidenceIds,
    createdBy: args.createdBy,
    createdAt: now,
    ...(replyToMessageRef !== undefined ? { replyToMessageRef } : {}),
    ...(args.requestId !== undefined ? { requestId: args.requestId } : {}),
  });
  await ctx.db.patch("conversations", args.conversation._id, {
    currentDraftId: draftId,
    contextVersion: args.conversation.contextVersion + 1,
    updatedAt: now,
  });

  const draft = await ctx.db.get("drafts", draftId);
  if (draft === null) {
    throw domainError("NOT_FOUND", "draft not found after insert");
  }

  // Superseding open draft_approval asks is a correctness invariant of the
  // revision change itself — independent of whether a fresh ask opens. An
  // `openDecision:false` install must not strand the prior revision's ask.
  const retired = await supersedeOpenDraftDecisions(
    ctx,
    args.conversation._id,
  );

  // A parked (pre-dispatch) send intent authorized against the superseded
  // revision can never legally dispatch now — retire it in the same
  // transaction so its stale wake cannot block the corrected send.
  await ctx.runMutation(internal.sending.cancelParkedConversationAttempts, {
    workspaceId: args.workspace._id,
    conversationId: args.conversation._id,
    reason: `revision ${revision} superseded the draft it was authorized against`,
  });

  if (args.openDecision) {
    // The fresh ask prefers an explicitly passed waiter, then a retired ask
    // from THIS mission (a foreign mission's targetWorkflowId would fail
    // openRequiredDecision's ownership check), then the mission workflow.
    const sameMission = retired.find(
      (decision) => decision.missionId === args.mission._id,
    );
    await openDraftApprovalDecision(ctx, {
      mission: args.mission,
      draft,
      targetWorkflowId:
        args.targetWorkflowId ?? sameMission?.targetWorkflowId,
    });
  }
  return draft;
}

/** Request-id replay: a committed revision returns itself. */
async function findRevisionByRequestId(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  requestId: string,
): Promise<Doc<"drafts"> | null> {
  return await ctx.db
    .query("drafts")
    .withIndex("by_workspaceId_and_requestId", (q) =>
      q.eq("workspaceId", workspaceId).eq("requestId", requestId),
    )
    .unique();
}

/* ------------------------------------------------------------------ */
/* Public reads                                                        */
/* ------------------------------------------------------------------ */

/** One draft revision; foreign or cross-workspace IDs return `NOT_FOUND`. */
export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    draftId: v.id("drafts"),
  },
  returns: vDraftDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await getDraftInWorkspace(ctx, args.workspaceId, args.draftId);
  },
});

/**
 * Revision history for one conversation, newest first, cursor-paginated.
 * Immutable rows are the audit trail — superseded revisions stay readable.
 */
export const listForConversation = query({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vDraftDoc),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    await getConversationInWorkspace(
      ctx,
      args.workspaceId,
      args.conversationId,
    );
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("drafts")
      .withIndex("by_conversationId_and_revision", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});

/** Drafts produced under one mission (all conversations), newest first. */
export const listForMission = query({
  args: {
    workspaceId: v.id("workspaces"),
    missionId: v.id("missions"),
    limit: v.optional(v.number()),
  },
  returns: v.array(vDraftDoc),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const mission = await ctx.db.get("missions", args.missionId);
    if (mission === null || mission.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "mission not found");
    }
    const limit = boundedLimit(args.limit);
    return await ctx.db
      .query("drafts")
      .withIndex("by_missionId", (q) => q.eq("missionId", args.missionId))
      .order("desc")
      .take(limit);
  },
});

/* ------------------------------------------------------------------ */
/* Public mutation: human revision                                     */
/* ------------------------------------------------------------------ */

/**
 * Revise the current draft (owner/operator). Any send-field change inserts
 * revision N+1, moves `currentDraftId`, advances `contextVersion`,
 * supersedes the open approval ask and opens a fresh one — an old approval
 * can never silently apply to changed content (§8).
 *
 * `expectedRevision` is the optimistic-concurrency guard and the natural
 * idempotency: a replay sees `draft.revision !== expectedRevision` and gets
 * `CONFLICT` naming the current revision; `requestId` additionally dedupes
 * exact client retries to the recorded new row.
 */
export const revise = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    draftId: v.id("drafts"),
    expectedRevision: v.number(),
    recipient: v.optional(v.string()),
    subject: v.optional(v.string()),
    body: v.optional(v.string()),
    requestId: v.optional(v.string()),
  },
  returns: vDraftDoc,
  handler: async (ctx, args) => {
    const { identityKey, workspace } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    const requestId =
      args.requestId === undefined
        ? undefined
        : boundedString(args.requestId, "requestId", { min: 1, max: 100 });

    const current = await getDraftInWorkspace(
      ctx,
      args.workspaceId,
      args.draftId,
    );
    if (requestId !== undefined) {
      const replayed = await findRevisionByRequestId(
        ctx,
        args.workspaceId,
        requestId,
      );
      if (replayed !== null) {
        // The requestId dedupe must bind THIS revision target: the same key
        // reused against a different draft/conversation is a CONFLICT, not
        // a silent replay of an unrelated revision.
        if (
          replayed.conversationId !== current.conversationId ||
          replayed.revision !== current.revision + 1
        ) {
          throw domainError(
            "CONFLICT",
            `requestId ${requestId} already recorded a different revision`,
          );
        }
        return replayed;
      }
    }

    if (current.revision !== args.expectedRevision) {
      throw domainError(
        "CONFLICT",
        `draft revision is ${current.revision}, not ${args.expectedRevision}`,
      );
    }
    const conversation = await getConversationInWorkspace(
      ctx,
      args.workspaceId,
      current.conversationId,
    );
    if (conversation.currentDraftId !== current._id) {
      throw domainError(
        "CONFLICT",
        "draft is not the conversation's current revision; revise the current draft instead",
      );
    }

    const recipient = args.recipient ?? current.recipient;
    const subject = args.subject ?? current.subject;
    const body = args.body ?? current.body;
    if (
      args.recipient === undefined &&
      args.subject === undefined &&
      args.body === undefined
    ) {
      throw invalid("revise requires at least one of recipient/subject/body");
    }

    const mission = await ctx.db.get("missions", current.missionId);
    if (mission === null) {
      throw domainError("NOT_FOUND", "mission not found");
    }
    const campaign = await ctx.db.get("campaigns", mission.campaignId);
    if (campaign === null) {
      throw domainError("NOT_FOUND", "campaign not found");
    }

    const draft = await installRevision(ctx, {
      workspace,
      conversation,
      mission,
      campaign,
      recipient,
      subject,
      body,
      evidenceIds: current.evidenceIds,
      replyToMessageRef: current.replyToMessageRef,
      createdBy: identityKey,
      requestId,
      openDecision: true,
    });

    await recordActivityEvent(ctx, {
      workspaceId: args.workspaceId,
      missionId: mission._id,
      kind: "draft_revised",
      summary: `Draft revised to revision ${draft.revision} for ${draft.normalizedRecipient}`,
      actor: identityKey,
      dedupeKey: `draft:${draft._id}:revised`,
      conversationId: conversation._id,
    });
    return draft;
  },
});

/* ------------------------------------------------------------------ */
/* Internal write path (P09 draft-proposal step / P11 reply flow)        */
/* ------------------------------------------------------------------ */

/**
 * Propose a new immutable draft revision on a conversation (pipeline path —
 * P09's draft-proposal step and P11's reply flow call this). Validates the
 * recipient, bounds subject/body, records `basedOnContextVersion`,
 * `campaignBriefVersion` and `policyVersion`, installs the revision and —
 * unless `openDecision` is false — supersedes the stale open ask and opens
 * the fresh required `draft_approval` decision transactionally.
 *
 * `requestId` dedupes retries; `targetWorkflowId` may name the branch child
 * workflow that should be woken (must be owned by the mission — enforced by
 * `openRequiredDecision`).
 */
export const createRevision = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    missionId: v.id("missions"),
    recipient: v.string(),
    subject: v.string(),
    body: v.string(),
    evidenceIds: v.optional(v.array(v.string())),
    replyToMessageRef: v.optional(v.string()),
    requestId: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    targetWorkflowId: v.optional(v.string()),
    openDecision: v.optional(v.boolean()),
  },
  returns: vDraftDoc,
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    const mission = await ctx.db.get("missions", args.missionId);
    if (mission === null || mission.workspaceId !== conversation.workspaceId) {
      throw domainError("NOT_FOUND", "mission not found");
    }
    const requestId =
      args.requestId === undefined
        ? undefined
        : boundedString(args.requestId, "requestId", { min: 1, max: 100 });
    if (requestId !== undefined) {
      const replayed = await findRevisionByRequestId(
        ctx,
        conversation.workspaceId,
        requestId,
      );
      if (replayed !== null) {
        // Bind the dedupe to this conversation — a requestId recorded for a
        // different conversation is a CONFLICT, not a silent replay.
        if (replayed.conversationId !== args.conversationId) {
          throw domainError(
            "CONFLICT",
            `requestId ${requestId} already recorded a different revision`,
          );
        }
        return replayed;
      }
    }
    const workspace = await ctx.db.get("workspaces", conversation.workspaceId);
    const campaign = await ctx.db.get("campaigns", mission.campaignId);
    if (workspace === null || campaign === null) {
      throw domainError("NOT_FOUND", "workspace or campaign not found");
    }
    const draft = await installRevision(ctx, {
      workspace,
      conversation,
      mission,
      campaign,
      recipient: args.recipient,
      subject: args.subject,
      body: args.body,
      evidenceIds: args.evidenceIds ?? [],
      replyToMessageRef: args.replyToMessageRef,
      createdBy:
        args.createdBy === undefined
          ? "workflow"
          : boundedString(args.createdBy, "createdBy", { min: 1, max: 300 }),
      requestId,
      targetWorkflowId: args.targetWorkflowId,
      openDecision: args.openDecision ?? true,
    });
    await recordActivityEvent(ctx, {
      workspaceId: workspace._id,
      missionId: mission._id,
      kind: "draft_created",
      summary: `Draft revision ${draft.revision} proposed for ${draft.normalizedRecipient}`,
      actor: "workflow",
      dedupeKey: `draft:${draft._id}:created`,
      conversationId: conversation._id,
    });
    return draft;
  },
});

/* ------------------------------------------------------------------ */
/* Conversations — minimal internal helpers (P10 staging seam; P11 owns */
/* the public conversations module)                                    */
/* ------------------------------------------------------------------ */

/**
 * Stage or patch a conversation (internal only). Creates the row keyed on
 * (inboxRef, providerThreadRef) when `conversationId` is absent; otherwise
 * patches the listed mutable facts. Exists so preflight facts — versions,
 * takeover, state, prospect link — can be staged before P11's real module
 * lands; probes and P11's inbound processing share it.
 */
export const stageConversation = internalMutation({
  args: {
    conversationId: v.optional(v.id("conversations")),
    workspaceId: v.id("workspaces"),
    inboxRef: v.string(),
    employeeId: v.optional(v.id("employees")),
    providerThreadRef: v.optional(v.string()),
    prospectId: v.optional(v.id("prospects")),
    state: v.optional(vConversationState),
    humanTakeover: v.optional(v.boolean()),
    /** Staging override — real bumps flow through applyInboundContext etc. */
    contextVersion: v.optional(v.number()),
    unreadCount: v.optional(v.number()),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const inboxRef = boundedString(args.inboxRef, "inboxRef", {
      min: 1,
      max: PROVIDER_REF_MAX_LENGTH,
    });
    const providerThreadRef =
      args.providerThreadRef === undefined
        ? undefined
        : boundedString(args.providerThreadRef, "providerThreadRef", {
            min: 1,
            max: PROVIDER_REF_MAX_LENGTH,
          });
    const prospectId = args.prospectId;

    if (args.conversationId !== undefined) {
      const existing = await ctx.db.get("conversations", args.conversationId);
      if (existing === null || existing.workspaceId !== args.workspaceId) {
        throw domainError("NOT_FOUND", "conversation not found");
      }
      // The (inboxRef, providerThreadRef) pair must stay unique on patch too
      // — otherwise two conversations claim the same provider thread and the
      // create-path `.unique()` lookup starts throwing forever.
      if (providerThreadRef !== undefined) {
        const duplicate = await ctx.db
          .query("conversations")
          .withIndex("by_inboxRef_and_providerThreadRef", (q) =>
            q
              .eq("inboxRef", existing.inboxRef)
              .eq("providerThreadRef", providerThreadRef),
          )
          .unique();
        if (duplicate !== null && duplicate._id !== existing._id) {
          throw domainError(
            "CONFLICT",
            `inbox/thread already mapped to conversation ${duplicate._id}`,
          );
        }
      }
      await ctx.db.patch("conversations", existing._id, {
        ...(args.employeeId !== undefined
          ? { employeeId: args.employeeId }
          : {}),
        ...(providerThreadRef !== undefined ? { providerThreadRef } : {}),
        ...(prospectId !== undefined ? { prospectId } : {}),
        ...(args.state !== undefined ? { state: args.state } : {}),
        ...(args.humanTakeover !== undefined
          ? { humanTakeover: args.humanTakeover }
          : {}),
        ...(args.contextVersion !== undefined
          ? { contextVersion: args.contextVersion }
          : {}),
        ...(args.unreadCount !== undefined
          ? { unreadCount: args.unreadCount }
          : {}),
        updatedAt: Date.now(),
      });
      const updated = await ctx.db.get("conversations", existing._id);
      if (updated === null) {
        throw domainError("NOT_FOUND", "conversation not found");
      }
      return updated;
    }

    // Unique (inboxRef, providerThreadRef) mapping (§4.3 invariant).
    if (providerThreadRef !== undefined) {
      const duplicate = await ctx.db
        .query("conversations")
        .withIndex("by_inboxRef_and_providerThreadRef", (q) =>
          q.eq("inboxRef", inboxRef).eq("providerThreadRef", providerThreadRef),
        )
        .unique();
      if (duplicate !== null) {
        throw domainError(
          "CONFLICT",
          `inbox/thread already mapped to conversation ${duplicate._id}`,
        );
      }
    }

    let employeeId = args.employeeId;
    if (employeeId === undefined) {
      const outreach = await ctx.db
        .query("employees")
        .withIndex("by_workspaceId_and_template", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("template", "outreach"),
        )
        .unique();
      if (outreach === null) {
        throw invalid("workspace has no outreach employee for the conversation");
      }
      employeeId = outreach._id;
    } else {
      const employee = await ctx.db.get("employees", employeeId);
      if (employee === null || employee.workspaceId !== args.workspaceId) {
        throw domainError("NOT_FOUND", "employee not found");
      }
    }

    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      workspaceId: args.workspaceId,
      inboxRef,
      employeeId,
      state: args.state ?? "open",
      humanTakeover: args.humanTakeover ?? false,
      contextVersion: args.contextVersion ?? 1,
      unreadCount: args.unreadCount ?? 0,
      createdAt: now,
      updatedAt: now,
      ...(prospectId !== undefined ? { prospectId } : {}),
      ...(providerThreadRef !== undefined ? { providerThreadRef } : {}),
    });
    const conversation = await ctx.db.get("conversations", conversationId);
    if (conversation === null) {
      throw domainError("NOT_FOUND", "conversation not found after insert");
    }
    return conversation;
  },
});

/**
 * Staged inbound-reply application (internal only — P11's real inbound
 * processing replaces this seam). Advances `contextVersion`, records the
 * inbound reference/time, bumps the unread counter and supersedes any open
 * `draft_approval` decision on the now-stale current draft — the facts that
 * make a pending approval or a reserved send refuse at preflight (§8.5,
 * V17).
 */
export const applyInboundContext = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    lastInboundMessageRef: v.string(),
    at: v.optional(v.number()),
    markUnread: v.optional(v.boolean()),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    const messageRef = boundedString(
      args.lastInboundMessageRef,
      "lastInboundMessageRef",
      { min: 1, max: PROVIDER_REF_MAX_LENGTH },
    );
    // Idempotent per message: a re-delivered inbound must not bump
    // contextVersion again — a second bump would strand a draft approved
    // after the first application via `context_changed`.
    if (conversation.lastInboundMessageRef === messageRef) {
      return conversation;
    }
    const at = args.at ?? Date.now();
    // `lastMessageAt` backs the inbox ordering indexes, so it is MONOTONIC —
    // the same guard `sending.linkConversationThread` applies on the outbound
    // side. Signed provider deliveries arrive out of order (P05 observed
    // `message.delivered` before `message.sent` for one message), and P11's
    // receipt drain can re-drive an older inbound after a newer one has
    // already landed; neither may rewind a thread's position in the list.
    //
    // `lastInboundAt` is deliberately NOT clamped: it is the arrival time of
    // the message `lastInboundMessageRef` names, and the two must keep
    // describing the same message.
    const lastMessageAt =
      conversation.lastMessageAt === undefined || conversation.lastMessageAt < at
        ? at
        : conversation.lastMessageAt;
    await ctx.db.patch("conversations", conversation._id, {
      contextVersion: conversation.contextVersion + 1,
      lastInboundMessageRef: messageRef,
      lastInboundAt: at,
      lastMessageAt,
      unreadCount:
        conversation.unreadCount + (args.markUnread === false ? 0 : 1),
      updatedAt: Date.now(),
    });

    // Inbound mail makes a pending draft approval obsolete (§8.5) — and a
    // parked send intent authorized against the now-stale context can never
    // legally dispatch either, so retire it here rather than letting it
    // block the conversation until its stale wake fires.
    if (conversation.currentDraftId !== undefined) {
      await supersedeOpenDraftDecisions(ctx, conversation._id);
      await ctx.runMutation(
        internal.sending.cancelParkedConversationAttempts,
        {
          workspaceId: conversation.workspaceId,
          conversationId: conversation._id,
          reason: "inbound mail changed the conversation context",
        },
      );
    }

    const updated = await ctx.db.get("conversations", conversation._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    return updated;
  },
});

/**
 * Assign the workspace's AgentMail inbox reference (internal only — the real
 * inbox-assignment flow arrives with P11's onboarding/inbox work). Preflight
 * refuses dispatch when the draft's inbox differs from the workspace's.
 */
export const assignWorkspaceInbox = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    inboxRef: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (workspace === null) {
      throw domainError("NOT_FOUND", "workspace not found");
    }
    const inboxRef = boundedString(args.inboxRef, "inboxRef", {
      min: 1,
      max: PROVIDER_REF_MAX_LENGTH,
    });
    const holder = await ctx.db
      .query("workspaces")
      .withIndex("by_inboxRef", (q) => q.eq("inboxRef", inboxRef))
      .unique();
    if (holder !== null && holder._id !== workspace._id) {
      throw domainError(
        "CONFLICT",
        "inbox is already assigned to another workspace",
      );
    }
    await ctx.db.patch("workspaces", workspace._id, {
      inboxRef,
      updatedAt: Date.now(),
    });
    // The assignment is what the quarantine was waiting for. An AgentMail
    // inbox is provisioned before this mutation commits, so a verified event
    // can arrive in the window between the two and find no workspace to
    // belong to; it is held rather than dropped, and this is the moment it
    // becomes replayable. Scheduled, not inlined: the replay reads the mail
    // component and re-drives ingest, and none of that may roll back an
    // assignment an operator asked for.
    await ctx.scheduler.runAfter(0, internal.quarantine.replayForInbox, {
      inboxRef,
    });
    return null;
  },
});

/**
 * Retire the live work a conversation carries, because a fact just changed
 * that every open approval and every parked send was authorized against.
 *
 * This is the same pair `applyInboundContext` runs — supersede the open
 * `draft_approval` asks, then cancel the `reserved` attempts — exported so
 * P11's takeover, assignment, association and closure paths invalidate
 * EXACTLY the way an inbound reply does, rather than each growing its own
 * half-correct version.
 *
 * It is not optional politeness on a `contextVersion` bump. Once the version
 * moves, `approvals.resolveDraftDecision` refuses the bound ask forever
 * (`conversation.contextVersion !== draft.basedOnContextVersion`), so an ask
 * left open is unresolvable and pins `requiredDecisionCount` on its mission.
 * Superseding it through `internal.decisions.supersedeDecision` is what
 * decrements that count, un-parks the mission and wakes the waiting workflow.
 *
 * Callers must not patch a decision or an attempt themselves: the decision
 * path owns the mission bookkeeping and the attempt path owns the usage
 * reservation release and the §8.7 coverage unwind.
 */
export const retireConversationWork = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    const reason = boundedString(args.reason, "reason", { min: 1, max: 500 });
    // A conversation that never had a draft has no ask and no reserved
    // attempt to retire — the same guard `applyInboundContext` uses.
    if (conversation.currentDraftId === undefined) {
      return null;
    }
    await supersedeOpenDraftDecisions(ctx, conversation._id);
    // The retired counts are deliberately not returned: `sending.ts` imports
    // this module, so typing this call's result here would make the two
    // modules' inference circular. Nothing needs the numbers — the retiring
    // mutations record their own activity.
    await ctx.runMutation(internal.sending.cancelParkedConversationAttempts, {
      workspaceId: conversation.workspaceId,
      conversationId: conversation._id,
      reason,
    });
    return null;
  },
});
