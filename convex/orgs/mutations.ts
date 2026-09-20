/**
 * Org provisioning and policy writes.
 *
 * `ensureOrg` is the idempotent entry point that gives the active
 * organization its row (the §5 contract names this operation `bootstrap`; an
 * alias is exported under that name). There is nothing here that manages
 * members: the auth provider owns who belongs to an organization, and every
 * member of the active one may use the whole product (PLAN §4).
 */
import { mutation } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import { TRIAL_DAILY_SEND_LIMIT_MAX } from "../lib/limits";
import {
  assertIanaTimezone,
  boundedInt,
  boundedString,
  domainError,
} from "../lib/validators";
import {
  assertSendWindow,
  ensureOrgImpl,
  toOrgView,
  vOrgView,
} from "./model";
import { v } from "convex/values";

export const ensureOrg = mutation({
  args: {
    requestId: v.optional(v.string()),
    name: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  returns: v.object({
    orgId: v.id("orgs"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => await ensureOrgImpl(ctx, args),
});

/** §5 contract name for `ensureOrg`; identical behavior. */
export const bootstrap = mutation({
  args: {
    requestId: v.optional(v.string()),
    name: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  returns: v.object({
    orgId: v.id("orgs"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => await ensureOrgImpl(ctx, args),
});

/**
 * Rename / timezone change. A timezone change alters sending policy,
 * so it requires the current policy version and invalidates earlier approvals.
 */
export const update = mutation({
  args: {
    orgId: v.id("orgs"),
    name: v.optional(v.string()),
    timezone: v.optional(v.string()),
    expectedPolicyVersion: v.optional(v.number()),
  },
  returns: vOrgView,
  handler: async (ctx, args) => {
    const { org } = await requireOrgMember(ctx, args.orgId);
    // Validate first so bad values still error; skip the write entirely when
    // nothing would change so a no-op doesn't churn `updatedAt`.
    const name =
      args.name !== undefined
        ? boundedString(args.name, "name", { min: 1, max: 100 })
        : undefined;
    const timezone =
      args.timezone !== undefined ? assertIanaTimezone(args.timezone) : undefined;
    if (
      (name === undefined || name === org.name) &&
      (timezone === undefined || timezone === org.timezone)
    ) {
      return toOrgView(org);
    }
    const patch: {
      name?: string;
      timezone?: string;
      policyVersion?: number;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };
    if (name !== undefined && name !== org.name) {
      patch.name = name;
    }
    if (timezone !== undefined && timezone !== org.timezone) {
      if (args.expectedPolicyVersion !== org.policyVersion) {
        throw domainError(
          "CONFLICT",
          `timezone changes require policyVersion ${org.policyVersion}`,
        );
      }
      patch.timezone = timezone;
      patch.policyVersion = org.policyVersion + 1;
    }
    await ctx.db.patch("orgs", org._id, patch);
    const updated = await ctx.db.get("orgs", org._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    return toOrgView(updated);
  },
});

/**
 * Sending policy update guarded by `expectedPolicyVersion`; a stale
 * version returns `CONFLICT`. Bumps `policyVersion` on every applied change.
 */
export const setSendingPolicy = mutation({
  args: {
    orgId: v.id("orgs"),
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
  returns: vOrgView,
  handler: async (ctx, args) => {
    const { org } = await requireOrgMember(ctx, args.orgId);
    if (org.policyVersion !== args.expectedPolicyVersion) {
      throw domainError(
        "CONFLICT",
        `policyVersion is ${org.policyVersion}, not ${args.expectedPolicyVersion}`,
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
      (args.sendWindow.startMinute !== org.sendWindow.startMinute ||
        args.sendWindow.endMinute !== org.sendWindow.endMinute ||
        args.sendWindow.weekdays.length !==
          org.sendWindow.weekdays.length ||
        args.sendWindow.weekdays.some(
          (day, i) => day !== org.sendWindow.weekdays[i],
        ));
    if (
      (dailySendLimit === undefined ||
        dailySendLimit === org.dailySendLimit) &&
      !windowChanged
    ) {
      return toOrgView(org);
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
    } = { policyVersion: org.policyVersion + 1, updatedAt: Date.now() };
    if (dailySendLimit !== undefined) {
      patch.dailySendLimit = dailySendLimit;
    }
    if (args.sendWindow !== undefined) {
      patch.sendWindow = args.sendWindow;
    }
    await ctx.db.patch("orgs", org._id, patch);
    const updated = await ctx.db.get("orgs", org._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    return toOrgView(updated);
  },
});

/**
 * The org automation switch. Pausing records `pauseReason`;
 * activating clears it. Same-state calls are idempotent no-ops.
 */
export const setAutomationState = mutation({
  args: {
    orgId: v.id("orgs"),
    state: v.union(v.literal("active"), v.literal("paused")),
    reason: v.optional(v.string()),
  },
  returns: vOrgView,
  handler: async (ctx, args) => {
    const { org } = await requireOrgMember(ctx, args.orgId);
    if (org.automationState === args.state) {
      // Idempotent no-op — except a still-paused org may update its
      // recorded reason.
      if (args.state === "paused" && args.reason !== undefined) {
        const reason = boundedString(args.reason, "reason", {
          min: 1,
          max: 200,
        });
        if (reason !== org.pauseReason) {
          await ctx.db.patch("orgs", org._id, {
            pauseReason: reason,
            updatedAt: Date.now(),
          });
          const updated = await ctx.db.get("orgs", org._id);
          if (updated === null) {
            throw domainError("NOT_FOUND", "organization not found");
          }
          return toOrgView(updated);
        }
      }
      return toOrgView(org);
    }
    await ctx.db.patch("orgs", org._id, {
      automationState: args.state,
      pauseReason:
        args.state === "paused"
          ? args.reason !== undefined
            ? boundedString(args.reason, "reason", { min: 1, max: 200 })
            : "manual_pause"
          : undefined,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get("orgs", org._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    return toOrgView(updated);
  },
});
