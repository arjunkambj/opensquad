/**
 * Manage inbox — the state transitions (PLAN §4 step 7, §9.4).
 *
 * Every mutation here is the LAST step of a flow whose provider calls already
 * happened in `connectActions.ts`: the claim that makes "one inbox, one
 * org" true, the rotation store with its ten-minute two-secret overlap,
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
  clearOrgSecrets,
  putOrgSecret,
  readOrgSecret,
  SECRET_ROTATION_OVERLAP_MS,
} from "../orgs/secrets";
import {
  INBOX_DISCONNECTED_PAUSE_REASON,
  INBOX_KEY_INVALID_PAUSE_REASON,
  OUR_PAUSE_REASONS,
} from "./connection";
import { v } from "convex/values";

/**
 * THE uniqueness constraint (PLAN §9.4 "One inbox, one org").
 *
 * One transaction: read every org already claiming this `inboxRef`,
 * refuse if any of them is someone else, and otherwise write the claim, the
 * webhook id and the webhook secret together. Convex serializes mutations, so
 * two concurrent connects cannot both pass the read.
 *
 * `.collect()`, not `.unique()`: the invariant is the thing being maintained,
 * and a throw on an already-violated pair would make it unrepairable.
 */
export const claimInbox = internalMutation({
  args: {
    orgId: v.id("orgs"),
    inboxRef: v.string(),
    /**
     * The mailbox address the provider reported for this inbox (`Inbox.email`).
     * Separate from the id by the provider's own contract, so it is stored
     * rather than inferred — `inbox/mailboxIdentity.ts` is what reads it.
     */
    inboxAddress: v.optional(v.string()),
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
    const org = await ctx.db.get("orgs", args.orgId);
    if (org === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    const inboxRef = providerId(args.inboxRef, "inboxRef");
    const claimants = await ctx.db
      .query("orgs")
      .withIndex("by_inboxRef", (q) => q.eq("inboxRef", inboxRef))
      .collect();
    if (claimants.some((row) => row._id !== org._id)) {
      return { ok: false as const };
    }

    const now = Date.now();
    // Re-stamped only when this is a NEW attachment. `connectedAt` is the
    // "never answer history" boundary and the backfill run's key, so a plain
    // re-connect of the same inbox must not move it.
    const connectedAt =
      org.inboxRef === inboxRef && org.connectedAt !== undefined
        ? org.connectedAt
        : now;
    const unpause =
      org.pauseReason !== undefined &&
      OUR_PAUSE_REASONS.has(org.pauseReason);
    const inboxAddress =
      args.inboxAddress === undefined
        ? undefined
        : providerId(args.inboxAddress, "inboxAddress");
    await ctx.db.patch("orgs", org._id, {
      inboxRef,
      // Written whenever the provider gave one, and never cleared by a
      // reconnect that did not: a stale address is worse than the fallback.
      ...(inboxAddress !== undefined ? { inboxAddress } : {}),
      agentmailWebhookId: providerId(args.webhookId, "webhookId"),
      inboxConnection: "connected" as const,
      connectedAt,
      updatedAt: now,
      // Only OUR pause is lifted: an org an operator paused stays paused.
      ...(unpause
        ? { automationState: "active" as const, pauseReason: undefined }
        : {}),
    });
    await putOrgSecret(ctx, {
      orgId: org._id,
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
      orgId: org._id,
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
    orgId: v.id("orgs"),
    webhookId: v.string(),
    /** Refreshed from the rotation's own inbox lookup, when it reported one. */
    inboxAddress: v.optional(v.string()),
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
    const org = await ctx.db.get("orgs", args.orgId);
    if (org === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    await putOrgSecret(ctx, {
      orgId: args.orgId,
      provider: "agentmail",
      ciphertext: args.apiKeyEnvelope.ciphertext,
      iv: args.apiKeyEnvelope.iv,
      last4: args.apiKeyEnvelope.last4,
      status: "valid",
    });
    await putOrgSecret(ctx, {
      orgId: args.orgId,
      provider: "agentmail_webhook",
      ciphertext: args.webhookSecret.ciphertext,
      iv: args.webhookSecret.iv,
      last4: args.webhookSecret.last4,
      status: "valid",
      keepPreviousFor: SECRET_ROTATION_OVERLAP_MS,
    });
    const unpause =
      org.pauseReason !== undefined &&
      OUR_PAUSE_REASONS.has(org.pauseReason);
    await ctx.db.patch("orgs", args.orgId, {
      agentmailWebhookId: providerId(args.webhookId, "webhookId"),
      inboxConnection: "connected" as const,
      ...(args.inboxAddress === undefined
        ? {}
        : { inboxAddress: providerId(args.inboxAddress, "inboxAddress") }),
      updatedAt: Date.now(),
      ...(unpause
        ? { automationState: "active" as const, pauseReason: undefined }
        : {}),
    });
    await ctx.scheduler.runAfter(
      SECRET_ROTATION_OVERLAP_MS,
      internal.orgs.secrets.closeRotationOverlap,
      { orgId: args.orgId, provider: "agentmail_webhook" as const },
    );
    return null;
  },
});

/**
 * Forget a webhook registration the provider no longer has.
 *
 * `connectActions.registerOrgWebhook` deletes a mismatched registration before
 * creating the replacement, and a failure between the two leaves the org
 * holding the id of something that is gone: Manage inbox would keep reporting
 * a registered webhook while no mail arrives at all. Only the id is cleared —
 * the webhook SECRET stays, because it is the one thing that could still
 * verify a delivery in flight, and the next successful registration replaces
 * it. The inbox assignment stays too: this is a registration that failed, not
 * a disconnect.
 *
 * `webhookId` is matched against the stored one so a late failure from a
 * losing attempt cannot wipe the registration a concurrent connect just made.
 */
export const clearWebhookRegistration = internalMutation({
  args: { orgId: v.id("orgs"), webhookId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const org = await ctx.db.get("orgs", args.orgId);
    if (org === null || org.agentmailWebhookId !== args.webhookId) {
      return null;
    }
    await ctx.db.patch("orgs", args.orgId, {
      agentmailWebhookId: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const releaseInbox = internalMutation({
  args: {
    orgId: v.id("orgs"),
    /**
     * Keep `agentmailWebhookId` although the inbox is being released: the
     * provider still holds that registration and it could not be deleted, so
     * the id is the only local record that something is still posting at this
     * deployment — and the next connect's `registerOrgWebhook` reclaims
     * exactly it. Clearing it would leave the orphan with nothing pointing
     * at it at all.
     */
    keepWebhookRegistration: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await detachInbox(ctx, args.orgId, {
      connection: "none",
      pauseReason: INBOX_DISCONNECTED_PAUSE_REASON,
      wipeSecrets: true,
      keepWebhookRegistration: args.keepWebhookRegistration === true,
    });
    return null;
  },
});

/**
 * A 401 from AgentMail at send time (PLAN §4 step 7): the key is marked
 * `invalid` and automation pauses with the reconnect reason. The inbox
 * assignment is KEPT — mail already in flight still belongs to this
 * org, and reconnecting the same inbox must stay idempotent.
 */
export const markInboxKeyInvalid = internalMutation({
  args: { orgId: v.id("orgs"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const org = await ctx.db.get("orgs", args.orgId);
    if (org === null) {
      return null;
    }
    const key = await readOrgSecret(ctx, args.orgId, "agentmail");
    if (key !== null && key.status !== "invalid") {
      await ctx.db.patch("orgSecrets", key._id, {
        status: "invalid" as const,
        updatedAt: Date.now(),
        checkedAt: Date.now(),
      });
    }
    if (
      org.inboxConnection === "invalid" &&
      org.automationState === "paused"
    ) {
      return null;
    }
    console.info("inbox.connection: key marked invalid", {
      orgId: args.orgId,
      reason: boundedString(args.reason, "reason", { min: 1, max: 100 }),
    });
    await ctx.db.patch("orgs", args.orgId, {
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
  orgId: Id<"orgs">,
  args: {
    connection: "none" | "invalid";
    pauseReason: string;
    wipeSecrets: boolean;
    keepWebhookRegistration?: boolean;
  },
): Promise<void> {
  const org = await ctx.db.get("orgs", orgId);
  if (org === null) {
    return;
  }
  if (args.wipeSecrets) {
    await clearOrgSecrets(ctx, orgId);
  }
  await ctx.db.patch("orgs", orgId, {
    inboxConnection: args.connection,
    inboxRef: undefined,
    inboxAddress: undefined,
    ...(args.keepWebhookRegistration === true
      ? {}
      : { agentmailWebhookId: undefined }),
    connectedAt: undefined,
    automationState: "paused" as const,
    pauseReason: args.pauseReason,
    updatedAt: Date.now(),
  });
}
