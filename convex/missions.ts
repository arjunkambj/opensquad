/**
 * Missions — the durable unit of work on the Mission Control board
 * (architecture §4.2/§5/§6).
 *
 * `create` is owner/operator-gated and requires an active campaign with a
 * confirmed source plan; it freezes a bounded `inputSnapshot` (confirmed
 * brief/source plan, business-profile version+text, employee instruction
 * versions, policy version, requested outcome), dedupes on `requestId`, then
 * starts exactly one Workflow and stores its serializable ID.
 *
 * `listBoard` paginates each column independently (`{items, cursor,
 * hasMore}`); lifecycle mutations (`pause`/`resume`/`cancel`/`archive`/
 * `restore`) take `expectedVersion` and only perform validated transitions.
 * State → board column is derived — cards cannot be dragged into state.
 */
import {
  getStatus,
  sendEvent,
  start,
} from "@convex-dev/workflow";
import type { WorkflowId } from "@convex-dev/workflow";
import { mutation, query } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  requireWorkspaceEditor,
  requireWorkspaceMember,
} from "./lib/auth";
import type { AuthCtx } from "./lib/auth";
import {
  assertInputSnapshotSize,
  boundedLimit,
  boundedString,
  domainError,
  invalid,
  vBoardColumn,
  vMissionKind,
  vMissionPriority,
} from "./lib/validators";
import type { InputSnapshot, MissionState } from "./lib/validators";
import { recordActivityEvent } from "./activity";
import { vDecisionDoc } from "./decisions";
import {
  missionFields,
  missionProspectFields,
} from "./schema";
import { resumeEvent } from "./workflows/events";
import {
  cancelMissionWork,
  transitionMission,
} from "./workflows/steps";

export const vMissionDoc = v.object({
  _id: v.id("missions"),
  _creationTime: v.number(),
  ...missionFields,
});

export const vMissionProspectDoc = v.object({
  _id: v.id("missionProspects"),
  _creationTime: v.number(),
  ...missionProspectFields,
});

const vBoardPage = v.object({
  items: v.array(vMissionDoc),
  cursor: v.union(v.string(), v.null()),
  hasMore: v.boolean(),
});

/** Terminal mission states — nothing leaves them except archive/restore. */
const TERMINAL_STATES: readonly MissionState[] = ["completed", "cancelled"];

async function getMissionInWorkspace(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
  missionId: Id<"missions">,
): Promise<Doc<"missions">> {
  const mission = await ctx.db.get("missions", missionId);
  if (mission === null || mission.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "mission not found");
  }
  return mission;
}

