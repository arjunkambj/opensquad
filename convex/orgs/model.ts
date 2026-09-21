/**
 * Orgs — architecture §3.1/§5.
 *
 * One row per Hexclave organization, holding the policy every other domain
 * reads (timezone, send window, automation state, webhook token) and giving
 * credits, the inbox connection and the agent a home. It owns no agent, lead
 * or sending behaviour, and it does NOT own who belongs to the organization:
 * the auth provider does, and `requireOrgMember` answers that from the token
 * (PLAN §4).
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createDraftAgent } from "../agents/model";
import { trialCapacityOpen } from "../billing/platformBudgets";
import {
  claimTrialGrant,
  findTrialClaim,
  grantTrialBuckets,
} from "../billing/trialBuckets";
import { activeHexclaveOrgId, requireVerifiedUser } from "../lib/auth";
import { requireRateLimit } from "../lib/rateLimits";
import {
  assertIanaTimezone,
  boundedInt,
  boundedString,
  domainError,
  invalid,
  WEBHOOK_TOKEN_LENGTH,
} from "../lib/validators";
import { orgFields } from "../schema";
import type { UserIdentity } from "convex/server";
import { v } from "convex/values";

export const vOrgDoc = v.object({
  _id: v.id("orgs"),
  _creationTime: v.number(),
  ...orgFields,
});

/**
 * What a member's browser may see of an org. `webhookToken` is the only
 * thing that resolves an inbound mail request to this org (PLAN §9.4),
 * so it and the provider's webhook id never leave the server.
 */
const {
  webhookToken: _webhookTokenField,
  agentmailWebhookId: _webhookIdField,
  ...orgViewFields
} = orgFields;

export const vOrgView = v.object({
  _id: v.id("orgs"),
  _creationTime: v.number(),
  ...orgViewFields,
});

export function toOrgView(org: Doc<"orgs">) {
  const {
    webhookToken: _webhookToken,
    agentmailWebhookId: _webhookId,
    ...view
  } = org;
  return view;
}

/**
 * The opaque token in this org's inbound webhook path. Generated from
 * the runtime CSPRNG and never derived from anything a caller can see: the
 * path is the ONLY thing that resolves an inbound request to an org, so
 * a guessable token would be a way in (PLAN §9.4).
 */
