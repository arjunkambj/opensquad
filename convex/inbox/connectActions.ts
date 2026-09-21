/**
 * Manage inbox — the provider half (PLAN §4 "Manage inbox" steps 1–3, 6–7).
 *
 * THE RACE, AND WHERE IT IS CLOSED. Convex has no unique indexes, so "one
 * inbox, one org" is enforced transactionally: every provider call —
 * verify the key, find or create the inbox, register the webhook — happens in
 * the ACTION first, and the claim is a single read-then-write mutation over
 * `orgs.by_inboxRef` (`connectionState.claimInbox`). Convex mutations
 * are serializable, so two concurrent connects cannot both pass the read; the
 * action that loses deletes the webhook it just registered, leaving exactly
 * one behind.
 *
 * IDEMPOTENT BY CONSTRUCTION. Both creates carry a deterministic `client_id`
 * derived from the org id, so connecting twice returns the inbox and the
 * webhook that already exist instead of making duplicates.
 *
 * Every action here is guarded through `connection.requireConnectionMember` —
 * an action cannot read the database, so the guard is a query it runs first.
 * It is a MEMBER guard, not an owner one: the token carries the active
 * organization and no role, and we keep no member records of our own, so every
 * member of the organization may change the sending inbox (PLAN §4).
 */
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, env } from "../_generated/server";
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
import type {
  AgentMailErrorCode,
  AgentMailWebhook,
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

/**
 * Register this org's inbound webhook, replacing a stale registration.
 *
 * `client_id` is deterministic per org, so `createWebhook` is idempotent — and
 * that is exactly the trap: an org that has connected before gets its
 * PREVIOUS registration back, pointing at the inbox it used to have or at a
 * URL from before the site moved. Storing that would pin the org to a route
 * its mail no longer arrives on, so the stale one is deleted (which frees the
 * `client_id`) and registered again.
 *
 * Shared by connect and rotate: both need the same guarantee, and a rotation
 * that skipped it would leave the org verifying signatures for a webhook that
 * points somewhere else. `stale_registration` is the one code the provider
 * never returns — it means the second registration came back mismatched too,
 * and the webhook was taken back down rather than left orphaned.
 *
 * The delete opens a window the caller has to know about: if the re-create
 * fails behind it, the registration the org has STORED may be the one just
 * removed, and mail stops arriving until someone tries again. A failure
 * therefore reports what it took down rather than leaving that to be guessed.
 */
async function registerOrgWebhook(
  apiKey: string,
  args: { url: string; inboxRef: string; clientId: string },
): Promise<
  | { ok: true; webhook: AgentMailWebhook }
  | {
      ok: false;
      code: AgentMailErrorCode | "stale_registration";
      /**
       * Registrations this call TOOK DOWN before it failed. The org may be
       * holding one of them, in which case it now holds a webhook id and a
       * secret for something that no longer exists — nothing arrives on that
       * route until a retry registers again.
       */
      removedWebhookIds: string[];
    }
> {
  const matches = (webhook: AgentMailWebhook): boolean =>
    webhook.url === args.url && webhook.inboxIds.includes(args.inboxRef);
  const request = {
    url: args.url,
    inboxIds: [args.inboxRef],
    clientId: args.clientId,
  };
  const removedWebhookIds: string[] = [];

  // Only a delete the provider CONFIRMED (a `not_found` counts — the
  // registration is gone either way), so the list is a fact about what is no
  // longer there rather than about what we asked for.
  const remove = async (webhookId: string): Promise<void> => {
    const deleted = await deleteWebhook(apiKey, webhookId);
    if (deleted.ok) {
      removedWebhookIds.push(webhookId);
    }
  };

  let registered = await createWebhook(apiKey, request);
  if (registered.ok && !matches(registered.value)) {
    // `client_id` returned the org's PREVIOUS registration, pointing at a
    // different inbox or a stale URL. Replace it rather than leave mail going
    // to the wrong route.
    //
    // AND IT IS SAFE WHETHER OR NOT THE DELETE FREES THE `client_id`. The
    // provider documents only that a repeated create returns the ORIGINAL
    // resource; whether the mapping survives a delete is not stated. If it
    // does not, the second create registers a fresh webhook and we are done.
    // If it does, the second create hands back the same mismatched resource —
    // and the `matches` check below sees that, takes it down and returns
    // `stale_registration` instead of storing a dead registration. Neither
    // branch binds the org to something the provider no longer has, and
    // `deleteWebhook` treats a 404 as success, so the second removal of one
    // id is a no-op rather than an error.
    await remove(registered.value.webhookId);
    registered = await createWebhook(apiKey, request);
  }
  if (!registered.ok) {
    return { ok: false as const, code: registered.code, removedWebhookIds };
  }
  if (!matches(registered.value)) {
    await remove(registered.value.webhookId);
    return {
      ok: false as const,
      code: "stale_registration" as const,
      removedWebhookIds,
    };
  }
  return { ok: true as const, webhook: registered.value };
}

/**
 * The one sentence for a webhook that could not be registered as asked.
 *
 * `registrationLost` is the case worth spelling out: the replace deleted the
 * org's old registration and the re-create failed behind it, so the org is
 * not merely unchanged — it is receiving no mail at all until someone tries
 * again. Saying only "could not register" would read like a no-op.
 */
function webhookFailure(
  code: AgentMailErrorCode | "stale_registration",
  registrationLost: boolean,
) {
  const reason =
    code === "stale_registration"
      ? "AgentMail did not register the inbound address for this inbox."
      : agentmailFailureMessage(code);
  return failure(
    "webhook_registration_failed",
    registrationLost
      ? `${reason} The previous inbound address was removed first, so no incoming mail is reaching this inbox until you try again.`
      : reason,
  );
}

/**
 * Answer a failed registration, having first put the org's stored state back
 * in step with the provider.
 *
 * The org keeps a webhook id for the registration it believes in. When the
 * replace took THAT one down, keeping it would leave Manage inbox showing a
 * registered webhook for something the provider no longer has; it is cleared
 * so the screen is honest and a retry registers from scratch. The webhook
 * SECRET is deliberately left alone: it is the only thing that could verify a
 * delivery still in flight, and it is replaced by the next successful
 * registration anyway.
 */
async function webhookRegistrationFailure(
  ctx: ActionCtx,
  args: {
    orgId: Id<"orgs">;
    storedWebhookId: string | undefined;
    removedWebhookIds: string[];
    code: AgentMailErrorCode | "stale_registration";
  },
): Promise<{ ok: false; code: InboxConnectErrorCode; message: string }> {
  const storedWebhookId = args.storedWebhookId;
  const lost =
    storedWebhookId !== undefined &&
    args.removedWebhookIds.includes(storedWebhookId);
  if (lost) {
    await ctx.runMutation(
      internal.inbox.connectionState.clearWebhookRegistration,
      { orgId: args.orgId, webhookId: storedWebhookId },
    );
  }
  return webhookFailure(args.code, lost);
}

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
  args: { orgId: v.id("orgs"), apiKey: v.string() },
  returns: vVerifyResult,
  handler: async (ctx, args): Promise<typeof vVerifyResult.type> => {
    await limitConnectCalls(ctx);
    await ctx.runQuery(internal.inbox.connection.requireConnectionMember, {
      orgId: args.orgId,
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
    await ctx.runMutation(internal.orgs.secrets.putSecret, {
      orgId: args.orgId,
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
 * register the per-org webhook, then claim the inbox transactionally.
 *
 * The claim is LAST. If it loses the race, the webhook this action registered
 * is deleted before returning, so a losing connect leaves the winner's
 * registration alone and nothing orphaned on the provider side.
 */
export const connectInbox = action({
  args: {
    orgId: v.id("orgs"),
    /** An inbox already on the account. Omit to create one. */
    inboxId: v.optional(v.string()),
    username: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  returns: vConnectResult,
  handler: async (ctx, args): Promise<typeof vConnectResult.type> => {
    await limitConnectCalls(ctx);
    const owner = await ctx.runQuery(
      internal.inbox.connection.requireConnectionMember,
      { orgId: args.orgId },
    );
    const siteUrl = env.CONVEX_SITE_URL;
    if (siteUrl === undefined || siteUrl.length === 0) {
      return failure(
        "site_url_missing",
        "This deployment has no public site URL, so mail cannot be received.",
      );
    }
    const envelope = await ctx.runQuery(
      internal.orgs.secrets.getEnvelope,
      { orgId: args.orgId, provider: "agentmail" as const },
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
      if (!found.found) {
        return "failure" in found
          ? mapProviderFailure(found.failure)
          : failure(
              "inbox_not_visible_to_key",
              "That inbox is not on the account this key belongs to.",
            );
      }
      inboxRef = found.inboxId;
      inboxAddress = found.address;
    } else {
      const created = await createInbox(apiKey, {
        clientId: agentmailClientId("inbox", args.orgId),
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
    const registered = await registerOrgWebhook(apiKey, {
      url: webhookUrl,
      inboxRef,
      clientId: agentmailClientId("webhook", args.orgId),
    });
    if (!registered.ok) {
      return await webhookRegistrationFailure(ctx, {
        orgId: args.orgId,
        storedWebhookId: owner.agentmailWebhookId,
        removedWebhookIds: registered.removedWebhookIds,
        code: registered.code,
      });
    }

    // --- the claim, last --------------------------------------------------
    const secret = await encryptSecret(registered.webhook.secret);
    const claim = await ctx.runMutation(internal.inbox.connectionState.claimInbox, {
      orgId: args.orgId,
      inboxRef,
      // The provider reports the id and the mailbox address as separate
      // fields; both are stored so nothing downstream has to assume they are
      // the same string (`inbox/mailboxIdentity.ts`).
      inboxAddress,
      webhookId: registered.webhook.webhookId,
      webhookSecret: {
        ciphertext: secret.ciphertext,
        iv: secret.iv,
        last4: secretLast4(registered.webhook.secret),
      },
    });
    if (!claim.ok) {
      // Lost the race (or the inbox belongs to someone else): take the
      // webhook this action registered back down. Retried, because one left
      // standing posts every event at a URL that will refuse it forever.
      await deleteWebhookWithRetry(apiKey, registered.webhook.webhookId);
      return failure(
        "inbox_claimed_elsewhere",
        "That inbox is connected to another organization.",
      );
    }
    return { ok: true as const, inboxRef, inboxAddress };
  },
});

/**
 * Find one inbox on the key's account, paging a bounded number of times.
 *
 * A failed listing carries the provider's MAPPED code rather than collapsing
 * to "unavailable": a key the provider refused is a different answer for the
 * user ("that key was refused") than a provider that is down ("try again
 * shortly"), and both callers map it through `mapProviderFailure` so the
 * white-label rule still holds — a code travels, never provider wording.
 */
async function findInbox(
  apiKey: string,
  inboxId: string,
): Promise<
  | { found: true; inboxId: string; address: string }
  | { found: false }
  | { found: false; failure: AgentMailErrorCode }
> {
  let pageToken: string | undefined;
  for (let page = 0; page < INBOX_LOOKUP_MAX_PAGES; page += 1) {
    const listed = await listInboxes(apiKey, {
      limit: INBOX_LOOKUP_PAGE_LIMIT,
      ...(pageToken !== undefined ? { pageToken } : {}),
    });
    if (!listed.ok) {
      return { found: false as const, failure: listed.code };
    }
    const match = listed.value.inboxes.find(
      (inbox) => inbox.inboxId === inboxId,
    );
    if (match !== undefined) {
      return {
        found: true as const,
        inboxId: match.inboxId,
        address: match.address,
      };
    }
    if (listed.value.nextPageToken === undefined) {
      return { found: false as const };
    }
    pageToken = listed.value.nextPageToken;
  }
  return { found: false as const };
}

/** Attempts a best-effort webhook delete gets before it is given up on. */
const WEBHOOK_DELETE_ATTEMPTS = 3;

/** Pause between those attempts. Short — the caller is a user waiting. */
const WEBHOOK_DELETE_RETRY_MS = 400;

/**
 * Take a webhook down, retrying the failures a retry can fix.
 *
 * A REGISTRATION WE CANNOT DELETE KEEPS FIRING. The provider goes on posting
 * every inbound event to a URL that answers 401 once the secret is gone, and
 * Svix retries each one — so a "best effort" that gave up after a single
 * timeout left a permanent, invisible retry loop on the user's own account.
 * `not_found` counts as success: the registration is gone either way.
 *
 * Only transient codes are retried; a key the provider refuses will refuse the
 * next attempt identically, and there is nothing to wait for.
 */
async function deleteWebhookWithRetry(
  apiKey: string,
  webhookId: string,
): Promise<{ deleted: boolean; code?: AgentMailErrorCode }> {
  let last: AgentMailErrorCode | undefined;
  for (let attempt = 0; attempt < WEBHOOK_DELETE_ATTEMPTS; attempt += 1) {
    const removed = await deleteWebhook(apiKey, webhookId);
    if (removed.ok) {
      return { deleted: true };
    }
    last = removed.code;
    if (
      removed.code !== "timeout" &&
      removed.code !== "transport_error" &&
      removed.code !== "provider_unavailable" &&
      removed.code !== "rate_limited"
    ) {
      break;
    }
    if (attempt + 1 < WEBHOOK_DELETE_ATTEMPTS) {
      await new Promise((resolve) =>
        setTimeout(resolve, WEBHOOK_DELETE_RETRY_MS * (attempt + 1)),
      );
    }
  }
  // Provider identifiers and OUR mapped code only — never provider wording.
  console.info("inbox.connectActions: webhook still registered at provider", {
    webhookId,
    code: last,
  });
  return { deleted: false, ...(last !== undefined ? { code: last } : {}) };
}

/**
 * Rotate the API key, in PLAN §9.4's order: verify the new key → register the
 * new webhook → store the new key and secret with a ten-minute overlap →
 * delete the old webhook with the OLD key, best effort.
 *
 * The new key must be able to see the CURRENT inbox. A key that cannot is a
 * different connection, not a rotation, and is refused so nothing silently
 * re-points the org at another mailbox.
 */
export const rotateKey = action({
  args: { orgId: v.id("orgs"), apiKey: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      /** A previous registration the provider still holds — see below. */
      orphanedWebhookId: v.optional(v.string()),
    }),
    vFailure,
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; orphanedWebhookId?: string }
    | { ok: false; code: InboxConnectErrorCode; message: string }
  > => {
    await limitConnectCalls(ctx);
    const owner = await ctx.runQuery(
      internal.inbox.connection.requireConnectionMember,
      { orgId: args.orgId },
    );
    if (owner.inboxRef === undefined) {
      return failure("not_connected", "Connect an inbox before rotating a key.");
    }
    const siteUrl = env.CONVEX_SITE_URL;
    if (siteUrl === undefined || siteUrl.length === 0) {
      return failure(
        "site_url_missing",
        "This deployment has no public site URL, so mail cannot be received.",
      );
    }
    const apiKey = boundedString(args.apiKey, "apiKey", { min: 8, max: 512 });
    const found = await findInbox(apiKey, owner.inboxRef);
    if (!found.found) {
      return "failure" in found
        ? mapProviderFailure(found.failure)
        : failure(
            "inbox_not_visible_to_key",
            "That key cannot see this organization's inbox. Disconnect first if you are moving to a different mailbox.",
          );
    }
    const webhookUrl = `${siteUrl.replace(/\/+$/, "")}/agentmail/webhook/${owner.webhookToken}`;
    // The same replace-if-mismatched registration connect uses: the
    // idempotent `client_id` would otherwise hand a rotating org its previous
    // registration back, and it would then hold a secret for a webhook
    // pointing at a stale URL or another inbox.
    const registered = await registerOrgWebhook(apiKey, {
      url: webhookUrl,
      inboxRef: owner.inboxRef,
      clientId: agentmailClientId("webhook", args.orgId),
    });
    if (!registered.ok) {
      return await webhookRegistrationFailure(ctx, {
        orgId: args.orgId,
        storedWebhookId: owner.agentmailWebhookId,
        removedWebhookIds: registered.removedWebhookIds,
        code: registered.code,
      });
    }

    // Read the OLD key before it is replaced — the old webhook has to be
    // deleted with the credentials that created it.
    const previous = await ctx.runQuery(
      internal.orgs.secrets.getEnvelope,
      { orgId: args.orgId, provider: "agentmail" as const },
    );
    const key = await encryptSecret(apiKey);
    const secret = await encryptSecret(registered.webhook.secret);
    await ctx.runMutation(internal.inbox.connectionState.applyRotation, {
      orgId: args.orgId,
      webhookId: registered.webhook.webhookId,
      inboxAddress: found.address,
      apiKeyEnvelope: {
        ciphertext: key.ciphertext,
        iv: key.iv,
        last4: secretLast4(apiKey),
      },
      webhookSecret: {
        ciphertext: secret.ciphertext,
        iv: secret.iv,
        last4: secretLast4(registered.webhook.secret),
      },
    });

    const stale = owner.agentmailWebhookId;
    if (stale !== undefined && stale !== registered.webhook.webhookId) {
      // Deliberately after the store: a failure here leaves a stale webhook on
      // the provider, which is recoverable; failing before the store would
      // leave us unable to verify anything at all.
      //
      // It is NOT "best effort" in the sense of one try, though. A surviving
      // registration points at this same URL and delivers a SECOND copy of
      // every event — verified for as long as the rotation overlap is open,
      // then 401 and retried by the provider for good. So the delete is
      // retried, and an orphan that outlives the retries is reported and
      // logged rather than forgotten.
      const removed =
        previous === null
          ? { deleted: false }
          : await deleteWebhookWithRetry(await decryptSecret(previous), stale);
      if (!removed.deleted) {
        return { ok: true as const, orphanedWebhookId: stale };
      }
    }
    return { ok: true as const };
  },
});

/**
 * Disconnect: delete the webhook with the key that created it (best effort),
 * wipe both secrets and pause automation with a reason the banner reads.
 */
export const disconnectInbox = action({
  args: { orgId: v.id("orgs") },
  returns: v.object({
    ok: v.literal(true),
    webhookDeleted: v.boolean(),
    /**
     * The registration that is STILL live on the provider, when the delete
     * could not be made. It keeps posting every inbound event at a URL that
     * now answers 401, and only the account's owner can take it down — so the
     * id is reported rather than forgotten, and the org keeps its local
     * record of it so a later reconnect reclaims it.
     */
    orphanedWebhookId: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: true;
    webhookDeleted: boolean;
    orphanedWebhookId?: string;
  }> => {
    await limitConnectCalls(ctx);
    const owner = await ctx.runQuery(
      internal.inbox.connection.requireConnectionMember,
      { orgId: args.orgId },
    );
    const webhookId = owner.agentmailWebhookId;
    let webhookDeleted = false;
    if (webhookId !== undefined) {
      const envelope = await ctx.runQuery(
        internal.orgs.secrets.getEnvelope,
        { orgId: args.orgId, provider: "agentmail" as const },
      );
      if (envelope !== null) {
        const removed = await deleteWebhookWithRetry(
          await decryptSecret(envelope),
          webhookId,
        );
        webhookDeleted = removed.deleted;
      } else {
        // No key to delete it with — and after this mutation there never will
        // be one. Logged with provider identifiers only.
        console.info(
          "inbox.connectActions: disconnect left a webhook with no key to delete it",
          { webhookId },
        );
      }
    }
    const orphaned = webhookId !== undefined && !webhookDeleted;
    // The local state is cleared whether or not the provider answered — the
    // user asked to disconnect — EXCEPT the webhook id when the registration
    // survived. Keeping it is the only durable record that something is still
    // pointed at this deployment, and `registerOrgWebhook` reclaims exactly
    // that registration (same deterministic `client_id`) on the next connect.
    await ctx.runMutation(internal.inbox.connectionState.releaseInbox, {
      orgId: args.orgId,
      keepWebhookRegistration: orphaned,
    });
    return {
      ok: true as const,
      webhookDeleted,
      ...(orphaned ? { orphanedWebhookId: webhookId } : {}),
    };
  },
});

