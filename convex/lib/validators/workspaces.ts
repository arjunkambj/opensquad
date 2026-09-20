/**
 * Workspace validators: membership roles, the plan literal, the inbox
 * connection state and the shape of a stored provider secret.
 */
import { v } from "convex/values";

export const vRole = v.union(
  v.literal("owner"),
  v.literal("operator"),
  v.literal("viewer"),
);

export const vMembershipStatus = v.union(
  v.literal("active"),
  v.literal("revoked"),
);

/**
 * One plan, no upgrade path, no billing UI (PLAN §6). It is stored rather
 * than assumed so the limit lookup can become a real plan map later without
 * touching a call site.
 */
export const vWorkspacePlan = v.literal("trial");

export type WorkspacePlan = "trial";

/**
 * How the workspace's sending inbox is attached (PLAN §4, §9.4).
 * `legacy_platform_inbox` is a workspace created before the pivot that still
 * receives on the platform account: readable in the Inbox, never
 * auto-answered, and unable to send until its owner connects their own key.
 */
export const vInboxConnection = v.union(
  v.literal("none"),
  v.literal("legacy_platform_inbox"),
  v.literal("connected"),
  v.literal("invalid"),
);

export type InboxConnection =
  | "none"
  | "legacy_platform_inbox"
  | "connected"
  | "invalid";

/** The two secrets a connected workspace holds (PLAN §4 "Bring-your-own keys"). */
export const vSecretProvider = v.union(
  v.literal("agentmail"),
  v.literal("agentmail_webhook"),
);

export type SecretProvider = "agentmail" | "agentmail_webhook";

/** What the last verification of that secret concluded. */
export const vSecretStatus = v.union(
  v.literal("unverified"),
  v.literal("valid"),
  v.literal("invalid"),
);

export type SecretStatus = "unverified" | "valid" | "invalid";

/** Length of the opaque per-workspace webhook path token. */
export const WEBHOOK_TOKEN_LENGTH = 32;
