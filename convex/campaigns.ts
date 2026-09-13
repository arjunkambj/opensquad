/**
 * Campaigns — architecture §4.1/§5. Typed source plans are validated here;
 * `confirmSourcePlan` freezes the confirmed scope (sources, confirmation
 * actor/time and the bound brief version) and `setState` walks the
 * draft|active|paused|completed state machine. Only a confirmed plan may
 * reach `active`. These are the APIs P08 consumes; P09 adds execution.
 */
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireWorkspaceEditor, requireWorkspaceMember } from "./lib/auth";
import type { AuthCtx } from "./lib/auth";
import {
  assertSourcesEnabled,
  assertValidSourceConfigs,
  boundedInt,
  boundedLimit,
  boundedString,
  CAMPAIGN_ENRICHMENT_LIMIT_MAX,
  CAMPAIGN_ENRICHMENT_LIMIT_MIN,
  CAMPAIGN_LEAD_LIMIT_MAX,
  CAMPAIGN_LEAD_LIMIT_MIN,
  domainError,
  invalid,
  vCampaignStatus,
  vSourceConfig,
} from "./lib/validators";
import type { CampaignStatus } from "./lib/validators";
import { campaignFields } from "./schema";

export const vCampaignDoc = v.object({
  _id: v.id("campaigns"),
  _creationTime: v.number(),
  ...campaignFields,
});

const CAMPAIGN_TRANSITIONS: Readonly<
  Record<CampaignStatus, readonly CampaignStatus[]>
> = {
  draft: ["active", "completed"],
  active: ["paused", "completed"],
  paused: ["active", "completed"],
  completed: [],
};

async function getCampaignInWorkspace(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
  campaignId: Id<"campaigns">,
): Promise<Doc<"campaigns">> {
  const campaign = await ctx.db.get("campaigns", campaignId);
  if (campaign === null || campaign.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "campaign not found");
  }
  return campaign;
}

/**
 * Create a draft campaign. `sourcePlan.instruction` preserves the operator's
 * original scope text; `sources` optionally carries the interpreted typed
 * proposal pending `confirmSourcePlan`.
 */
export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    brief: v.string(),
    sourcePlan: v.object({
      instruction: v.string(),
      sources: v.optional(v.array(vSourceConfig)),
    }),
    leadLimit: v.number(),
    enrichmentLimit: v.number(),
    requestId: v.optional(v.string()),
  },
  returns: vCampaignDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);

    const title = boundedString(args.title, "title", { min: 1, max: 200 });
    const brief = boundedString(args.brief, "brief", { min: 1, max: 8000 });
    const instruction = boundedString(
      args.sourcePlan.instruction,
      "sourcePlan.instruction",
      { min: 1, max: 4000 },
    );
    const sources = args.sourcePlan.sources ?? [];
    if (sources.length > 0) {
      assertValidSourceConfigs(sources);
    }
    const leadLimit = boundedInt(args.leadLimit, "leadLimit", {
      min: CAMPAIGN_LEAD_LIMIT_MIN,
      max: CAMPAIGN_LEAD_LIMIT_MAX,
    });
    const enrichmentLimit = boundedInt(args.enrichmentLimit, "enrichmentLimit", {
      min: CAMPAIGN_ENRICHMENT_LIMIT_MIN,
      max: CAMPAIGN_ENRICHMENT_LIMIT_MAX,
    });

    const now = Date.now();
    const campaignId = await ctx.db.insert("campaigns", {
      workspaceId: args.workspaceId,
      title,
      brief,
      briefVersion: 1,
      sourcePlan: { instruction, sources },
      leadLimit,
      enrichmentLimit,
      status: "draft",
      createdBy: identityKey,
      createdAt: now,
      updatedAt: now,
    });
    const campaign = await ctx.db.get("campaigns", campaignId);
    if (campaign === null) {
      throw domainError("NOT_FOUND", "campaign not found");
    }
    return campaign;
  },
});

