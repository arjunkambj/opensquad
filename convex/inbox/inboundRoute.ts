/**
 * The per-org inbound route — `POST /agentmail/webhook/<token>`
 * (PLAN §4 "Manage inbox" step 4, §9.4 "Matching").
 *
 * TWO THINGS MUST HOLD before an event is attributed, and the second one is
 * the security boundary:
 *
 *   1. the opaque path token resolves to an org, and the request is
 *      signed by that org's own webhook secret;
 *   2. the event's `inbox_id` equals THAT org's `inboxRef`.
 *
 * Without (2) an org could post a correctly-signed event — signed with
 * its own secret, which it effectively controls — naming another org's
 * inbox, and the inbound callbacks, which resolve an org from `inboxRef`
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
 *
 * THE THREE VARIANTS THAT DO NOT GO TO THE COMPONENT. The provider delivers
 * spam, blocked and unauthenticated mail under their own event types, and the
 * installed component's `events.eventType` validator accepts none of them — so
 * handing one over would throw inside it, 500 this route and make the provider
 * retry that event forever. They are subscribed to anyway, because legitimate
 * senders routinely omit authentication headers and the provider's own thread
 * listing hides all three, so not subscribing means never seeing those replies
 * at all. This route files them itself, through the same single message
 * writer, and the history gate refuses to let automation ANSWER them.
 */
import { internal } from "../_generated/api";
import { httpAction, internalMutation, internalQuery } from "../_generated/server";
import {
  agentmailForWebhookSecret,
  recordInboundMessage,
} from "../integrations/agentmail";
import {
  deliveryClassOf,
  extractEventIds,
  routedReceivedEventType,
} from "../integrations/agentmailApi";
import { decryptSecret } from "../lib/secrets";
import {
  inboundApplicationKey,
  outboundApplicationKey,
  sameInboxRef,
  sha256Hex,
  vQuarantineReason,
  WEBHOOK_TOKEN_LENGTH,
} from "../lib/validators";
import { envelopeOf, readOrgSecret } from "../orgs/secrets";
import { recordQuarantinedEvent, syntheticRef } from "./quarantine";
import {
  verifyAgentMailWebhook,
  WebhookVerificationError,
} from "@agentmail/convex";
import { v } from "convex/values";

/** The mounted path. `http.ts` registers this prefix; the rest is the token. */
export const ORG_WEBHOOK_PATH_PREFIX = "/agentmail/webhook/";

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
  orgId: v.id("orgs"),
  inboxRef: v.optional(v.string()),
  secrets: v.array(v.object({ ciphertext: v.string(), iv: v.string() })),
});

/**
 * Resolve the path token to an org and the webhook secrets currently
 * acceptable for it — the live one, plus the rotated-out one while its overlap
 * is open. Internal: the envelopes are decrypted by the HTTP action.
 */
