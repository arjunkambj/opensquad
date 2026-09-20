/**
 * Manage inbox — the provider half (PLAN §4 "Manage inbox" steps 1–3, 6–7).
 *
 * THE RACE, AND WHERE IT IS CLOSED. Convex has no unique indexes, so "one
 * inbox, one workspace" is enforced transactionally: every provider call —
 * verify the key, find or create the inbox, register the webhook — happens in
 * the ACTION first, and the claim is a single read-then-write mutation over
 * `workspaces.by_inboxRef` (`connectionState.claimInbox`). Convex mutations
 * are serializable, so two concurrent connects cannot both pass the read; the
 * action that loses deletes the webhook it just registered, leaving exactly
 * one behind.
 *
 * IDEMPOTENT BY CONSTRUCTION. Both creates carry a deterministic `client_id`
 * derived from the workspace id, so connecting twice returns the inbox and the
 * webhook that already exist instead of making duplicates.
 *
 * Every action here is owner-guarded through `connection.requireConnectionOwner`
 * — an action cannot read the database, so the guard is a query it runs first.
 */
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import {
  agentmailClientId,
  agentmailFailureMessage,
  createInbox,
  createWebhook,
  deleteWebhook,
  listInboxes,
  providerId,
} from "../integrations/agentmailApi";
import {
  decryptSecret,
  encryptSecret,
  isSecretStorageConfigured,
  secretLast4,
} from "../lib/secrets";
import { requireRateLimit } from "../lib/rateLimits";
import { boundedString } from "../lib/validators";
import { failure, mapProviderFailure, vFailure } from "./connection";
import type { InboxConnectErrorCode } from "./connection";
import { v } from "convex/values";

/** Inbox listings paged while looking for a specific inbox id. */
const INBOX_LOOKUP_PAGE_LIMIT = 100;
const INBOX_LOOKUP_MAX_PAGES = 5;

/* ------------------------------------------------------------------ */
/* Step 1 — verify and store the key                                   */
/* ------------------------------------------------------------------ */

const vVerifyResult = v.union(
  v.object({
    ok: v.literal(true),
    last4: v.string(),
    inboxes: v.array(
      v.object({
        inboxId: v.string(),
        address: v.string(),
        displayName: v.optional(v.string()),
      }),
    ),
  }),
  vFailure,
);

/**
 * Every action here reaches the mail provider and two of them create provider
 * resources, and a key-paste loop is also a credential-probing surface — so
 * each call spends from the caller's connect bucket before anything else. A
 * signed-out caller is left to the owner guard, which refuses them properly.
 */
async function limitConnectCalls(ctx: ActionCtx): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return;
  }
  await requireRateLimit(ctx, "connectInbox", identity.tokenIdentifier);
}

/**
 * Verify a pasted key with `GET /v0/inboxes`, then store it encrypted and
 * return the account's inboxes so the user can pick one (PLAN §4 steps 1–2).
 *
 * A key the provider refuses is NEVER stored: a rejected paste must not
 * overwrite a working connection.
 */
export const verifyAndStoreKey = action({
  args: { workspaceId: v.id("workspaces"), apiKey: v.string() },
  returns: vVerifyResult,
  handler: async (ctx, args): Promise<typeof vVerifyResult.type> => {
    await limitConnectCalls(ctx);
    await ctx.runQuery(internal.inbox.connection.requireConnectionOwner, {
      workspaceId: args.workspaceId,
    });
    if (!isSecretStorageConfigured()) {
      return failure(
        "secrets_unconfigured",
        "This deployment cannot store provider keys yet.",
      );
    }
    const apiKey = boundedString(args.apiKey, "apiKey", { min: 8, max: 512 });
    const listed = await listInboxes(apiKey, { limit: INBOX_LOOKUP_PAGE_LIMIT });
    if (!listed.ok) {
      return mapProviderFailure(listed.code);
    }
    const envelope = await encryptSecret(apiKey);
    await ctx.runMutation(internal.workspaces.secrets.putSecret, {
      workspaceId: args.workspaceId,
      provider: "agentmail" as const,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      last4: secretLast4(apiKey),
      status: "valid" as const,
    });
    return {
      ok: true as const,
      last4: secretLast4(apiKey),
      inboxes: listed.value.inboxes.map((inbox) => ({
        inboxId: inbox.inboxId,
        address: inbox.address,
        ...(inbox.displayName !== undefined
          ? { displayName: inbox.displayName }
          : {}),
      })),
    };
  },
});


/* ------------------------------------------------------------------ */
/* Steps 2–5 — pick or create the inbox, register the webhook, claim   */
/* ------------------------------------------------------------------ */

const vConnectResult = v.union(
  v.object({
    ok: v.literal(true),
    inboxRef: v.string(),
    inboxAddress: v.string(),
  }),
  vFailure,
);

/**
 * Connect the sending inbox: find or create it on the user's own account,
 * register the per-workspace webhook, then claim the inbox transactionally.
 *
 * The claim is LAST. If it loses the race, the webhook this action registered
 * is deleted before returning, so a losing connect leaves the winner's
 * registration alone and nothing orphaned on the provider side.
 */