/** One campaign; foreign or cross-workspace IDs return `NOT_FOUND`. */
export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    campaignId: v.id("campaigns"),
  },
  returns: vCampaignDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await getCampaignInWorkspace(ctx, args.workspaceId, args.campaignId);
  },
});

/**
 * Indexed, bounded campaign list for the workspace, optionally filtered by
 * status through `by_workspaceId_and_status`. `limit` defaults to 25 and is
 * hard-capped at 50; `hasMore` reports truncation.
 */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    status: v.optional(vCampaignStatus),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vCampaignDoc),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const limit = boundedLimit(args.limit);
    const rows = await ctx.db
      .query("campaigns")
      .withIndex("by_workspaceId_and_status", (q) =>
        args.status === undefined
          ? q.eq("workspaceId", args.workspaceId)
          : q.eq("workspaceId", args.workspaceId).eq("status", args.status),
      )
      .take(limit + 1);
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  },
});

/**
 * Confirm the interpreted source plan: validates the typed configs, rejects
 * sources whose extraction gate has not passed, and stamps the immutable
 * confirmation metadata (actor, time and the bound brief version). A second
 * confirmation — or any call on a non-draft campaign — returns `CONFLICT`;
 * changing scope requires a new campaign.
 */
export const confirmSourcePlan = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    campaignId: v.id("campaigns"),
    expectedBriefVersion: v.number(),
    instruction: v.optional(v.string()),
    sources: v.array(vSourceConfig),
  },
  returns: vCampaignDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const campaign = await getCampaignInWorkspace(
      ctx,
      args.workspaceId,
      args.campaignId,
    );

    if (campaign.status !== "draft") {
      throw domainError(
        "CONFLICT",
        `campaign is ${campaign.status}; only a draft can confirm its source plan`,
      );
    }
    if (campaign.sourcePlan.confirmedBy !== undefined) {
      throw domainError(
        "CONFLICT",
        "source plan is already confirmed; confirmed scope is immutable",
      );
    }
    if (campaign.briefVersion !== args.expectedBriefVersion) {
      throw domainError(
        "CONFLICT",
        `briefVersion is ${campaign.briefVersion}, not ${args.expectedBriefVersion}`,
      );
    }

    const instruction =
      args.instruction !== undefined
        ? boundedString(args.instruction, "instruction", {
            min: 1,
            max: 4000,
          })
        : campaign.sourcePlan.instruction;
    assertValidSourceConfigs(args.sources);
    assertSourcesEnabled(args.sources);

    await ctx.db.patch("campaigns", campaign._id, {
      sourcePlan: {
        instruction,
        sources: args.sources,
        confirmedBy: identityKey,
        confirmedAt: Date.now(),
        confirmedBriefVersion: campaign.briefVersion,
      },
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get("campaigns", campaign._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "campaign not found");
    }
    return updated;
  },
});

/**
 * Move a campaign along draft → active → paused/completed. Reaching `active`
 * requires a confirmed source plan. Same-state calls are idempotent no-ops;
 * illegal transitions return `CONFLICT` naming the current status.
 */
export const setState = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    campaignId: v.id("campaigns"),
    state: vCampaignStatus,
  },
  returns: vCampaignDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const campaign = await getCampaignInWorkspace(
      ctx,
      args.workspaceId,
      args.campaignId,
    );

    if (campaign.status === args.state) {
      return campaign;
    }
    if (!CAMPAIGN_TRANSITIONS[campaign.status].includes(args.state)) {
      throw domainError(
        "CONFLICT",
        `campaign cannot move from ${campaign.status} to ${args.state}`,
      );
    }
    if (args.state === "active" && campaign.sourcePlan.confirmedBy === undefined) {
      throw invalid(
        "campaign requires a confirmed source plan before activation",
      );
    }

    await ctx.db.patch("campaigns", campaign._id, {
      status: args.state,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get("campaigns", campaign._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "campaign not found");
    }
    return updated;
  },
});
