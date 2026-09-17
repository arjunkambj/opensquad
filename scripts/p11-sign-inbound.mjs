// scripts/p11-sign-inbound.mjs — probe, not a test file (cf. scripts/p10-probe.sh)
/**
 * P11 signed-inbound probe signer.
 *
 * Fabricates ONE AgentMail webhook event, signs it the way the provider does
 * (svix, over the exact raw body) and POSTs it to the deployment's
 * `/agentmail/webhook`. AgentMail's webhooks API has no resend/replay
 * endpoint (recorded in plan/evidence/P05.md), so a signed fabricated event
 * is the only way to drive duplicate and out-of-order delivery through the
 * real verification path.
 *
 * Usage:
 *   node scripts/p11-sign-inbound.mjs --inbox <inboxRef> --thread <threadId> \
 *        --message <messageId> --from <address> [--subject S] [--text T] \
 *        [--event-id E] [--event-type message.received] \
 *        [--site https://<deployment>.convex.site] \
 *        [--corrupt] [--no-headers] [--bad-headers] [--no-thread]
 *
 * The secret is read from AGENTMAIL_WEBHOOK_SECRET in the environment; it is
 * never printed. Run it against an ISOLATED deployment, or against a shared
 * one only with the integrator's explicit go-ahead — a valid signed event
 * writes real rows.
 *
 * Exercises, by re-running with the same/other arguments:
 *   V16.1 duplicate      — same --event-id twice          → one logical effect
 *   V16.1 same message   — same --message, new --event-id → duplicate_application_key
 *   V16.1 bad signature  — --corrupt                      → HTTP 401, no state
 *   V16.1 unsigned       — --no-headers                   → HTTP 401, no state
 *   V16.1 forged header  — --bad-headers                  → HTTP 401, no state
 *   V16.2 unmatched mail — a --thread no conversation owns → unassigned queue
 *   V16.1 delivery event — --event-type message.delivered → outbound receipt
 *   no-thread regression — --no-thread omits the payload's thread object;
 *                          onMessageReceived must still record it (the fix for
 *                          the BUG recorded in plan/evidence/P11.md)
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
// svix ships transitively (1.99.1) and pnpm does NOT hoist it to
// node_modules/svix, so `require("svix")` throws MODULE_NOT_FOUND from here.
// Resolve it out of this checkout's store instead — the same library the
// component's verifier uses, so a signature this accepts is one the endpoint
// accepts. OPENSQUAD_REPO overrides the repo root when the script is copied
// elsewhere; by default the store next to this file is used.
const REPO =
  process.env.OPENSQUAD_REPO ??
  join(dirname(fileURLToPath(import.meta.url)), "..");
function loadSvix() {
  try {
    return require("svix");
  } catch {
    const { readdirSync } = require("node:fs");
    const store = `${REPO}/node_modules/.pnpm`;
    const dir = readdirSync(store).find((entry) => entry.startsWith("svix@"));
    if (dir === undefined) {
      throw new Error("svix is not installed");
    }
    return require(`${store}/${dir}/node_modules/svix`);
  }
}
const { Webhook } = loadSvix();

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
if (!secret) {
  console.error("AGENTMAIL_WEBHOOK_SECRET is not set");
  process.exit(2);
}

const site = arg("site", process.env.VITE_CONVEX_SITE_URL);
if (!site) {
  console.error("--site or VITE_CONVEX_SITE_URL is required");
  process.exit(2);
}
const eventId = arg("event-id", `evt_p11_${randomUUID()}`);
const messageId = arg("message", `<p11-${randomUUID()}@agentmail.to>`);
const eventType = arg("event-type", "message.received");
const messageFields = {
  inbox_id: arg("inbox"),
  thread_id: arg("thread"),
  message_id: messageId,
  from: arg("from"),
  to: [arg("inbox")],
  subject: arg("subject", "P11 probe reply"),
  text: arg("text", "Sounds good, can you send times next week?"),
  timestamp: new Date().toISOString(),
};
const detailKey = {
  "message.sent": "send",
  "message.delivered": "delivery",
  "message.bounced": "bounce",
  "message.complained": "complaint",
  "message.rejected": "reject",
}[eventType];
const payload = {
  type: "event",
  event_id: eventId,
  event_type: eventType,
  timestamp: new Date().toISOString(),
  // `domain.verified` is the one event type that carries no message.
  ...(eventType === "domain.verified" ? {} : { message: messageFields }),
  // `thread` is OPTIONAL in the provider's own contract (the component's
  // vEvent declares `thread: v.optional(v.any())`). Real mail can arrive
  // without it; --no-thread reproduces that shape.
  ...(flag("no-thread") || eventType === "domain.verified"
    ? {}
    : {
        thread: {
          inbox_id: arg("inbox"),
          thread_id: arg("thread"),
          message_count: 1,
        },
      }),
  // Non-received events also carry the ids under their own sub-object; the
  // component's extractIndexFields reads `message` first either way.
  ...(detailKey !== undefined
    ? {
        [detailKey]: {
          inbox_id: arg("inbox"),
          thread_id: arg("thread"),
          message_id: messageId,
        },
      }
    : {}),
  ...(eventType === "domain.verified"
    ? { domain: { domain: arg("domain", "agentmail.invalid") } }
    : {}),
};

const body = JSON.stringify(payload);
const svixId = `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
const timestamp = new Date();
let signature = new Webhook(secret).sign(svixId, timestamp, body);
if (flag("corrupt")) {
  // Flip one base64 character so the digest is structurally valid and wrong.
  signature = signature.slice(0, -2) + (signature.endsWith("A") ? "B" : "A");
}
if (flag("bad-headers")) {
  // A forged signature that was never produced by the secret: the header
  // block is complete but the digest is fabricated.
  signature = "v1," + Buffer.from(randomUUID()).toString("base64");
}

// Self-check: prove the signer produces a signature the provider's own
// verifier accepts before trusting any result from the deployment. Skipped
// for the deliberately-invalid modes.
if (!flag("corrupt") && !flag("bad-headers")) {
  new Webhook(secret).verify(body, {
    "svix-id": svixId,
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "svix-signature": signature,
  });
}

const headers = { "content-type": "application/json" };
if (!flag("no-headers")) {
  headers["svix-id"] = svixId;
  headers["svix-timestamp"] = String(Math.floor(timestamp.getTime() / 1000));
  headers["svix-signature"] = signature;
}

const response = await fetch(`${site}/agentmail/webhook`, {
  method: "POST",
  headers,
  body,
});
// Provider IDs only — never the address, the subject or the body (G3).
console.log(
  JSON.stringify({
    http: response.status,
    eventId,
    messageId,
    threadId: arg("thread"),
    eventType,
    corrupt: flag("corrupt"),
    noHeaders: flag("no-headers"),
    badHeaders: flag("bad-headers"),
    noThread: flag("no-thread"),
  }),
);
