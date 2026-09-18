/**
 * Workspace records, memberships and workspace policy — architecture §3.1/§5.
 *
 * `ensureWorkspace` is the idempotent onboarding entry point (the §5 contract
 * names this operation `bootstrap`; an alias is exported under that name).
 * Membership management is owner-only and never sends invitation email; there
 * is deliberately no public "join workspace" mutation.
 */
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  expectedUsersIssuer,
  getUserIdentity,
  requireUser,
  requireWorkspaceMember,
  requireWorkspaceOwner,
} from "./lib/auth";
import type { AuthCtx } from "./lib/auth";
import {
  assertIanaTimezone,
  boundedInt,
  boundedString,
  domainError,
  invalid,
  vRole,
} from "./lib/validators";
import type { CapabilityId, EmployeeTemplate } from "./lib/validators";
import { HOST_CAPABILITY_POLICY } from "./lib/validators";
import { membershipFields, workspaceFields } from "./schema";

export const vWorkspaceDoc = v.object({
  _id: v.id("workspaces"),
  _creationTime: v.number(),
  ...workspaceFields,
});

export const vMembershipDoc = v.object({
  _id: v.id("memberships"),
  _creationTime: v.number(),
  ...membershipFields,
});

/* ------------------------------------------------------------------ */
/* Employee templates created with every workspace                     */
/* ------------------------------------------------------------------ */

export type EmployeeSeed = {
  template: EmployeeTemplate;
  name: string;
  instructions: string;
  capabilities: readonly CapabilityId[];
};

/** Exported for the flag-gated demo bootstrap in `convex/demo.ts` (P16) —
 *  demo workspaces are provisioned with the same employee templates. */
export const EMPLOYEE_SEEDS: readonly EmployeeSeed[] = [
  {
    template: "scout",
    name: "Scout",
    instructions:
      "Discover up to five candidate companies matching the campaign's " +
      "confirmed source plan. Request paid contact enrichment only for " +
      "prospects the campaign qualified, and never invent contact details.",
    capabilities: HOST_CAPABILITY_POLICY.scout,
  },
  {
    template: "researcher",
    name: "Researcher",
    instructions:
      "Research assigned prospects through the workspace-owned website " +
      "research results. Record source URL, retrieval time and confidence " +
      "for every observation; label hypotheses and never claim absent " +
      "content as proof.",
    capabilities: HOST_CAPABILITY_POLICY.researcher,
  },
  {
    template: "outreach",
    name: "Outreach",
    instructions:
      "Propose exact draft emails and reply classifications for approved " +
      "prospects using saved evidence. Never send without a recorded human " +
      "approval decision.",
    capabilities: HOST_CAPABILITY_POLICY.outreach,
  },
];

/* ------------------------------------------------------------------ */
/* Provisioning                                                        */
/* ------------------------------------------------------------------ */

function defaultWorkspaceName(identity: UserIdentity): string {
  const display = identity.name ?? identity.email;
  if (display !== undefined) {
    const trimmed = display.trim().slice(0, 60);
    if (trimmed.length > 0) {
      return `${trimmed}'s workspace`;
    }
  }
  return "My workspace";
}

type EnsureWorkspaceArgs = {
  requestId?: string;
  name?: string;
  timezone?: string;
};

/**
 * Idempotent workspace provisioning: creates the workspace, the owner's
 * active membership and the three employee templates in one transaction.
 *
 * Idempotency is keyed on the verified identity: a second call — including a
 * retried request — returns the workspace the caller owns. Concurrent first
 * calls conflict on the `by_identityKey_and_status` index range and Convex
 * retries the losing transaction, which then observes the committed
 * membership. `requestId` is accepted for forward-compatible retries;
 * identity-keyed dedup already subsumes it, so it is intentionally not
 * persisted.
 *
 * A caller holding only NON-owner memberships (e.g. invited into someone
 * else's workspace) still gets their own workspace here — membership in
 * another workspace is not a substitute for ownership, and onboarding would
 * otherwise be a dead end for invited users.
 */
