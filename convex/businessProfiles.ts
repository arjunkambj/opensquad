/**
 * Business profile — one current record per workspace (architecture §4.1).
 * Reads require any active member; writes require owner or operator and use
 * `expectedVersion` optimistic concurrency. Meaningful edits increment
 * `version`; `updatedBy` always records the authenticated actor.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspaceEditor, requireWorkspaceMember } from "./lib/auth";
import {
  boundedString,
  boundedStringList,
  domainError,
  normalizeHttpUrl,
} from "./lib/validators";
import { businessProfileFields } from "./schema";

export const vBusinessProfileDoc = v.object({
  _id: v.id("businessProfiles"),
  _creationTime: v.number(),
  ...businessProfileFields,
});

/** The workspace's current profile, or `null` before onboarding saves one. */
export const get = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(vBusinessProfileDoc, v.null()),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await ctx.db
      .query("businessProfiles")
      .withIndex("by_workspaceId", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .unique();
  },
});

/**
 * Create-or-update the profile. Pass `expectedVersion: 0` when no profile may
 * exist yet, or the current `version` to update. A stale version returns
 * `CONFLICT` with the authoritative record untouched.
 */
export const update = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    expectedVersion: v.number(),
    websiteUrl: v.string(),
    offer: v.string(),
    idealCustomer: v.string(),
    tone: v.string(),
    exclusions: v.array(v.string()),
  },
  returns: vBusinessProfileDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);

    const websiteUrl = normalizeHttpUrl(args.websiteUrl, "websiteUrl");
    const offer = boundedString(args.offer, "offer", { min: 1, max: 2000 });
    const idealCustomer = boundedString(args.idealCustomer, "idealCustomer", {
      min: 1,
      max: 2000,
    });
    const tone = boundedString(args.tone, "tone", { min: 1, max: 500 });
    const exclusions = boundedStringList(args.exclusions, "exclusions", {
      maxItems: 50,
      itemMax: 200,
    });

    const existing = await ctx.db
      .query("businessProfiles")
      .withIndex("by_workspaceId", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .unique();

    const now = Date.now();
    if (existing === null) {
      if (args.expectedVersion !== 0) {
        throw domainError(
          "CONFLICT",
          "no business profile exists; expectedVersion must be 0",
        );
      }
      const id = await ctx.db.insert("businessProfiles", {
        workspaceId: args.workspaceId,
        websiteUrl,
        offer,
        idealCustomer,
        tone,
        exclusions,
        version: 1,
        updatedAt: now,
        updatedBy: identityKey,
      });
      const created = await ctx.db.get("businessProfiles", id);
      if (created === null) {
        throw domainError("NOT_FOUND", "business profile not found");
      }
      return created;
    }

    if (existing.version !== args.expectedVersion) {
      throw domainError(
        "CONFLICT",
        `business profile version is ${existing.version}, not ${args.expectedVersion}`,
      );
    }

    const changed =
      existing.websiteUrl !== websiteUrl ||
      existing.offer !== offer ||
      existing.idealCustomer !== idealCustomer ||
      existing.tone !== tone ||
      existing.exclusions.length !== exclusions.length ||
      existing.exclusions.some((value, index) => value !== exclusions[index]);

    await ctx.db.patch("businessProfiles", existing._id, {
      websiteUrl,
      offer,
      idealCustomer,
      tone,
      exclusions,
      version: changed ? existing.version + 1 : existing.version,
      updatedAt: now,
      updatedBy: identityKey,
    });
    const updated = await ctx.db.get("businessProfiles", existing._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "business profile not found");
    }
    return updated;
  },
});
