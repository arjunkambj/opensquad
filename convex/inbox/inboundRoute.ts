/**
 * The per-workspace inbound route — `POST /agentmail/webhook/<token>`
 * (PLAN §4 "Manage inbox" step 4, §9.4 "Matching").
 *
 * TWO THINGS MUST HOLD before an event is attributed, and the second one is
 * the security boundary:
 *
 *   1. the opaque path token resolves to a workspace, and the request is
 *      signed by that workspace's own webhook secret;
 *   2. the event's `inbox_id` equals THAT workspace's `inboxRef`.
 *
 * Without (2) a workspace could post a correctly-signed event — signed with
 * its own secret, which it effectively controls — naming another workspace's
 * inbox, and the inbound callbacks, which resolve a workspace from `inboxRef`
 * alone, would file it there. So the binding is checked here, before the
 * component stores anything, and a mismatch is QUARANTINED rather than
 * attributed or dropped.
 *
 * WHY THE SIGNATURE IS VERIFIED TWICE. Deciding "accept or quarantine" needs
 * the event body, and reading an unverified body would let an unsigned request
 * fill the quarantine table. So this route verifies first, then hands the
 * untouched raw request to a per-request
 * `new AgentMail(components.agentmail, { webhookSecret })`, which re-verifies
 * and owns what it always owned: `event_id` dedupe, inbound message storage
 * and the callback dispatch. The component remains the authority; this is a
 * guard in front of it.
 *
 * ROTATION. During the ten-minute overlap the previous webhook secret is
 * accepted too, so an event signed mid-swap is not lost.
 */
import { internal } from "../_generated/api";
import { httpAction, internalMutation, internalQuery } from "../_generated/server";
import { agentmailForWebhookSecret } from "../integrations/agentmail";
import { extractEventIds } from "../integrations/agentmailApi";
import { decryptSecret } from "../lib/secrets";
import {
  inboundApplicationKey,
  outboundApplicationKey,
  WEBHOOK_TOKEN_LENGTH,
} from "../lib/validators";
import { envelopeOf, readWorkspaceSecret } from "../workspaces/secrets";
import { recordQuarantinedEvent } from "./quarantine";
import {
  verifyAgentMailWebhook,
  WebhookVerificationError,
} from "@agentmail/convex";
import { v } from "convex/values";

/** The mounted path. `http.ts` registers this prefix; the rest is the token. */
export const WORKSPACE_WEBHOOK_PATH_PREFIX = "/agentmail/webhook/";

/** Hex, so twice the byte length. Anything else is not one of our tokens. */
const WEBHOOK_TOKEN_PATTERN = new RegExp(
  `^[0-9a-f]{${WEBHOOK_TOKEN_LENGTH * 2}}$`,
);

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: { code: "UNAUTHORIZED", message: "invalid signature" } }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

/** Verified, but not ours to file: recorded and acknowledged, never retried. */
function held(): Response {
  return new Response(null, { status: 202 });
}

const vWebhookTarget = v.object({
  workspaceId: v.id("workspaces"),
  inboxRef: v.optional(v.string()),
  secrets: v.array(v.object({ ciphertext: v.string(), iv: v.string() })),
});

/**
 * Resolve the path token to a workspace and the webhook secrets currently
 * acceptable for it — the live one, plus the rotated-out one while its overlap
 * is open. Internal: the envelopes are decrypted by the HTTP action.
 */
export const resolveWebhookTarget = internalQuery({
  args: { token: v.string() },
  returns: v.union(vWebhookTarget, v.null()),
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_webhookToken", (q) => q.eq("webhookToken", args.token))
      .unique();
    if (workspace === null) {
      return null;
    }
    const row = await readWorkspaceSecret(
      ctx,
      workspace._id,
      "agentmail_webhook",
    );
    if (row === null) {
      return {
        workspaceId: workspace._id,
        ...(workspace.inboxRef !== undefined
          ? { inboxRef: workspace.inboxRef }
          : {}),
        secrets: [],
      };
    }
    const envelope = envelopeOf(row, Date.now());
    return {
      workspaceId: workspace._id,
      ...(workspace.inboxRef !== undefined
        ? { inboxRef: workspace.inboxRef }
        : {}),
      secrets: [
        { ciphertext: envelope.ciphertext, iv: envelope.iv },
        ...(envelope.previous !== undefined
          ? [
              {
                ciphertext: envelope.previous.ciphertext,
                iv: envelope.previous.iv,
              },
            ]
          : []),
      ],
    };
  },
});

