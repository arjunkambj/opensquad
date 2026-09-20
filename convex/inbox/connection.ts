/**
 * Manage inbox — the shared vocabulary and the client-visible read surface
 * (PLAN §4 "Manage inbox", §9.4).
 *
 * The flow is split across three files by step, because it is three different
 * kinds of code: this one reads, `connectActions.ts` talks to the provider,
 * and `connectionState.ts` writes the connection state transactionally.
 *
 * WHAT A CLIENT SEES. `getInboxConnection` returns `{ status, last4,
 * inboxAddress, lastEventAt, sync }` plus the connection state the screen
 * switches on. No ciphertext, no IV, no key, no provider error text.
 */
import type { Id } from "../_generated/dataModel";
import { internalQuery, query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { agentmailFailureMessage } from "../integrations/agentmailApi";
import type { AgentMailErrorCode } from "../integrations/agentmailApi";
import { requireWorkspaceOwner } from "../lib/auth";
import { vInboxConnection, vSecretStatus } from "../lib/validators";
import {
  readWorkspaceSecret,
  summariseSecret,
  vSecretSummary,
} from "../workspaces/secrets";
import { readInboxSync, vInboxSync } from "./backfill";
import { v } from "convex/values";

/** Why the workspace's automation is paused, when WE paused it. */
export const INBOX_DISCONNECTED_PAUSE_REASON = "inbox_disconnected";
export const INBOX_KEY_INVALID_PAUSE_REASON = "inbox_key_invalid";

export const OUR_PAUSE_REASONS: ReadonlySet<string> = new Set([
  INBOX_DISCONNECTED_PAUSE_REASON,
  INBOX_KEY_INVALID_PAUSE_REASON,
]);

/** Conversations read per state when dating the last inbound event. */
const LAST_EVENT_SCAN_LIMIT = 5;

/**
 * Our OWN failure vocabulary for the connect flow. Provider wording never
 * reaches a client (PLAN §4 white-label rule); these map to copy in the UI.
 */
export const INBOX_CONNECT_ERROR_CODES = [
  "key_rejected",
  "provider_unavailable",
  "no_stored_key",
  "secrets_unconfigured",
  "site_url_missing",
  "inbox_not_found",
  "inbox_claimed_elsewhere",
  "inbox_not_visible_to_key",
  "webhook_registration_failed",
  "not_connected",
] as const;

export const vInboxConnectErrorCode = v.union(
  ...INBOX_CONNECT_ERROR_CODES.map((code) => v.literal(code)),
);

export type InboxConnectErrorCode = (typeof INBOX_CONNECT_ERROR_CODES)[number];

export const vFailure = v.object({
  ok: v.literal(false),
  code: vInboxConnectErrorCode,
  message: v.string(),
});

export function failure(
  code: InboxConnectErrorCode,
  message: string,
): { ok: false; code: InboxConnectErrorCode; message: string } {
  return { ok: false, code, message };
}

/** Map a provider failure onto our own vocabulary. */
export function mapProviderFailure(code: AgentMailErrorCode): {
  ok: false;
  code: InboxConnectErrorCode;
  message: string;
} {
  if (code === "unauthorized" || code === "forbidden") {
    return failure("key_rejected", agentmailFailureMessage(code));
  }
  if (code === "not_found") {
    return failure("inbox_not_found", agentmailFailureMessage(code));
  }
  return failure("provider_unavailable", agentmailFailureMessage(code));
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

const vConnectionOwner = v.object({
  workspaceId: v.id("workspaces"),
  webhookToken: v.string(),
  inboxConnection: vInboxConnection,
  inboxRef: v.optional(v.string()),
  agentmailWebhookId: v.optional(v.string()),
  connectedAt: v.optional(v.number()),
});

/**
 * Owner guard for the connect actions. An action cannot read the database, so
 * the guard runs here and returns only the fields the flow needs — never the
 * whole workspace document, which carries the webhook token's siblings.
 */
export const requireConnectionOwner = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: vConnectionOwner,
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceOwner(ctx, args.workspaceId);
    return {
      workspaceId: workspace._id,
      webhookToken: workspace.webhookToken,
      inboxConnection: workspace.inboxConnection,
      ...(workspace.inboxRef !== undefined
        ? { inboxRef: workspace.inboxRef }
        : {}),
      ...(workspace.agentmailWebhookId !== undefined
        ? { agentmailWebhookId: workspace.agentmailWebhookId }
        : {}),
      ...(workspace.connectedAt !== undefined
        ? { connectedAt: workspace.connectedAt }
        : {}),
    };
  },
});

/**
 * When this workspace last received mail — the "webhook health" line in
 * Manage inbox.
 *
 * Derived from `conversations.lastInboundAt`, which only an ingested inbound
 * message writes (live or imported). The scan is bounded: the newest few
 * threads per state, which is where a recent event necessarily is.
 */
async function lastInboundAt(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
): Promise<number | undefined> {
  let newest: number | undefined;
  for (const state of ["open", "unassigned", "closed"] as const) {
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_workspaceId_and_state_and_lastMessageAt", (q) =>
        q.eq("workspaceId", workspaceId).eq("state", state),
      )
      .order("desc")
      .take(LAST_EVENT_SCAN_LIMIT);
    for (const row of rows) {
      if (row.lastInboundAt !== undefined) {
        newest =
          newest === undefined
            ? row.lastInboundAt
            : Math.max(newest, row.lastInboundAt);
      }
    }
  }
  return newest;
}

export const vInboxConnectionView = v.object({
  /** How the sending inbox is attached; the screen switches on this. */
  connection: vInboxConnection,
  /** The stored key's verification status, or `missing`. */
  status: v.union(vSecretStatus, v.literal("missing")),
  last4: v.optional(v.string()),
  inboxAddress: v.optional(v.string()),
  lastEventAt: v.optional(v.number()),
  sync: vInboxSync,
  connectedAt: v.optional(v.number()),
  /** Whether this workspace may send at all (legacy inboxes may not). */
  canSend: v.boolean(),
  webhook: v.object({ registered: v.boolean(), secret: vSecretSummary }),
});

/** The whole Manage-inbox surface, in one member-guarded read. */
export const getInboxConnection = query({
  args: { workspaceId: v.id("workspaces") },
  returns: vInboxConnectionView,
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceOwner(ctx, args.workspaceId);
    const key = await readWorkspaceSecret(ctx, workspace._id, "agentmail");
    const webhookSecret = await readWorkspaceSecret(
      ctx,
      workspace._id,
      "agentmail_webhook",
    );
    const summary = summariseSecret(key);
    const eventAt = await lastInboundAt(ctx, workspace._id);
    return {
      connection: workspace.inboxConnection,
      status: summary.status,
      ...(summary.last4 !== undefined ? { last4: summary.last4 } : {}),
      // AgentMail inbox ids ARE mailbox addresses, so the reference is the
      // address; nothing else about the inbox is stored.
      ...(workspace.inboxRef !== undefined
        ? { inboxAddress: workspace.inboxRef }
        : {}),
      ...(eventAt !== undefined ? { lastEventAt: eventAt } : {}),
      sync: await readInboxSync(ctx, workspace._id, workspace.connectedAt),
      ...(workspace.connectedAt !== undefined
        ? { connectedAt: workspace.connectedAt }
        : {}),
      canSend: workspace.inboxConnection === "connected",
      webhook: {
        registered: workspace.agentmailWebhookId !== undefined,
        secret: summariseSecret(webhookSecret),
      },
    };
  },
});

