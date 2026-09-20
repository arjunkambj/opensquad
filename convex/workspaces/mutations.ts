/**
 * Workspace provisioning, policy and membership writes.
 *
 * `ensureWorkspace` is the idempotent onboarding entry point (the §5 contract
 * names this operation `bootstrap`; an alias is exported under that name).
 * Membership management is owner-only and never sends invitation email; there
 * is deliberately no public "join workspace" mutation.
 */
import { mutation } from "../_generated/server";
import { requireWorkspaceOwner } from "../lib/auth";
import { TRIAL_DAILY_SEND_LIMIT_MAX } from "../lib/limits";
import {
  assertIanaTimezone,
  boundedInt,
  boundedString,
  domainError,
  invalid,
  vRole,
} from "../lib/validators";
import {
  assertSendWindow,
  countActiveOwners,
  ensureWorkspaceImpl,
  getMembershipInWorkspace,
  vMembershipDoc,
  toWorkspaceView,
  vWorkspaceView,
} from "./model";
import { v } from "convex/values";

export const ensureWorkspace = mutation({
  args: {
    requestId: v.optional(v.string()),
    name: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  returns: v.object({
    workspaceId: v.id("workspaces"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => await ensureWorkspaceImpl(ctx, args),
});

/** §5 contract name for `ensureWorkspace`; identical behavior. */
export const bootstrap = mutation({
  args: {
    requestId: v.optional(v.string()),
    name: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  returns: v.object({
    workspaceId: v.id("workspaces"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => await ensureWorkspaceImpl(ctx, args),
});

/**
 * Owner-only rename/timezone change. A timezone change alters sending policy,
 * so it requires the current policy version and invalidates earlier approvals.
 */
export const update = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.optional(v.string()),
    timezone: v.optional(v.string()),
    expectedPolicyVersion: v.optional(v.number()),
  },
  returns: vWorkspaceView,
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceOwner(ctx, args.workspaceId);
    // Validate first so bad values still error; skip the write entirely when
    // nothing would change so a no-op doesn't churn `updatedAt`.
    const name =
      args.name !== undefined
        ? boundedString(args.name, "name", { min: 1, max: 100 })
        : undefined;
    const timezone =
      args.timezone !== undefined ? assertIanaTimezone(args.timezone) : undefined;
    if (
      (name === undefined || name === workspace.name) &&
      (timezone === undefined || timezone === workspace.timezone)
    ) {
      return toWorkspaceView(workspace);
    }
    const patch: {
      name?: string;
      timezone?: string;
      policyVersion?: number;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };
    if (name !== undefined && name !== workspace.name) {
      patch.name = name;
    }
    if (timezone !== undefined && timezone !== workspace.timezone) {
      if (args.expectedPolicyVersion !== workspace.policyVersion) {
        throw domainError(
          "CONFLICT",
          `timezone changes require policyVersion ${workspace.policyVersion}`,
        );
      }
      patch.timezone = timezone;
      patch.policyVersion = workspace.policyVersion + 1;
    }
    await ctx.db.patch("workspaces", workspace._id, patch);
    const updated = await ctx.db.get("workspaces", workspace._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    return toWorkspaceView(updated);
  },
});

/**
 * Owner-only sending policy update guarded by `expectedPolicyVersion`; a stale
 * version returns `CONFLICT`. Bumps `policyVersion` on every applied change.
 */
export const setSendingPolicy = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    expectedPolicyVersion: v.number(),
    dailySendLimit: v.optional(v.number()),
    sendWindow: v.optional(
      v.object({
        weekdays: v.array(v.number()),
        startMinute: v.number(),
        endMinute: v.number(),
      }),
    ),
  },
  returns: vWorkspaceView,
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceOwner(ctx, args.workspaceId);
    if (workspace.policyVersion !== args.expectedPolicyVersion) {
      throw domainError(
        "CONFLICT",
        `policyVersion is ${workspace.policyVersion}, not ${args.expectedPolicyVersion}`,
      );
    }
    // PLAN §6 layer 2: the trial's daily send ceiling is 30, whatever the
    // owner types — the send allowance is a cap, not a preference.
    const dailySendLimit =
      args.dailySendLimit !== undefined
        ? boundedInt(args.dailySendLimit, "dailySendLimit", {
            min: 1,
            max: TRIAL_DAILY_SEND_LIMIT_MAX,
          })
        : undefined;
    if (args.sendWindow !== undefined) {
      assertSendWindow(args.sendWindow);
    }
    // Skip the write when nothing changes — a policyVersion bump invalidates
    // every pending approved draft, so a re-save must not produce one.
    const windowChanged =
      args.sendWindow !== undefined &&
      (args.sendWindow.startMinute !== workspace.sendWindow.startMinute ||
        args.sendWindow.endMinute !== workspace.sendWindow.endMinute ||
        args.sendWindow.weekdays.length !==
          workspace.sendWindow.weekdays.length ||
        args.sendWindow.weekdays.some(
          (day, i) => day !== workspace.sendWindow.weekdays[i],
        ));
    if (
      (dailySendLimit === undefined ||
        dailySendLimit === workspace.dailySendLimit) &&
      !windowChanged
    ) {
      return toWorkspaceView(workspace);
    }
    const patch: {
      dailySendLimit?: number;
      sendWindow?: {
        weekdays: number[];
        startMinute: number;
        endMinute: number;
      };
      policyVersion: number;
      updatedAt: number;
    } = { policyVersion: workspace.policyVersion + 1, updatedAt: Date.now() };
    if (dailySendLimit !== undefined) {
      patch.dailySendLimit = dailySendLimit;
    }
    if (args.sendWindow !== undefined) {
      patch.sendWindow = args.sendWindow;
    }
    await ctx.db.patch("workspaces", workspace._id, patch);
    const updated = await ctx.db.get("workspaces", workspace._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    return toWorkspaceView(updated);
  },
});

/**
 * Owner-only workspace automation switch. Pausing records `pauseReason`;
 * activating clears it. Same-state calls are idempotent no-ops.
 */
export const setAutomationState = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    state: v.union(v.literal("active"), v.literal("paused")),
    reason: v.optional(v.string()),
  },
  returns: vWorkspaceView,
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceOwner(ctx, args.workspaceId);
    if (workspace.automationState === args.state) {
      // Idempotent no-op — except a still-paused workspace may update its
      // recorded reason.
      if (args.state === "paused" && args.reason !== undefined) {
        const reason = boundedString(args.reason, "reason", {
          min: 1,
          max: 200,
        });
        if (reason !== workspace.pauseReason) {
          await ctx.db.patch("workspaces", workspace._id, {
            pauseReason: reason,
            updatedAt: Date.now(),
          });
          const updated = await ctx.db.get("workspaces", workspace._id);
          if (updated === null) {
            throw domainError("NOT_FOUND", "organization not found");
          }
          return toWorkspaceView(updated);
        }
      }
      return toWorkspaceView(workspace);
    }
    await ctx.db.patch("workspaces", workspace._id, {
      automationState: args.state,
      pauseReason:
        args.state === "paused"
          ? args.reason !== undefined
            ? boundedString(args.reason, "reason", { min: 1, max: 200 })
            : "manual_pause"
          : undefined,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get("workspaces", workspace._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    return toWorkspaceView(updated);
  },
});

/** Owner-only role change; the last active owner cannot be demoted. */
export const setMemberRole = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    membershipId: v.id("memberships"),
    role: vRole,
  },
  returns: vMembershipDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceOwner(ctx, args.workspaceId);
    const membership = await getMembershipInWorkspace(
      ctx,
      args.workspaceId,
      args.membershipId,
    );
    if (membership.status !== "active") {
      throw invalid("membership is not active");
    }
    if (membership.role === args.role) {
      return membership;
    }
    if (membership.role === "owner" && args.role !== "owner") {
      const owners = await countActiveOwners(ctx, args.workspaceId);
      if (owners <= 1) {
        throw domainError(
          "CONFLICT",
          "cannot demote the last active organization owner",
        );
      }
    }
    await ctx.db.patch("memberships", membership._id, {
      role: args.role,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get("memberships", membership._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "membership not found");
    }
    return updated;
  },
});

/** Owner-only revocation; the last active owner cannot be removed. */
export const revokeMembership = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    membershipId: v.id("memberships"),
  },
  returns: vMembershipDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceOwner(ctx, args.workspaceId);
    const membership = await getMembershipInWorkspace(
      ctx,
      args.workspaceId,
      args.membershipId,
    );
    if (membership.status !== "active") {
      return membership;
    }
    if (membership.role === "owner") {
      const owners = await countActiveOwners(ctx, args.workspaceId);
      if (owners <= 1) {
        throw domainError(
          "CONFLICT",
          "cannot revoke the last active organization owner",
        );
      }
    }
    await ctx.db.patch("memberships", membership._id, {
      status: "revoked",
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get("memberships", membership._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "membership not found");
    }
    return updated;
  },
});