function assertExpectedVersion(
  mission: Doc<"missions">,
  expectedVersion: number,
): void {
  if (mission.version !== expectedVersion) {
    throw domainError(
      "CONFLICT",
      `mission version is ${mission.version}, not ${expectedVersion}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* create                                                              */
/* ------------------------------------------------------------------ */

/**
 * Create and dispatch a sales-campaign mission (owner/operator).
 *
 * - requires an ACTIVE campaign with a confirmed source plan (§6.1);
 * - freezes the bounded `inputSnapshot` (≤64 KiB);
 * - `requestId` dedupes client retries; a second non-terminal sales mission
 *   on the same campaign is a semantic duplicate → `CONFLICT`;
 * - starts exactly one Workflow (currently the P06 dev-fixture pipeline —
 *   P09 swaps in the real stages) and stores its ID.
 */
export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    campaignId: v.id("campaigns"),
    kind: vMissionKind,
    title: v.string(),
    priority: v.optional(vMissionPriority),
    requestId: v.optional(v.string()),
  },
  returns: vMissionDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    if (args.kind !== "sales_campaign") {
      throw invalid(
        "reply and follow_up missions are created internally by inbound processing (P11); create supports sales_campaign",
      );
    }
    const campaign = await ctx.db.get("campaigns", args.campaignId);
    if (campaign === null || campaign.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "campaign not found");
    }
    if (campaign.status !== "active") {
      throw domainError(
        "CONFLICT",
        `campaign is ${campaign.status}; a mission requires an active campaign`,
      );
    }
    if (campaign.sourcePlan.confirmedBy === undefined) {
      throw domainError(
        "CONFLICT",
        "campaign source plan is not confirmed; confirm it before dispatching a mission",
      );
    }
    const title = boundedString(args.title, "title", { min: 1, max: 200 });
    const requestId =
      args.requestId === undefined
        ? undefined
        : boundedString(args.requestId, "requestId", { min: 1, max: 100 });

    if (requestId !== undefined) {
      const existing = await ctx.db
        .query("missions")
        .withIndex("by_workspaceId_and_requestId", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("requestId", requestId),
        )
        .unique();
      if (existing !== null) {
        return existing;
      }
    }

    // Semantic duplicate: one non-terminal sales mission per campaign.
    // .collect() — the eq-range is bounded by visible missions on ONE
    // campaign, and a capped scan could miss a live sibling past the cap.
    const siblings = await ctx.db
      .query("missions")
      .withIndex(
        "by_workspaceId_and_campaignId_and_boardColumn_and_updatedAt",
        (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("campaignId", args.campaignId)
            .eq("visibility", "visible"),
      )
      .collect();
    if (
      siblings.some(
        (m) =>
          m.kind === "sales_campaign" && !TERMINAL_STATES.includes(m.state),
      )
    ) {
      throw domainError(
        "CONFLICT",
        "an active sales_campaign mission already exists for this campaign",
      );
    }

    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (workspace === null) {
      throw domainError("NOT_FOUND", "workspace not found");
    }
    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    const employees = await Promise.all(
      (["scout", "researcher", "outreach"] as const).map(async (template) =>
        ctx.db
          .query("employees")
          .withIndex("by_workspaceId_and_template", (q) =>
            q
              .eq("workspaceId", args.workspaceId)
              .eq("template", template),
          )
          .unique(),
      ),
    );
    const scout = employees.find((e) => e !== null && e.template === "scout");
    if (scout === null || scout === undefined) {
      throw invalid("workspace has no scout employee to own the mission");
    }

    const inputSnapshot: InputSnapshot = {
      campaignTitle: campaign.title,
      campaignBrief: campaign.brief,
      briefVersion: campaign.briefVersion,
      sourcePlan: campaign.sourcePlan,
      ...(profile !== null
        ? {
            businessProfile: {
              version: profile.version,
              websiteUrl: profile.websiteUrl,
              offer: profile.offer,
              idealCustomer: profile.idealCustomer,
              tone: profile.tone,
              exclusions: profile.exclusions,
            },
          }
        : {}),
      employeeInstructions: employees
        .filter((e) => e !== null)
        .map((e) => ({
          employeeId: e._id,
          template: e.template,
          name: e.name,
          instructionVersion: e.instructionVersion,
        })),
      policyVersion: workspace.policyVersion,
      requestedOutcome: `Research up to ${campaign.leadLimit} prospects for "${campaign.title}" and prepare outreach drafts for human approval.`,
    };
    assertInputSnapshotSize(inputSnapshot);

    const now = Date.now();
    const missionId = await ctx.db.insert("missions", {
      workspaceId: args.workspaceId,
      campaignId: args.campaignId,
      kind: args.kind,
      title,
      state: "queued",
      boardColumn: "backlog",
      version: 1,
      inputSnapshot,
      inputVersion: 1,
      priority: args.priority ?? "normal",
      assignedEmployeeId: scout._id,
      progressSummary: "Queued — awaiting dispatch",
      requiredDecisionCount: 0,
      visibility: "visible",
      createdBy: identityKey,
      createdAt: now,
      updatedAt: now,
      workflowGeneration: 1,
      ...(requestId !== undefined ? { requestId } : {}),
    });

    // P06 machinery gate: the development-fixture pipeline proves the
    // durable contract (stages → branches → decision → wait → continuation).
    // P09 replaces the stage body with real discovery/research/draft steps.
    const workflowId = await start(
      ctx,
      internal.workflows.devFixture.devFixtureMissionWorkflow,
      { missionId },
      {
        startAsync: true,
        onComplete: internal.workflows.steps.onMissionWorkflowComplete,
        context: { missionId, workspaceId: args.workspaceId },
      },
    );
    await ctx.db.patch("missions", missionId, { workflowId });

    await recordActivityEvent(ctx, {
      workspaceId: args.workspaceId,
      missionId,
      kind: "mission_created",
      summary: `Mission created: "${title}"`,
      actor: identityKey,
      dedupeKey: `mission:${missionId}:created`,
    });

    const mission = await ctx.db.get("missions", missionId);
    if (mission === null) {
      throw domainError("NOT_FOUND", "mission not found");
    }
    return mission;
  },
});

/* ------------------------------------------------------------------ */
/* reads                                                               */
/* ------------------------------------------------------------------ */

/** Mission detail: the row plus its open asks and prospect branches. */
export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    missionId: v.id("missions"),
  },
  returns: v.object({
    mission: vMissionDoc,
    openDecisions: v.array(vDecisionDoc),
    prospects: v.array(vMissionProspectDoc),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const mission = await getMissionInWorkspace(
      ctx,
      args.workspaceId,
      args.missionId,
    );
    const openDecisions = await ctx.db
      .query("decisions")
      .withIndex("by_missionId_and_state", (q) =>
        q.eq("missionId", mission._id).eq("state", "open"),
      )
      .collect();
    const prospects = await ctx.db
      .query("missionProspects")
      .withIndex("by_missionId_and_prospectId", (q) =>
        q.eq("missionId", mission._id),
      )
      .take(100);
    return { mission, openDecisions, prospects };
  },
});

/**
 * One board column, most recently updated first. Cursor-paginated
 * independently per column; `campaignId` optionally scopes to one campaign.
 * Older active missions are never hidden by an activity-date filter — the
 * index is on `updatedAt`, not on last activity.
 */
export const listBoard = query({
  args: {
    workspaceId: v.id("workspaces"),
    campaignId: v.optional(v.id("campaigns")),
    column: vBoardColumn,
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: vBoardPage,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const limit = boundedLimit(args.limit);
    const result =
      args.campaignId === undefined
        ? await ctx.db
            .query("missions")
            .withIndex(
              "by_workspaceId_and_visibility_and_boardColumn_and_updatedAt",
              (q) =>
                q
                  .eq("workspaceId", args.workspaceId)
                  .eq("visibility", "visible")
                  .eq("boardColumn", args.column),
            )
            .order("desc")
            .paginate({ numItems: limit, cursor: args.cursor ?? null })
        : await ctx.db
            .query("missions")
            .withIndex(
              "by_workspaceId_and_campaignId_and_boardColumn_and_updatedAt",
              (q) =>
                q
                  .eq("workspaceId", args.workspaceId)
                  .eq("campaignId", args.campaignId!)
                  .eq("visibility", "visible")
                  .eq("boardColumn", args.column),
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

/* ------------------------------------------------------------------ */
/* lifecycle                                                           */
/* ------------------------------------------------------------------ */

/**
 * Pause new stage dispatch (owner/operator). Idempotent; a parked workflow
 * re-checks at its next gate and a workflow mid-wait stays parked.
 */
export const pause = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    missionId: v.id("missions"),
    expectedVersion: v.number(),
  },
  returns: vMissionDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    const mission = await getMissionInWorkspace(
      ctx,
      args.workspaceId,
      args.missionId,
    );
    // Idempotent retry: a pause that already committed returns the doc —
    // checking the version first would CONFLICT a retried request.
    if (mission.state === "paused") {
      return mission;
    }
    assertExpectedVersion(mission, args.expectedVersion);
    if (
      !(
        mission.state === "queued" ||
        mission.state === "active" ||
        mission.state === "waiting_for_user" ||
        mission.state === "waiting_for_runtime"
      )
    ) {
      throw domainError(
        "CONFLICT",
        `mission is ${mission.state}; only queued, active or waiting work can pause`,
      );
    }
    const updated = await transitionMission(ctx, mission, "paused", {
      actor: identityKey,
      summary: "Mission paused",
      patch: { progressSummary: "Paused" },
    });
    return updated;
  },
});

/**
 * Resume a paused mission (owner/operator). The target state is recomputed —
 * an open required ask returns the card to Needs you — and the parked
 * workflow is woken with its durable resume event.
 */
export const resume = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    missionId: v.id("missions"),
    expectedVersion: v.number(),
  },
  returns: vMissionDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    const mission = await getMissionInWorkspace(
      ctx,
      args.workspaceId,
      args.missionId,
    );
    // Idempotent retry: a resume that already committed lands on `active`
    // or `waiting_for_user` — return the doc instead of CONFLICT.
    if (
      mission.state === "active" ||
      mission.state === "waiting_for_user"
    ) {
      return mission;
    }
    assertExpectedVersion(mission, args.expectedVersion);
    if (mission.state !== "paused") {
      throw domainError(
        "CONFLICT",
        `mission is ${mission.state}; only paused missions resume`,
      );
    }
    const target: MissionState =
      mission.requiredDecisionCount > 0 ? "waiting_for_user" : "active";
    const updated = await transitionMission(ctx, mission, target, {
      actor: identityKey,
      summary: "Mission resumed",
      patch: {
        progressSummary:
          target === "waiting_for_user"
            ? "Waiting on a required decision"
            : "Running",
      },
    });
    if (mission.workflowId !== undefined) {
      const status = await getStatus(
        ctx,
        components.workflow,
        mission.workflowId as WorkflowId,
      );
      if (status.type === "inProgress") {
        try {
          await sendEvent(ctx, components.workflow, {
            workflowId: mission.workflowId as WorkflowId,
            name: resumeEvent.name,
            validator: resumeEvent.validator,
            value: { resumedAt: Date.now() },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            !message.includes("Event already sent") &&
            !message.includes("Event already consumed")
          ) {
            throw error;
          }
        }
      }
    }
    return updated;
  },
});

/**
 * Cancel a mission (owner/operator): retires open asks, cancels the owning
 * workflow and any in-flight prospect-branch children, sweeps in-flight
 * runs and lands on `cancelled` (→ Backlog). Idempotent; `completed`
 * missions cannot be cancelled.
 */
export const cancel = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    missionId: v.id("missions"),
    expectedVersion: v.number(),
  },
  returns: vMissionDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    const mission = await getMissionInWorkspace(
      ctx,
      args.workspaceId,
      args.missionId,
    );
    if (mission.state === "cancelled") {
      return mission;
    }
    assertExpectedVersion(mission, args.expectedVersion);
    if (mission.state === "completed") {
      throw domainError(
        "CONFLICT",
        "mission is completed; it cannot be cancelled",
      );
    }
    return await cancelMissionWork(ctx, mission, identityKey);
  },
});

/**
 * Hide a terminal mission from the board (owner/operator). Archive is
 * visibility only — active or waiting work must be cancelled or completed
 * first; it never means execution succeeded.
 */
export const archive = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    missionId: v.id("missions"),
    expectedVersion: v.number(),
  },
  returns: vMissionDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    const mission = await getMissionInWorkspace(
      ctx,
      args.workspaceId,
      args.missionId,
    );
    if (mission.visibility === "archived") {
      return mission;
    }
    assertExpectedVersion(mission, args.expectedVersion);
    if (
      !(
        mission.state === "completed" ||
        mission.state === "cancelled" ||
        mission.state === "failed"
      )
    ) {
      throw domainError(
        "CONFLICT",
        `mission is ${mission.state}; active or waiting work cannot be archived — cancel or complete it first`,
      );
    }
    await ctx.db.patch("missions", mission._id, {
      visibility: "archived",
      version: mission.version + 1,
      updatedAt: Date.now(),
    });
    await recordActivityEvent(ctx, {
      workspaceId: args.workspaceId,
      missionId: mission._id,
      kind: "mission_archived",
      summary: `Mission archived: "${mission.title}"`,
      actor: identityKey,
      dedupeKey: `mission:${mission._id}:archived`,
    });
    const updated = await ctx.db.get("missions", mission._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "mission not found");
    }
    return updated;
  },
});

/** Restore an archived mission to the board (owner/operator). Idempotent. */
export const restore = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    missionId: v.id("missions"),
    expectedVersion: v.number(),
  },
  returns: vMissionDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    const mission = await getMissionInWorkspace(
      ctx,
      args.workspaceId,
      args.missionId,
    );
    if (mission.visibility === "visible") {
      return mission;
    }
    assertExpectedVersion(mission, args.expectedVersion);
    await ctx.db.patch("missions", mission._id, {
      visibility: "visible",
      version: mission.version + 1,
      updatedAt: Date.now(),
    });
    await recordActivityEvent(ctx, {
      workspaceId: args.workspaceId,
      missionId: mission._id,
      kind: "mission_restored",
      summary: `Mission restored: "${mission.title}"`,
      actor: identityKey,
      dedupeKey: `mission:${mission._id}:restored`,
    });
    const updated = await ctx.db.get("missions", mission._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "mission not found");
    }
    return updated;
  },
});


