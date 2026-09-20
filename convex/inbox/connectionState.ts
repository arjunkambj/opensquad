/**
 * Manage inbox — the state transitions (PLAN §4 step 7, §9.4).
 *
 * Every mutation here is the LAST step of a flow whose provider calls already
 * happened in `connectActions.ts`: the claim that makes "one inbox, one
 * workspace" true, the rotation store with its ten-minute two-secret overlap,
 * the disconnect wipe, and the 401-at-send-time demotion. They are separate
 * from the actions because they are the part that must be atomic.
 */
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { providerId } from "../integrations/agentmailApi";
import { boundedString, domainError } from "../lib/validators";
import {
  clearWorkspaceSecrets,
  putWorkspaceSecret,
  readWorkspaceSecret,
  SECRET_ROTATION_OVERLAP_MS,
} from "../workspaces/secrets";
import {
  INBOX_DISCONNECTED_PAUSE_REASON,
  INBOX_KEY_INVALID_PAUSE_REASON,
  OUR_PAUSE_REASONS,
} from "./connection";
import { v } from "convex/values";

/**
 * THE uniqueness constraint (PLAN §9.4 "One inbox, one workspace").
 *
 * One transaction: read every workspace already claiming this `inboxRef`,
 * refuse if any of them is someone else, and otherwise write the claim, the
 * webhook id and the webhook secret together. Convex serializes mutations, so
 * two concurrent connects cannot both pass the read.
 *
 * `.collect()`, not `.unique()`: the invariant is the thing being maintained,
 * and a throw on an already-violated pair would make it unrepairable.
 */
export const claimInbox = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    inboxRef: v.string(),
    webhookId: v.string(),
    webhookSecret: v.object({
      ciphertext: v.string(),
      iv: v.string(),
      last4: v.string(),
    }),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), connectedAt: v.number() }),
    v.object({ ok: v.literal(false) }),
  ),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (workspace === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    const inboxRef = providerId(args.inboxRef, "inboxRef");
    const claimants = await ctx.db
      .query("workspaces")
      .withIndex("by_inboxRef", (q) => q.eq("inboxRef", inboxRef))
      .collect();
    if (claimants.some((row) => row._id !== workspace._id)) {
      return { ok: false as const };
    }

    const now = Date.now();
    // Re-stamped only when this is a NEW attachment. `connectedAt` is the
    // "never answer history" boundary and the backfill run's key, so a plain
    // re-connect of the same inbox must not move it.
    const connectedAt =
      workspace.inboxRef === inboxRef && workspace.connectedAt !== undefined
        ? workspace.connectedAt
        : now;
    const unpause =
      workspace.pauseReason !== undefined &&
      OUR_PAUSE_REASONS.has(workspace.pauseReason);
    await ctx.db.patch("workspaces", workspace._id, {
      inboxRef,
      agentmailWebhookId: providerId(args.webhookId, "webhookId"),
      inboxConnection: "connected" as const,
      connectedAt,
      updatedAt: now,
      // Only OUR pause is lifted: a workspace an operator paused stays paused.
      ...(unpause
        ? { automationState: "active" as const, pauseReason: undefined }
        : {}),
    });
    await putWorkspaceSecret(ctx, {
      workspaceId: workspace._id,
      provider: "agentmail_webhook",
      ciphertext: args.webhookSecret.ciphertext,
      iv: args.webhookSecret.iv,
      last4: args.webhookSecret.last4,
      status: "valid",
    });
    // Scheduled inside the claim: the import and the quarantine replay are
    // both consequences of the assignment and must not be lost if the calling
    // action dies right after this returns.
    await ctx.scheduler.runAfter(0, internal.inbox.backfill.beginBackfill, {
      workspaceId: workspace._id,
    });
    await ctx.scheduler.runAfter(0, internal.inbox.quarantine.replayForInbox, {
      inboxRef,
    });
    return { ok: true as const, connectedAt };
  },
});

/**
 * Store a rotated key and webhook secret, keeping the PREVIOUS webhook secret
 * valid for the overlap window so an event signed under it mid-swap is still
 * verified, and schedule the overlap's close.
 */
