/**
 * Typed identity, membership and role guards for OpenSquad functions.
 *
 * The browser supplies business arguments only — never an authoritative
 * `userId`, owner, role or team claim. Every entry point resolves the verified
 * JWT identity through `ctx.auth.getUserIdentity()` and derives the stable
 * `identityKey` from `tokenIdentifier` (`iss|sub`; see plan/evidence/P01.md).
 *
 * Hexclave publishes two `customJwt` issuers for one project: real users under
 * `…/api/v1/projects/{id}` and anonymous users under
 * `…/api/v1/projects-anonymous-users/{id}` (`aud` is unbound by the provider
 * config, so the exact `iss` match carries the security check). OpenSquad
 * workspaces belong to real accounts, so `requireUser` rejects the anonymous
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

export type Role = "owner" | "operator" | "viewer";

export type AuthenticatedUser = {
  identity: UserIdentity;
  /** Stable key stored on memberships/workspace rows: `tokenIdentifier`. */
  identityKey: string;
};

export type WorkspaceContext = AuthenticatedUser & {
  workspace: Doc<"workspaces">;
  membership: Doc<"memberships">;
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
      "anonymous or foreign-issuer sessions cannot use workspace APIs",
    );
  }
  return { identity, identityKey: identity.tokenIdentifier };
}

/**
 * A verified account — the gate in front of creating a workspace
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
      "verify your email address before creating a workspace",
    );
  }
  if (typeof identity.email !== "string" || identity.email.length === 0) {
    throw domainError(
      "EMAIL_NOT_VERIFIED",
      "an account email is required to create a workspace",
    );
  }
  return user;
}

/**
 * Active membership of an identity in a workspace, or `null`. Revoked
 * memberships never satisfy a guard.
 */
export async function getActiveMembership(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
  identityKey: string,
): Promise<Doc<"memberships"> | null> {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_workspaceId_and_identityKey", (q) =>
      q.eq("workspaceId", workspaceId).eq("identityKey", identityKey),
    )
    .unique();
  if (membership === null || membership.status !== "active") {
    return null;
  }
  return membership;
}

/**
 * Resolve identity, workspace and active membership in one check.
 *
 * Returns `NOT_FOUND` both when the workspace does not exist and when the
 * caller is not an active member — never reveal another workspace's existence.
 */
export async function requireWorkspaceMember(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
): Promise<WorkspaceContext> {
  const user = await requireUser(ctx);
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (workspace === null) {
    throw domainError("NOT_FOUND", "workspace not found");
  }
  const membership = await getActiveMembership(ctx, workspaceId, user.identityKey);
  if (membership === null) {
    throw domainError("NOT_FOUND", "workspace not found");
  }
  return { ...user, workspace, membership };
}

/**
 * Membership check restricted to roles. Callers that are members but hold a
 * disallowed role get `FORBIDDEN`; non-members still get `NOT_FOUND`.
 */
export async function requireWorkspaceRole(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
  roles: readonly Role[],
): Promise<WorkspaceContext> {
  const context = await requireWorkspaceMember(ctx, workspaceId);
  if (!roles.includes(context.membership.role)) {
    throw domainError("FORBIDDEN", `requires ${roles.join(" or ")} role`);
  }
  return context;
}

/** Owner-only guard: membership management, sending policy, provider auth. */
export function requireWorkspaceOwner(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
): Promise<WorkspaceContext> {
  return requireWorkspaceRole(ctx, workspaceId, ["owner"]);
}

/** Owner or operator: campaigns, leads and business profile edits. */
export function requireWorkspaceEditor(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
): Promise<WorkspaceContext> {
  return requireWorkspaceRole(ctx, workspaceId, ["owner", "operator"]);
}