async function ensureWorkspaceImpl(
  ctx: MutationCtx,
  args: EnsureWorkspaceArgs,
): Promise<{ workspaceId: Id<"workspaces">; created: boolean }> {
  const { identity, identityKey } = await requireUser(ctx);

  const existing = await ctx.db
    .query("memberships")
    .withIndex("by_identityKey_and_status", (q) =>
      q.eq("identityKey", identityKey).eq("status", "active"),
    )
    .collect();
  // A DEMO workspace does not satisfy "already owns one" — opting into the
  // public demo must not strand the visitor without a real workspace (the
  // demo row itself is created by `demo.optIn`, not this path).
  const ownedMemberships = existing.filter(
    (membership) => membership.role === "owner",
  );
  for (const membership of ownedMemberships) {
    const workspace = await ctx.db.get("workspaces", membership.workspaceId);
    if (workspace !== null && workspace.demoMode !== true) {
      return { workspaceId: workspace._id, created: false };
    }
  }

  const name =
    args.name !== undefined
      ? boundedString(args.name, "name", { min: 1, max: 100 })
      : defaultWorkspaceName(identity);
  const timezone =
    args.timezone !== undefined ? assertIanaTimezone(args.timezone) : "UTC";

  const now = Date.now();
  const workspaceId = await ctx.db.insert("workspaces", {
    name,
    ownerIdentityKey: identityKey,
    timezone,
    // Conservative default: automation stays paused until the owner
    // completes onboarding and explicitly activates it.
    automationState: "paused",
    pauseReason: "onboarding_pending",
    policyVersion: 1,
    dailySendLimit: 10,
    sendWindow: {
      weekdays: [1, 2, 3, 4, 5],
      startMinute: 9 * 60,
      endMinute: 17 * 60,
    },
    demoMode: false,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert("memberships", {
    workspaceId,
    identityKey,
    role: "owner",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  for (const seed of EMPLOYEE_SEEDS) {
    await ctx.db.insert("employees", {
      workspaceId,
      template: seed.template,
      name: seed.name,
      instructions: seed.instructions,
      instructionVersion: 1,
      enabled: true,
      allowedCapabilities: [...seed.capabilities],
      updatedAt: now,
    });
  }

  return { workspaceId, created: true };
}

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

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * The caller's current workspace (first active membership, preferring owned)
 * plus their role, or `null` when signed out / anonymous / no membership.
 */
export const getCurrent = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      workspace: vWorkspaceDoc,
      role: vRole,
      membershipId: v.id("memberships"),
    }),
  ),
  handler: async (ctx) => {
    const identity = await getUserIdentity(ctx);
    if (identity === null || identity.issuer !== expectedUsersIssuer()) {
      return null;
    }
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_identityKey_and_status", (q) =>
        q.eq("identityKey", identity.tokenIdentifier).eq("status", "active"),
      )
      .collect();
    if (memberships.length === 0) {
      return null;
    }
    // Prefer the caller's REAL workspace: a demo-mode row is always created
    // first (optIn refuses anyone already owning one), so the insertion-ordered
    // `find` would resolve a demo+real owner to the demo forever — with no
    // workspace switcher in the app, that strands them on a workspace that
    // cannot connect a runtime.
    for (const entry of memberships) {
      if (entry.role !== "owner") {
        continue;
      }
      const candidate = await ctx.db.get("workspaces", entry.workspaceId);
      if (candidate !== null && candidate.demoMode !== true) {
        return {
          workspace: candidate,
          role: entry.role,
          membershipId: entry._id,
        };
      }
    }
    const membership =
      memberships.find((entry) => entry.role === "owner") ?? memberships[0];
    const workspace = await ctx.db.get("workspaces", membership.workspaceId);
    if (workspace === null) {
      return null;
    }
    return { workspace, role: membership.role, membershipId: membership._id };
  },
});

/** Workspace read for an active member. */
export const get = query({
  args: { workspaceId: v.id("workspaces") },
  returns: vWorkspaceDoc,
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceMember(ctx, args.workspaceId);
    return workspace;
  },
});

/** Active and revoked memberships of the caller's workspace. */
export const listMembers = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(vMembershipDoc),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await ctx.db
      .query("memberships")
      .withIndex("by_workspaceId_and_identityKey", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .collect();
  },
});

/* ------------------------------------------------------------------ */
/* Workspace settings                                                  */
/* ------------------------------------------------------------------ */

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
  returns: vWorkspaceDoc,
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
      return workspace;
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
      throw domainError("NOT_FOUND", "workspace not found");
    }
    return updated;
  },
});

function assertSendWindow(window: {
  weekdays: number[];
  startMinute: number;
  endMinute: number;
}): void {
  if (window.weekdays.length === 0 || window.weekdays.length > 7) {
    throw invalid("sendWindow.weekdays must contain 1–7 days");
  }
  const unique = new Set(window.weekdays);
  if (unique.size !== window.weekdays.length) {
    throw invalid("sendWindow.weekdays must not contain duplicates");
  }
  for (const day of window.weekdays) {
    boundedInt(day, "sendWindow.weekdays", { min: 0, max: 6 });
  }
  boundedInt(window.startMinute, "sendWindow.startMinute", {
    min: 0,
    max: 1439,
  });
  boundedInt(window.endMinute, "sendWindow.endMinute", { min: 0, max: 1439 });
  if (window.startMinute >= window.endMinute) {
    throw invalid("sendWindow.startMinute must precede endMinute");
  }
}

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
  returns: vWorkspaceDoc,
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceOwner(ctx, args.workspaceId);
    if (workspace.policyVersion !== args.expectedPolicyVersion) {
      throw domainError(
        "CONFLICT",
        `policyVersion is ${workspace.policyVersion}, not ${args.expectedPolicyVersion}`,
      );
    }
    const dailySendLimit =
      args.dailySendLimit !== undefined
        ? boundedInt(args.dailySendLimit, "dailySendLimit", {
            min: 1,
            max: 1000,
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
      return workspace;
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
      throw domainError("NOT_FOUND", "workspace not found");
    }
    return updated;
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
  returns: vWorkspaceDoc,
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
            throw domainError("NOT_FOUND", "workspace not found");
          }
          return updated;
        }
      }
      return workspace;
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
      throw domainError("NOT_FOUND", "workspace not found");
    }
    return updated;
  },
});

/* ------------------------------------------------------------------ */
/* Membership management (owner-only, no invitation email)             */
/* ------------------------------------------------------------------ */

async function countActiveOwners(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
): Promise<number> {
  const members = await ctx.db
    .query("memberships")
    .withIndex("by_workspaceId_and_identityKey", (q) =>
      q.eq("workspaceId", workspaceId),
    )
    .collect();
  return members.filter(
    (member) => member.status === "active" && member.role === "owner",
  ).length;
}

async function getMembershipInWorkspace(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
  membershipId: Id<"memberships">,
): Promise<Doc<"memberships">> {
  const membership = await ctx.db.get("memberships", membershipId);
  if (membership === null || membership.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "membership not found");
  }
  return membership;
}

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
          "cannot demote the last active workspace owner",
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
          "cannot revoke the last active workspace owner",
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
