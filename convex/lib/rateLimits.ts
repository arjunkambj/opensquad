/**
 * Per-user token buckets on every credit-spending entry point (PLAN §6
 * "Closing the ways in").
 *
 * Credits and provider caps bound what an org may spend in total; this
 * bounds how FAST one account may spend it, so a script cannot burn a day's
 * allowance in a second or flood the scheduler with work. The component
 * evaluates the bucket transactionally inside the caller's mutation, so a
 * mutation that later fails rolls its token back with everything else.
 *
 * The numbers live in `lib/limits.ts`; this file is only the wiring and the
 * one refusal every caller shares.
 */
import { components } from "../_generated/api";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { RATE_LIMITS } from "./limits";
import type { RateLimitName } from "./limits";
import { domainError } from "./validators";
import { RateLimiter } from "@convex-dev/rate-limiter";

const rateLimiter = new RateLimiter(components.rateLimiter, RATE_LIMITS);

/**
 * Consume one token of `name` for this caller, or refuse with `RATE_LIMITED`.
 *
 * `key` is the caller's stable identity key, so the bucket is per USER rather
 * than per org: an invited operator's burst cannot exhaust the owner's
 * allowance, and one account cannot multiply its rate by making orgs.
 *
 * Call it at the TOP of a credit-spending mutation, before the reserve — a
 * refused call must never leave a reservation behind.
 */
export async function requireRateLimit(
  ctx: MutationCtx | ActionCtx,
  name: RateLimitName,
  key: string,
): Promise<void> {
  const status = await rateLimiter.limit(ctx, name, { key });
  if (status.ok) {
    return;
  }
  const seconds = Math.max(1, Math.ceil((status.retryAfter ?? 0) / 1000));
  throw domainError(
    "RATE_LIMITED",
    `too many ${name} requests; retry in ${seconds}s`,
  );
}
