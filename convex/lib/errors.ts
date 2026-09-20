/**
 * The one error vocabulary the backend throws and the client maps to copy
 * (PLAN §10 "Errors"). Every refusal anywhere in `convex/` is a
 * `ConvexError<{ code, message }>` whose `code` is a member of the union
 * below — the message is for operators and logs, the CODE is what the UI
 * switches on, in one place.
 *
 * Two rules keep this honest:
 *
 *   NO PROVIDER WORDING. A code never names the lead-data, scraping, mail or
 *   model provider (PLAN §4 white-label rule). `PLATFORM_CAPACITY` is what a
 *   client sees when a platform budget is spent, whichever provider it
 *   belongs to; the provider name stays in `integrations/` and
 *   `providerOperations.provider`.
 *
 *   NO COUNTS IN A PUBLIC MESSAGE. Capacity codes say that a limit was
 *   reached, never how much of it is left or how many other tenants exist.
 */
import { ConvexError } from "convex/values";

export const DOMAIN_ERROR_CODES = [
  /* --- identity and shape -------------------------------------------- */
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID",
  /* --- the ways in (PLAN §6 "Closing the ways in") -------------------- */
  /** The account's email is not verified, so it cannot create an org. */
  "EMAIL_NOT_VERIFIED",
  /** The identity provider marks the account as restricted. */
  "ACCOUNT_RESTRICTED",
  /**
   * The caller's token names no active organization, so there is no tenant to
   * act in. The client resolves it by selecting one, it is not a dead end.
   */
  "NO_ACTIVE_ORG",
  /** `MAX_TRIAL_ORGS` is reached — new signups see the waitlist state. */
  "TRIAL_CAPACITY_REACHED",
  /* --- money (PLAN §6) ------------------------------------------------ */
  /** The org holds no credit grant at all; every paid call refuses. */
  "NO_CREDIT_GRANT",
  /** Layer 1: the visible credit balance cannot cover this action. */
  "INSUFFICIENT_CREDITS",
  /** Layer 2: a hidden per-org provider cap is exhausted. */
  "TRIAL_LIMIT_REACHED",
  /** The kill switch is on: no paid call runs anywhere. */
  "PLATFORM_PAUSED",
  /** A platform-wide budget for this period is spent, for everyone. */
  "PLATFORM_CAPACITY",
  /** The caller's per-user token bucket is empty. */
  "RATE_LIMITED",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export type DomainErrorData = {
  code: DomainErrorCode;
  message: string;
};

/** The one way to refuse: a typed code plus an operator-readable message. */
export function domainError(
  code: DomainErrorCode,
  message: string,
): ConvexError<DomainErrorData> {
  return new ConvexError({ code, message });
}

/** `domainError("INVALID", …)` — the most common refusal, named. */
export function invalid(message: string): ConvexError<DomainErrorData> {
  return domainError("INVALID", message);
}