export const connectInbox = action({
  args: {
    workspaceId: v.id("workspaces"),
    /** An inbox already on the account. Omit to create one. */
    inboxId: v.optional(v.string()),
    username: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  returns: vConnectResult,
  handler: async (ctx, args): Promise<typeof vConnectResult.type> => {
    await limitConnectCalls(ctx);
    const owner = await ctx.runQuery(
      internal.inbox.connection.requireConnectionOwner,
      { workspaceId: args.workspaceId },
    );
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (siteUrl === undefined || siteUrl.length === 0) {
      return failure(
        "site_url_missing",
        "This deployment has no public site URL, so mail cannot be received.",
      );
    }
    const envelope = await ctx.runQuery(
      internal.workspaces.secrets.getEnvelope,
      { workspaceId: args.workspaceId, provider: "agentmail" as const },
    );
    if (envelope === null) {
      return failure("no_stored_key", "Add your AgentMail key first.");
    }
    if (envelope.status === "invalid") {
      return failure(
        "key_rejected",
        "The stored key was refused by AgentMail. Paste a new one.",
      );
    }
    const apiKey = await decryptSecret(envelope);

    // --- the inbox --------------------------------------------------------
    let inboxRef: string;
    let inboxAddress: string;
    if (args.inboxId !== undefined) {
      const wanted = providerId(args.inboxId, "inboxId");
      const found = await findInbox(apiKey, wanted);
      if (found === "unavailable") {
        return failure(
          "provider_unavailable",
          agentmailFailureMessage("provider_unavailable"),
        );
      }
      if (found === null) {
        return failure(
          "inbox_not_visible_to_key",
          "That inbox is not on the account this key belongs to.",
        );
      }
      inboxRef = found.inboxId;
      inboxAddress = found.address;
    } else {
      const created = await createInbox(apiKey, {
        clientId: agentmailClientId("inbox", args.workspaceId),
        ...(args.username !== undefined
          ? { username: boundedString(args.username, "username", { min: 1, max: 64 }) }
          : {}),
        ...(args.displayName !== undefined
          ? {
              displayName: boundedString(args.displayName, "displayName", {
                min: 1,
                max: 100,
              }),
            }
          : {}),
      });
      if (!created.ok) {
        return mapProviderFailure(created.code);
      }
      inboxRef = created.value.inboxId;
      inboxAddress = created.value.address;
    }

    // --- the webhook ------------------------------------------------------
    const webhookUrl = `${siteUrl.replace(/\/+$/, "")}/agentmail/webhook/${owner.webhookToken}`;
    const clientId = agentmailClientId("webhook", args.workspaceId);
    let registered = await createWebhook(apiKey, {
      url: webhookUrl,
      inboxIds: [inboxRef],
      clientId,
    });
    if (
      registered.ok &&
      (registered.value.url !== webhookUrl ||
        !registered.value.inboxIds.includes(inboxRef))
    ) {
      // `client_id` returned the workspace's PREVIOUS registration, pointing
      // at a different inbox or a stale URL. Replace it rather than leave mail
      // going to the wrong route; the id is free again once it is deleted.
      await deleteWebhook(apiKey, registered.value.webhookId);
      registered = await createWebhook(apiKey, {
        url: webhookUrl,
        inboxIds: [inboxRef],
        clientId,
      });
    }
    if (!registered.ok) {
      return failure(
        "webhook_registration_failed",
        agentmailFailureMessage(registered.code),
      );
    }
    if (
      registered.value.url !== webhookUrl ||
      !registered.value.inboxIds.includes(inboxRef)
    ) {
      await deleteWebhook(apiKey, registered.value.webhookId);
      return failure(
        "webhook_registration_failed",
        "AgentMail did not register the inbound address for this inbox.",
      );
    }

    // --- the claim, last --------------------------------------------------
    const secret = await encryptSecret(registered.value.secret);
    const claim = await ctx.runMutation(internal.inbox.connectionState.claimInbox, {
      workspaceId: args.workspaceId,
      inboxRef,
      webhookId: registered.value.webhookId,
      webhookSecret: {
        ciphertext: secret.ciphertext,
        iv: secret.iv,
        last4: secretLast4(registered.value.secret),
      },
    });
    if (!claim.ok) {
      // Lost the race (or the inbox belongs to someone else): take the
      // webhook this action registered back down.
      await deleteWebhook(apiKey, registered.value.webhookId);
      return failure(
        "inbox_claimed_elsewhere",
        "That inbox is connected to another workspace.",
      );
    }
    return { ok: true as const, inboxRef, inboxAddress };
  },
});

/** Find one inbox on the key's account, paging a bounded number of times. */
async function findInbox(
  apiKey: string,
  inboxId: string,
): Promise<{ inboxId: string; address: string } | null | "unavailable"> {
  let pageToken: string | undefined;
  for (let page = 0; page < INBOX_LOOKUP_MAX_PAGES; page += 1) {
    const listed = await listInboxes(apiKey, {
      limit: INBOX_LOOKUP_PAGE_LIMIT,
      ...(pageToken !== undefined ? { pageToken } : {}),
    });
    if (!listed.ok) {
      return "unavailable";
    }
    const match = listed.value.inboxes.find(
      (inbox) => inbox.inboxId === inboxId,
    );
    if (match !== undefined) {
      return { inboxId: match.inboxId, address: match.address };
    }
    if (listed.value.nextPageToken === undefined) {
      return null;
    }
    pageToken = listed.value.nextPageToken;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Step 7 — rotate and disconnect                                      */
/* ------------------------------------------------------------------ */

/**
 * Rotate the API key, in PLAN §9.4's order: verify the new key → register the
 * new webhook → store the new key and secret with a ten-minute overlap →
 * delete the old webhook with the OLD key, best effort.
 *
 * The new key must be able to see the CURRENT inbox. A key that cannot is a
 * different connection, not a rotation, and is refused so nothing silently
 * re-points the workspace at another mailbox.
 */
export const rotateKey = action({
  args: { workspaceId: v.id("workspaces"), apiKey: v.string() },
  returns: v.union(v.object({ ok: v.literal(true) }), vFailure),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { ok: false; code: InboxConnectErrorCode; message: string }> => {
    await limitConnectCalls(ctx);
    const owner = await ctx.runQuery(
      internal.inbox.connection.requireConnectionOwner,
      { workspaceId: args.workspaceId },
    );
    if (owner.inboxRef === undefined) {
      return failure("not_connected", "Connect an inbox before rotating a key.");
    }
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (siteUrl === undefined || siteUrl.length === 0) {
      return failure(
        "site_url_missing",
        "This deployment has no public site URL, so mail cannot be received.",
      );
    }
    const apiKey = boundedString(args.apiKey, "apiKey", { min: 8, max: 512 });
    const found = await findInbox(apiKey, owner.inboxRef);
    if (found === "unavailable") {
      return failure(
        "provider_unavailable",
        agentmailFailureMessage("provider_unavailable"),
      );
    }
    if (found === null) {
      return failure(
        "inbox_not_visible_to_key",
        "That key cannot see this workspace's inbox. Disconnect first if you are moving to a different mailbox.",
      );
    }
    const webhookUrl = `${siteUrl.replace(/\/+$/, "")}/agentmail/webhook/${owner.webhookToken}`;
    const registered = await createWebhook(apiKey, {
      url: webhookUrl,
      inboxIds: [owner.inboxRef],
      clientId: agentmailClientId("webhook", args.workspaceId),
    });
    if (!registered.ok) {
      return failure(
        "webhook_registration_failed",
        agentmailFailureMessage(registered.code),
      );
    }

    // Read the OLD key before it is replaced — the old webhook has to be
    // deleted with the credentials that created it.
    const previous = await ctx.runQuery(
      internal.workspaces.secrets.getEnvelope,
      { workspaceId: args.workspaceId, provider: "agentmail" as const },
    );
    const key = await encryptSecret(apiKey);
    const secret = await encryptSecret(registered.value.secret);
    await ctx.runMutation(internal.inbox.connectionState.applyRotation, {
      workspaceId: args.workspaceId,
      webhookId: registered.value.webhookId,
      apiKeyEnvelope: {
        ciphertext: key.ciphertext,
        iv: key.iv,
        last4: secretLast4(apiKey),
      },
      webhookSecret: {
        ciphertext: secret.ciphertext,
        iv: secret.iv,
        last4: secretLast4(registered.value.secret),
      },
    });

    if (
      owner.agentmailWebhookId !== undefined &&
      owner.agentmailWebhookId !== registered.value.webhookId &&
      previous !== null
    ) {
      // Best effort, and deliberately after the store: a failure here leaves a
      // stale webhook on the provider, which is recoverable; failing before
      // the store would leave us unable to verify anything at all.
      await deleteWebhook(
        await decryptSecret(previous),
        owner.agentmailWebhookId,
      );
    }
    return { ok: true as const };
  },
});


/**
 * Disconnect: delete the webhook with the key that created it (best effort),
 * wipe both secrets and pause automation with a reason the banner reads.
 */
export const disconnectInbox = action({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({ ok: v.literal(true), webhookDeleted: v.boolean() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; webhookDeleted: boolean }> => {
    await limitConnectCalls(ctx);
    const owner = await ctx.runQuery(
      internal.inbox.connection.requireConnectionOwner,
      { workspaceId: args.workspaceId },
    );
    let webhookDeleted = false;
    if (owner.agentmailWebhookId !== undefined) {
      const envelope = await ctx.runQuery(
        internal.workspaces.secrets.getEnvelope,
        { workspaceId: args.workspaceId, provider: "agentmail" as const },
      );
      if (envelope !== null) {
        const removed = await deleteWebhook(
          await decryptSecret(envelope),
          owner.agentmailWebhookId,
        );
        webhookDeleted = removed.ok;
      }
    }
    // The local state is cleared whether or not the provider answered: the
    // user asked to disconnect, and a stale webhook can only deliver events
    // this deployment will refuse.
    await ctx.runMutation(internal.inbox.connectionState.releaseInbox, {
      workspaceId: args.workspaceId,
    });
    return { ok: true as const, webhookDeleted };
  },
});