export const resolveWebhookTarget = internalQuery({
  args: {
    token: v.string(),
    /**
     * The request's arrival time, passed in rather than read here: a Convex
     * query must not read the wall clock (`convex_rules.txt`) — it is not
     * re-run merely because time advances, so a rotation overlap decided from
     * a clock read inside the query could be answered from a cached result
     * taken before or after the window closed. The HTTP action reads the
     * clock once and hands it down.
     */
    at: v.number(),
  },
  returns: v.union(vWebhookTarget, v.null()),
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_webhookToken", (q) => q.eq("webhookToken", args.token))
      .unique();
    if (org === null) {
      return null;
    }
    const row = await readOrgSecret(
      ctx,
      org._id,
      "agentmail_webhook",
    );
    if (row === null) {
      return {
        orgId: org._id,
        ...(org.inboxRef !== undefined
          ? { inboxRef: org.inboxRef }
          : {}),
        secrets: [],
      };
    }
    const envelope = envelopeOf(row, args.at);
    return {
      orgId: org._id,
      ...(org.inboxRef !== undefined
        ? { inboxRef: org.inboxRef }
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
 *
 * `reason` separates the two ways that happens. `inbox_unassigned` is a real
 * foreign inbox, replayable the moment somebody claims it; `event_unparseable`
 * is an envelope that named no inbox, no message or no event id at all, and
 * the caller has keyed it on identifiers it minted so there is at least a row
 * to read.
 */
export const quarantineForeignEvent = internalMutation({
  args: {
    inboxRef: v.string(),
    providerEventId: v.string(),
    providerMessageRef: v.string(),
    providerThreadRef: v.optional(v.string()),
    eventType: v.string(),
    reason: vQuarantineReason,
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
      reason: args.reason,
      note:
        args.reason === "event_unparseable"
          ? "verified event on an organization webhook carried no usable inbox, message or event id"
          : "event arrived on an organization webhook whose inbox it does not name",
    });
    return null;
  },
});

/**
 * Ingest one of the inbound variants the component cannot store.
 *
 * `message.received.spam`, `.blocked` and `.unauthenticated` are separate
 * event types on the provider's side, and the installed component's
 * `events.eventType` validator accepts none of them — handing one to
 * `handleWebhook` throws inside the component, the HTTP action 500s, and the
 * provider retries that event forever (spikes §4). So the route verified the
 * signature and the inbox binding itself, and files the message through the
 * same single writer the ordinary callback uses. Dedupe is unchanged: it is
 * `emailEventReceipts` (provider event id AND application key), not the
 * component's own ledger.
 */
export const ingestRoutedInboundMessage = internalMutation({
  args: {
    message: v.any(),
    eventId: v.string(),
    deliveryClass: v.union(
      v.literal("spam"),
      v.literal("blocked"),
      v.literal("unauthenticated"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordInboundMessage(ctx, {
      message: args.message,
      eventId: args.eventId,
      deliveryClass: args.deliveryClass,
    });
    return null;
  },
});

/**
 * The route itself. Mounted by `convex/http.ts` as a POST prefix route at
 * `/agentmail/webhook/`.
 */
export const inboundWebhook = httpAction(async (ctx, request) => {
  const path = new URL(request.url).pathname;
  const token = path.startsWith(ORG_WEBHOOK_PATH_PREFIX)
    ? path.slice(ORG_WEBHOOK_PATH_PREFIX.length).replace(/\/+$/, "")
    : "";
  if (!WEBHOOK_TOKEN_PATTERN.test(token)) {
    return unauthorized();
  }
  const target = await ctx.runQuery(
    internal.inbox.inboundRoute.resolveWebhookTarget,
    { token, at: Date.now() },
  );
  if (target === null || target.secrets.length === 0) {
    // Unknown token, or an org holding no webhook secret: there is
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
  // `sameInboxRef`, not `!==`. The binding is still exactly as strict — the
  // event must name THIS route's inbox — but inbox references are addresses
  // and the rest of the codebase treats them case-insensitively. Comparing
  // exactly here quarantined a perfectly ordinary event under a reference no
  // assignment matches, so `quarantine.replayForInbox` (which ranges on the
  // org's own stored reference) could never release it.
  if (
    ids.inboxId === undefined ||
    target.inboxRef === undefined ||
    !sameInboxRef(ids.inboxId, target.inboxRef)
  ) {
    // Provider identifiers only — never addresses or bodies.
    console.info("inbox.inboundRoute: event inbox does not match this route", {
      eventId,
      eventType,
      eventInbox: ids.inboxId,
    });
    // EVERY verified-but-unattributable event is quarantined (PLAN §9.4),
    // including the ones whose envelope named no inbox, no message or no
    // event id. Those used to be acknowledged and forgotten, which is a
    // permanent loss: the component has already marked `event_id` ingested,
    // so the provider never resends. What the envelope did not carry is
    // replaced by a key minted from the delivery itself — the `svix-id`, or a
    // digest of the body — so a resend dedupes onto the same row instead of
    // piling up, and `quarantine.replayOne` recognises the minted keys and
    // never tries to replay a message that does not exist.
    const unparseable =
      ids.inboxId === undefined || ids.messageId === undefined || eventId === "";
    const seed =
      headers["svix-id"].length > 0 ? headers["svix-id"] : await sha256Hex(raw);
    await ctx.runMutation(internal.inbox.inboundRoute.quarantineForeignEvent, {
      inboxRef: ids.inboxId ?? syntheticRef("inbox", seed),
      providerEventId: eventId !== "" ? eventId : syntheticRef("event", seed),
      providerMessageRef: ids.messageId ?? syntheticRef("message", seed),
      ...(ids.threadId !== undefined
        ? { providerThreadRef: ids.threadId }
        : {}),
      eventType: eventType.length > 0 ? eventType : "unknown",
      reason: unparseable
        ? ("event_unparseable" as const)
        : ("inbox_unassigned" as const),
    });
    return held();
  }

  // Verified AND bound to this org's inbox — but not every inbound event may
  // be handed to the component. The three `message.received.*` variants are
  // event types its `events.eventType` validator rejects, so passing one on
  // would throw inside it, 500 this action and make the provider retry the
  // event forever. They are ingested here instead, through the same single
  // message writer, and answered by nobody (`delivery_unverified`).
  const routed = routedReceivedEventType(eventType);
  if (routed !== undefined) {
    const envelope = event as { message?: unknown };
    await ctx.runMutation(
      internal.inbox.inboundRoute.ingestRoutedInboundMessage,
      {
        message: envelope.message ?? null,
        // The provider's event id when it sent one, else the delivery's own
        // `svix-id` — the same seed the quarantine keys mint from, so a
        // resend still dedupes rather than landing twice.
        eventId: eventId !== "" ? eventId : headers["svix-id"],
        deliveryClass: deliveryClassOf(routed),
      },
    );
    return held();
  }

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