/**
 * Hold a verified event whose `inbox_id` is not this route's inbox. It is
 * recorded rather than dropped for the same reason every other unattributable
 * event is: the provider will not resend it once we have answered 2xx.
 */
export const quarantineForeignEvent = internalMutation({
  args: {
    inboxRef: v.string(),
    providerEventId: v.string(),
    providerMessageRef: v.string(),
    providerThreadRef: v.optional(v.string()),
    eventType: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const applicationKey =
      args.eventType === "message.received"
        ? inboundApplicationKey(args.inboxRef, args.providerMessageRef)
        : outboundApplicationKey(args.providerMessageRef, args.eventType);
    await recordQuarantinedEvent(ctx, {
      inboxRef: args.inboxRef,
      providerEventId: args.providerEventId,
      applicationKey,
      providerMessageRef: args.providerMessageRef,
      ...(args.providerThreadRef !== undefined
        ? { providerThreadRef: args.providerThreadRef }
        : {}),
      eventType: args.eventType,
      // The closest truthful reason in the closed vocabulary: this route
      // cannot attribute the inbox it was handed. `note` records that the
      // cause was a token/inbox mismatch rather than a missing assignment.
      reason: "inbox_unassigned",
      note: "event arrived on a workspace webhook whose inbox it does not name",
    });
    return null;
  },
});

/**
 * The route itself. Mounted by `convex/http.ts` as a POST prefix route, so the
 * legacy exact path `/agentmail/webhook` keeps its own handler.
 */
export const inboundWebhook = httpAction(async (ctx, request) => {
  const path = new URL(request.url).pathname;
  const token = path.startsWith(WORKSPACE_WEBHOOK_PATH_PREFIX)
    ? path.slice(WORKSPACE_WEBHOOK_PATH_PREFIX.length).replace(/\/+$/, "")
    : "";
  if (!WEBHOOK_TOKEN_PATTERN.test(token)) {
    return unauthorized();
  }
  const target = await ctx.runQuery(
    internal.inbox.inboundRoute.resolveWebhookTarget,
    { token },
  );
  if (target === null || target.secrets.length === 0) {
    // Unknown token, or a workspace holding no webhook secret: there is
    // nothing to verify against, so the request is refused rather than
    // trusted. The provider retries, which is what we want during the brief
    // window of a re-registration.
    return unauthorized();
  }

  const raw = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };
  let event: unknown;
  let verifiedSecret: string | undefined;
  for (const envelope of target.secrets) {
    const secret = await decryptSecret(envelope);
    try {
      event = verifyAgentMailWebhook(secret, raw, headers);
      verifiedSecret = secret;
      break;
    } catch (error) {
      if (!(error instanceof WebhookVerificationError)) {
        throw error;
      }
    }
  }
  if (verifiedSecret === undefined) {
    return unauthorized();
  }

  const ids = extractEventIds(event);
  const record = event as { event_id?: unknown; event_type?: unknown };
  const eventId = typeof record.event_id === "string" ? record.event_id : "";
  const eventType =
    typeof record.event_type === "string" ? record.event_type : "";
  if (
    ids.inboxId === undefined ||
    target.inboxRef === undefined ||
    ids.inboxId !== target.inboxRef
  ) {
    // Provider identifiers only — never addresses or bodies.
    console.info("inbox.inboundRoute: event inbox does not match this route", {
      eventId,
      eventType,
      eventInbox: ids.inboxId,
    });
    if (ids.inboxId !== undefined && ids.messageId !== undefined && eventId !== "") {
      await ctx.runMutation(
        internal.inbox.inboundRoute.quarantineForeignEvent,
        {
          inboxRef: ids.inboxId,
          providerEventId: eventId,
          providerMessageRef: ids.messageId,
          ...(ids.threadId !== undefined
            ? { providerThreadRef: ids.threadId }
            : {}),
          eventType: eventType.length > 0 ? eventType : "unknown",
        },
      );
    }
    return held();
  }

  // Verified AND bound to this workspace's inbox. The component re-verifies,
  // dedupes on `event_id`, stores the inbound message and dispatches the
  // app-side callbacks — unchanged behaviour, per-request credentials.
  const client = agentmailForWebhookSecret(verifiedSecret);
  return await client.handleWebhook(
    {
      // The component only ever calls `runMutation(mutation, args)`; the
      // adapter drops the unused options element of the ArgsAndOptions
      // signature its type declares (same note as convex/http.ts).
      runMutation: ((mutation, mutationArgs) =>
        ctx.runMutation(mutation, mutationArgs)) as Parameters<
        typeof client.handleWebhook
      >[0]["runMutation"],
    },
    new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: raw,
    }),
  );
});
