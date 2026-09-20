/**
 * Workspaces — architecture §3.1/§5.
 *
 * This domain owns the workspace record, its memberships and the workspace
 * policy every other domain reads (timezone, send window, automation state,
 * webhook token). It owns no agent, lead or sending behaviour: it only says
 * who may act in a workspace and under which policy.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createDraftAgent } from "../agents/model";
import { trialCapacityOpen } from "../billing/platformBudgets";
import { grantTrialBuckets } from "../billing/trialBuckets";
import { requireVerifiedUser } from "../lib/auth";
import type { AuthCtx } from "../lib/auth";
import {
  assertIanaTimezone,
  boundedInt,
  boundedString,
  domainError,
  invalid,
  WEBHOOK_TOKEN_LENGTH,
} from "../lib/validators";
import { membershipFields, workspaceFields } from "../schema";
import type { UserIdentity } from "convex/server";
import { v } from "convex/values";

export const vWorkspaceDoc = v.object({
  _id: v.id("workspaces"),
  _creationTime: v.number(),
  ...workspaceFields,
});

/**
 * What a member's browser may see of a workspace. `webhookToken` is the only
 * thing that resolves an inbound mail request to this workspace (PLAN §9.4),
 * so it and the provider's webhook id never leave the server.
 */
const {
  webhookToken: _webhookTokenField,
  agentmailWebhookId: _webhookIdField,
  ...workspaceViewFields
} = workspaceFields;

export const vWorkspaceView = v.object({
  _id: v.id("workspaces"),
  _creationTime: v.number(),
  ...workspaceViewFields,
});

export function toWorkspaceView(workspace: Doc<"workspaces">) {
  const {
    webhookToken: _webhookToken,
    agentmailWebhookId: _webhookId,
    ...view
  } = workspace;
  return view;
}

export const vMembershipDoc = v.object({
  _id: v.id("memberships"),
  _creationTime: v.number(),
  ...membershipFields,
});

/**
 * The opaque token in this workspace's inbound webhook path. Generated from
 * the runtime CSPRNG and never derived from anything a caller can see: the
 * path is the ONLY thing that resolves an inbound request to a workspace, so
 * a guessable token would be a way in (PLAN §9.4).
 */
export function generateWebhookToken(): string {
  const bytes = new Uint8Array(WEBHOOK_TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

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
 * Idempotent workspace provisioning: ONE transaction creates the workspace,
 * the owner's active membership, the trial credit grant and the draft agent
 * onboarding fills in. All four or none — a workspace that existed for an
 * instant without an allowance could spend nothing, and one without an agent
 * would have nowhere to save an onboarding answer.
 *
 * Three rules from PLAN §6 "Closing the ways in" meet here:
 *   VERIFIED EMAIL. `requireVerifiedUser`, only on this path; every other
 *   entry point keeps `requireUser`.
 *   ONE TRIAL WORKSPACE PER USER. The first workspace the caller already owns
 *   IS their workspace, and this call returns it instead of making a second.
 *   TRIAL CAPACITY. `MAX_TRIAL_WORKSPACES` refuses a NEW workspace once the
 *   platform is full; an existing owner is returned theirs regardless, so the
 *   cap never locks anyone out of what they already have.
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
export async function ensureWorkspaceImpl(
  ctx: MutationCtx,
  args: EnsureWorkspaceArgs,
): Promise<{ workspaceId: Id<"workspaces">; created: boolean }> {
  const { identity, identityKey } = await requireVerifiedUser(ctx);

  const existing = await ctx.db
    .query("memberships")
    .withIndex("by_identityKey_and_status", (q) =>
      q.eq("identityKey", identityKey).eq("status", "active"),
    )
    .collect();
  // One workspace per user (PLAN §6): the first owned workspace the caller
  // already holds IS their workspace, and this call returns it.
  const ownedMemberships = existing.filter(
    (membership) => membership.role === "owner",
  );
  for (const membership of ownedMemberships) {
    const workspace = await ctx.db.get("workspaces", membership.workspaceId);
    if (workspace !== null) {
      return { workspaceId: workspace._id, created: false };
    }
  }

  // Only a NEW workspace is subject to the platform's signup capacity.
  if (!(await trialCapacityOpen(ctx))) {
    throw domainError(
      "TRIAL_CAPACITY_REACHED",
      "the trial is full; new workspaces are waitlisted",
    );
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
    plan: "trial",
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
    // No inbox yet: the agent starts in sourcing-only mode and the owner
    // connects their own key from onboarding or Settings (PLAN §4).
    inboxConnection: "none",
    // The opaque path token of this workspace's inbound webhook route. It is
    // generated once, here, from the runtime CSPRNG — never derived from the
    // workspace id, which is not secret.
    webhookToken: generateWebhookToken(),
    // No verified open event has been seen, so the Agent card shows no
    // "Opened" column at all (PLAN §9.6).
    opensObserved: false,
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

  // The trial grant is part of creating the workspace, never implied and
  // never lazy: no bucket means every paid call refuses (PLAN §6).
  await grantTrialBuckets(ctx, workspaceId);

  // The one draft agent, so onboarding progress always has a home.
  await createDraftAgent(ctx, workspaceId);

  return { workspaceId, created: true };
}

export function assertSendWindow(window: {
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

export async function countActiveOwners(
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

export async function getMembershipInWorkspace(
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