export const applyRotation = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    webhookId: v.string(),
    apiKeyEnvelope: v.object({
      ciphertext: v.string(),
      iv: v.string(),
      last4: v.string(),
    }),
    webhookSecret: v.object({
      ciphertext: v.string(),
      iv: v.string(),
      last4: v.string(),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (workspace === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    await putWorkspaceSecret(ctx, {
      workspaceId: args.workspaceId,
      provider: "agentmail",
      ciphertext: args.apiKeyEnvelope.ciphertext,
      iv: args.apiKeyEnvelope.iv,
      last4: args.apiKeyEnvelope.last4,
      status: "valid",
    });
    await putWorkspaceSecret(ctx, {
      workspaceId: args.workspaceId,
      provider: "agentmail_webhook",
      ciphertext: args.webhookSecret.ciphertext,
      iv: args.webhookSecret.iv,
      last4: args.webhookSecret.last4,
      status: "valid",
      keepPreviousFor: SECRET_ROTATION_OVERLAP_MS,
    });
    const unpause =
      workspace.pauseReason !== undefined &&
      OUR_PAUSE_REASONS.has(workspace.pauseReason);
    await ctx.db.patch("workspaces", args.workspaceId, {
      agentmailWebhookId: providerId(args.webhookId, "webhookId"),
      inboxConnection: "connected" as const,
      updatedAt: Date.now(),
      ...(unpause
        ? { automationState: "active" as const, pauseReason: undefined }
        : {}),
    });
    await ctx.scheduler.runAfter(
      SECRET_ROTATION_OVERLAP_MS,
      internal.workspaces.secrets.closeRotationOverlap,
      { workspaceId: args.workspaceId, provider: "agentmail_webhook" as const },
    );
    return null;
  },
});

export const releaseInbox = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await detachInbox(ctx, args.workspaceId, {
      connection: "none",
      pauseReason: INBOX_DISCONNECTED_PAUSE_REASON,
      wipeSecrets: true,
    });
    return null;
  },
});

/**
 * A 401 from AgentMail at send time (PLAN §4 step 7): the key is marked
 * `invalid` and automation pauses with the reconnect reason. The inbox
 * assignment is KEPT — mail already in flight still belongs to this
 * workspace, and reconnecting the same inbox must stay idempotent.
 */
export const markInboxKeyInvalid = internalMutation({
  args: { workspaceId: v.id("workspaces"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (workspace === null) {
      return null;
    }
    const key = await readWorkspaceSecret(ctx, args.workspaceId, "agentmail");
    if (key !== null && key.status !== "invalid") {
      await ctx.db.patch("workspaceSecrets", key._id, {
        status: "invalid" as const,
        updatedAt: Date.now(),
        checkedAt: Date.now(),
      });
    }
    if (
      workspace.inboxConnection === "invalid" &&
      workspace.automationState === "paused"
    ) {
      return null;
    }
    console.info("inbox.connection: key marked invalid", {
      workspaceId: args.workspaceId,
      reason: boundedString(args.reason, "reason", { min: 1, max: 100 }),
    });
    await ctx.db.patch("workspaces", args.workspaceId, {
      inboxConnection: "invalid" as const,
      automationState: "paused" as const,
      pauseReason: INBOX_KEY_INVALID_PAUSE_REASON,
      updatedAt: Date.now(),
    });
    return null;
  },
});

async function detachInbox(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  args: {
    connection: "none" | "invalid";
    pauseReason: string;
    wipeSecrets: boolean;
  },
): Promise<void> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (workspace === null) {
    return;
  }
  if (args.wipeSecrets) {
    await clearWorkspaceSecrets(ctx, workspaceId);
  }
  await ctx.db.patch("workspaces", workspaceId, {
    inboxConnection: args.connection,
    inboxRef: undefined,
    agentmailWebhookId: undefined,
    connectedAt: undefined,
    automationState: "paused" as const,
    pauseReason: args.pauseReason,
    updatedAt: Date.now(),
  });
}
