/**
 * Org validators: the plan literal, the inbox connection state and the shape
 * of a stored provider secret.
 *
 * Who belongs to an org is not modelled here at all. The auth provider owns
 * that, and the signed token's active-org claim is the whole answer (PLAN
 * §4) — there is no role vocabulary and no per-org member record.
 */
import { v } from "convex/values";

/**
 * One plan, no upgrade path, no billing UI (PLAN §6). It is stored rather
 * than assumed so the limit lookup can become a real plan map later without
 * touching a call site.
 */
export const vOrgPlan = v.literal("trial");

export type OrgPlan = "trial";

/**
 * How the org's sending inbox is attached (PLAN §4, §9.4).
 * `legacy_platform_inbox` is an org created before the pivot that still
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

/** The two secrets a connected org holds (PLAN §4 "Bring-your-own keys"). */
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

/** Length of the opaque per-org webhook path token. */
export const WEBHOOK_TOKEN_LENGTH = 32;

/**
 * Upper bound on the org's default outreach instructions, in characters.
 *
 * It bounds a value that is concatenated into every outreach prompt, so it is
 * a cost and prompt-safety limit as much as a storage one. Long enough for a
 * few paragraphs of voice and rules; short enough that it cannot become a
 * pasted-in playbook.
 *
 * Lives here rather than beside the functions that enforce it because the
 * Settings editor needs the same number: importing it from
 * `orgs/outreachDefaults.ts` evaluated that module in the browser and
 * registered its query and mutation there, which Convex warns will become an
 * error. This folder holds no functions, so the client may import it.
 */
export const DEFAULT_INSTRUCTIONS_MAX_LENGTH = 2000;
