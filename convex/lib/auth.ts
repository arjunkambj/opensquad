/**
 * Typed identity and tenancy guards for OpenIntent functions.
 *
 * The browser supplies business arguments only — never an authoritative
 * `userId`, owner or team claim. Every entry point resolves the verified
 * JWT identity through `ctx.auth.getUserIdentity()` and derives the stable
 * `identityKey` from `tokenIdentifier` (`iss|sub`; see plan/evidence/P01.md).
 *
 * The tenant is the Hexclave ORGANIZATION, and the org ACTIVE in Hexclave is
 * the source of truth (PLAN §4, owner decision 2026-09-21). The token carries
 * that org in its `selected_team_id` claim; an org row is reachable to a
 * caller when, and only when, its `hexclaveOrgId` equals that claim. There is
 * no member table and no role vocabulary on our side: the auth provider
 * owns who belongs to an org, and every member of the active org may use the
 * whole product.
 *
 * Hexclave publishes two `customJwt` issuers for one project: real users under
 * `…/api/v1/projects/{id}` and anonymous users under
 * `…/api/v1/projects-anonymous-users/{id}` (`aud` is unbound by the provider
 * config, so the exact `iss` match carries the security check). OpenIntent
 * orgs belong to real accounts, so `requireUser` rejects the anonymous
 * issuer explicitly.
 */
import type { Auth, GenericDatabaseReader, UserIdentity } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { domainError } from "./validators";

/** Minimal context shape shared by query and mutation handlers. */
export type AuthCtx = {
  auth: Auth;
  db: GenericDatabaseReader<DataModel>;
};

export type AuthenticatedUser = {
  identity: UserIdentity;
  /** Stable key stored on org and lead rows: `tokenIdentifier`. */
  identityKey: string;
};

export type OrgContext = AuthenticatedUser & {
  org: Doc<"orgs">;
};

/**
 * The issuer that signs real (non-anonymous) Hexclave users for this project.
 * `VITE_HEXCLAVE_PROJECT_ID` is a deployment env var already consumed by
 * `convex/auth.config.ts`; a missing value fails closed.
 */
export function expectedUsersIssuer(): string {
  const projectId = process.env.VITE_HEXCLAVE_PROJECT_ID;
  if (projectId === undefined || projectId === "") {
    throw domainError(
      "FORBIDDEN",
      "authentication provider is not configured on this deployment",
    );
  }
  return `https://api.hexclave.com/api/v1/projects/${projectId}`;
}

/** Verified identity for the caller, or `null` when signed out. */
export async function getUserIdentity(
  ctx: AuthCtx,
): Promise<UserIdentity | null> {
  return ctx.auth.getUserIdentity();
}

/**
 * Verified, non-anonymous identity. Rejects signed-out callers and tokens from
 * the anonymous-users issuer (or any issuer outside this Hexclave project).
 */
export async function requireUser(ctx: AuthCtx): Promise<AuthenticatedUser> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw domainError("UNAUTHENTICATED", "sign in required");
  }
  if (identity.issuer !== expectedUsersIssuer()) {
    throw domainError(
      "FORBIDDEN",
      "anonymous or foreign-issuer sessions cannot use organization APIs",
    );
  }
  return { identity, identityKey: identity.tokenIdentifier };
}

/**
 * A verified account — the gate in front of creating an org
 * (PLAN §6 "Closing the ways in", spikes §5).
 *
 * Read entirely from the token: the identity provider's access token carries
 * `email_verified` as a required claim, which Convex maps onto
 * `UserIdentity.emailVerified`, so this costs no network call and no secret
 * key. Strict equality against `true` means an ABSENT claim fails closed — a
 * missing claim would mean the provider or its configuration changed, which
 * is not a reason to hand someone a credit grant.
 *
 * `is_restricted` is refused as defence in depth. Every OTHER entry point
 * keeps `requireUser`, so an unverified account can still sign in and see the
 * "verify your email" state instead of looking signed out.
 */
export async function requireVerifiedUser(
  ctx: AuthCtx,
): Promise<AuthenticatedUser> {
  const user = await requireUser(ctx);
  const { identity } = user;
  if (identity["is_restricted"] === true) {
    throw domainError("ACCOUNT_RESTRICTED", "this account is not fully set up");
  }
  if (identity.emailVerified !== true) {
    throw domainError(
      "EMAIL_NOT_VERIFIED",
      "verify your email address before creating an organization",
    );
  }
  if (typeof identity.email !== "string" || identity.email.length === 0) {
    throw domainError(
      "EMAIL_NOT_VERIFIED",
      "an account email is required to create an organization",
    );
  }
  return user;
}

/**
 * The Hexclave organization the caller's token has ACTIVE, or `null`.
 *
 * `selected_team_id` is a custom claim, so it arrives through the identity's
 * index signature rather than a typed field (spikes §5). It is `null` — or,
 * if the provider ever stops issuing it, absent — for a user who has no
 * active org, which is a state the client resolves by selecting one, not an
 * error. This is the ONE place the claim is read.
 */
export function activeHexclaveOrgId(identity: UserIdentity): string | null {
  const claim = identity["selected_team_id"];
  return typeof claim === "string" && claim.length > 0 ? claim : null;
}

/**
 * Resolve identity and org for a request, authorising ONLY when the org row
 * belongs to the organization active in the caller's token.
 *
 * Returns `NOT_FOUND` when the row does not exist, when the token has no
 * active org, and when the row belongs to a different org — a caller must
 * never learn that another organization's row exists.
 */
export async function requireOrgMember(
  ctx: AuthCtx,
  orgId: Id<"orgs">,
): Promise<OrgContext> {
  const user = await requireUser(ctx);
  const activeOrgId = activeHexclaveOrgId(user.identity);
  if (activeOrgId === null) {
    throw domainError("NOT_FOUND", "organization not found");
  }
  const org = await ctx.db.get("orgs", orgId);
  if (org === null || org.hexclaveOrgId !== activeOrgId) {
    throw domainError("NOT_FOUND", "organization not found");
  }
  return { ...user, org };
}