export function generateWebhookToken(): string {
  const bytes = new Uint8Array(WEBHOOK_TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function defaultOrgName(identity: UserIdentity): string {
  const display = identity.name ?? identity.email;
  if (display !== undefined) {
    const trimmed = display.trim().slice(0, 60);
    if (trimmed.length > 0) {
      return `${trimmed}'s organization`;
    }
  }
  return "My organization";
}

type EnsureOrgArgs = {
  requestId?: string;
  name?: string;
  timezone?: string;
};

/**
 * Idempotent provisioning of the row for the org ACTIVE in the caller's
 * token: ONE transaction creates the org, the draft agent onboarding fills
 * in and — for a first org only — the trial credit grant. All of it or none:
 * an org that existed for an instant without an agent would have nowhere to
 * save an onboarding answer.
 *
 * EXACTLY ONE ROW PER HEXCLAVE ORG. The `by_hexclaveOrgId` range is read in
 * the same transaction as the insert, so however many members of one
 * organization race into the app, the losing transaction is retried by Convex
 * and then observes the committed row. `requestId` is accepted for
 * forward-compatible retries; the org-keyed dedup already subsumes it, so it
 * is intentionally not persisted.
 *
 * Three rules from PLAN §6 "Closing the ways in" meet here:
 *   VERIFIED EMAIL. `requireVerifiedUser`, only on this path; every other
 *   entry point keeps `requireUser`.
 *   ONE TRIAL PER USER. Anyone can create unlimited organizations in the
 *   auth provider, so the grant cannot follow the organization: only the
 *   FIRST org a given verified identity initialises is granted credits.
 *   Every later one is created in the already-designed "no credit grant"
 *   state, where each paid call refuses with `NO_CREDIT_GRANT`.
 *   TRIAL CAPACITY. `MAX_TRIAL_ORGS` refuses a new GRANT once the platform is
 *   full; an organization that already has its row is returned it regardless,
 *   so the cap never locks anyone out of what they already have.
 */
export async function ensureOrgImpl(
  ctx: MutationCtx,
  args: EnsureOrgArgs,
): Promise<{ orgId: Id<"orgs">; created: boolean }> {
  const { identity, identityKey } = await requireVerifiedUser(ctx);
  // The credit grant is handed out on this path, and a draft agent is
  // written with it, so it is rate-limited per identity like every other
  // credit-spending entry point (PLAN §6 "Closing the ways in"). At the TOP,
  // before a single read: a refused call must leave nothing behind.
  await requireRateLimit(ctx, "ensureOrg", identityKey);
  const hexclaveOrgId = activeHexclaveOrgId(identity);
  if (hexclaveOrgId === null) {
    throw domainError(
      "NO_ACTIVE_ORG",
      "no organization is active for this account",
    );
  }

  // The uniqueness read: one row per Hexclave org, made a constraint by
  // happening inside the transaction that inserts.
  const existing = await ctx.db
    .query("orgs")
    .withIndex("by_hexclaveOrgId", (q) => q.eq("hexclaveOrgId", hexclaveOrgId))
    .first();
  if (existing !== null) {
    return { orgId: existing._id, created: false };
  }

  // The money rule (PLAN §6): the grant is per IDENTITY, not per
  // organization, because creating organizations is free and unlimited in the
  // auth provider.
  //
  // The CLAIM ROW is what makes that a constraint. Reading `orgs` by the
  // creator and then inserting a DIFFERENT org left the rule resting on an
  // inference about what Convex conflicts; this reads and WRITES one document
  // keyed by the identity, so the second of two parallel calls is conflicted
  // by the first's insert into the range it read, retried, and then sees the
  // committed claim.
  //
  // Trial identity is `tokenIdentifier` (`iss|sub`), NOT a verified email: a
  // person who signs in under a second auth `sub` is a second identity and
  // would be granted again. Accepted and documented rather than papered over
  // — `MAX_TRIAL_ORGS` still bounds the total, and an email is a claim the
  // provider does not promise to keep stable.
  const claim = await findTrialClaim(ctx, identityKey);
  const grantTrial = claim === null;

  // Only a grant is subject to the platform's signup capacity: the cap bounds
  // the trials we FUND. An org created with no grant can spend nothing, so
  // waitlisting it would protect no money and would lock an account out of
  // its own second organization.
  if (grantTrial && !(await trialCapacityOpen(ctx))) {
    throw domainError(
      "TRIAL_CAPACITY_REACHED",
      "the trial is full; new organizations are waitlisted",
    );
  }

  const name =
    args.name !== undefined
      ? boundedString(args.name, "name", { min: 1, max: 100 })
      : defaultOrgName(identity);
  const timezone =
    args.timezone !== undefined ? assertIanaTimezone(args.timezone) : "UTC";

  const now = Date.now();
  const orgId = await ctx.db.insert("orgs", {
    name,
    hexclaveOrgId,
    createdByIdentityKey: identityKey,
    timezone,
    plan: "trial",
    // Conservative default: automation stays paused until setup is finished
    // and someone explicitly activates it.
    automationState: "paused",
    pauseReason: "onboarding_pending",
    policyVersion: 1,
    dailySendLimit: 10,
    sendWindow: {
      weekdays: [1, 2, 3, 4, 5],
      startMinute: 9 * 60,
      endMinute: 17 * 60,
    },
    // No inbox yet: the agent starts in sourcing-only mode and the inbox is
    // connected from onboarding or Settings (PLAN §4).
    inboxConnection: "none",
    // The opaque path token of this org's inbound webhook route. It is
    // generated once, here, from the runtime CSPRNG — never derived from the
    // org id, which is not secret.
    webhookToken: generateWebhookToken(),
    // No verified open event has been seen, so the Agent card shows no
    // "Opened" column at all (PLAN §9.6).
    opensObserved: false,
    createdAt: now,
    updatedAt: now,
  });

  // The trial grant is part of creating the FIRST org, never implied and
  // never lazy: no bucket means every paid call refuses (PLAN §6). The claim
  // is taken in the same transaction as the buckets, so the two can never
  // disagree about who has been funded.
  if (grantTrial) {
    await claimTrialGrant(ctx, identityKey, orgId);
    await grantTrialBuckets(ctx, orgId);
  }

  // The one draft agent, so onboarding progress always has a home.
  await createDraftAgent(ctx, orgId);

  return { orgId, created: true };
}

export function assertSendWindow(window: {
  weekdays: number[];
  startMinute: number;
  endMinute: number;
}): void {
  if (window.weekdays.length === 0 || window.weekdays.length > 7) {
    throw invalid("sendWindow.weekdays must contain 1–7 days");
  }
  const unique = new Set(window.weekdays);
  if (unique.size !== window.weekdays.length) {
    throw invalid("sendWindow.weekdays must not contain duplicates");
  }
  for (const day of window.weekdays) {
    boundedInt(day, "sendWindow.weekdays", { min: 0, max: 6 });
  }
  boundedInt(window.startMinute, "sendWindow.startMinute", {
    min: 0,
    max: 1439,
  });
  boundedInt(window.endMinute, "sendWindow.endMinute", { min: 0, max: 1439 });
  if (window.startMinute >= window.endMinute) {
    throw invalid("sendWindow.startMinute must precede endMinute");
  }
}
