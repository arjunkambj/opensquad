/**
 * The platform account's own balance — free to read, and the number the
 * hourly watchdog in `billing/platformBalance.ts` decides on (PLAN §6: "a
 * cron reads the balance hourly and trips the breaker if the real balance
 * falls below a floor, so drift between our ledger and theirs cannot become
 * an overdraft").
 *
 * The envelope is `{ success, data: { organizationId, balance, currency,
 * asOf } }` — spikes §3 recorded this against the live account and flagged
 * the bare `{ balance }` shape in the local reference as wrong.
 *
 * Exported as a plain function: the watchdog calls it directly (a domain
 * module may call `integrations/`).
 */
import { enrichRequest } from "./client";
import type { EnrichResult } from "./client";

export type WalletBalance = {
  balance: number;
  currency: string;
  asOf: string;
};

type BalanceResponse = {
  balance?: unknown;
  currency?: unknown;
  asOf?: unknown;
};

/**
 * Read the account balance. Free, and deliberately NOT stopped by the kill
 * switch: knowing what is left is exactly what decides whether paid calls
 * should be stopped in the first place.
 */
export async function fetchWalletBalance(): Promise<
  EnrichResult<WalletBalance>
> {
  const result = await enrichRequest<BalanceResponse>({
    path: "/wallets/balance",
    method: "GET",
    idempotent: true,
    respectKillSwitch: false,
  });
  if (result.kind !== "ok") {
    return result;
  }
  const balance = result.data.balance;
  if (typeof balance !== "number" || !Number.isFinite(balance)) {
    return { kind: "unknown", reason: "invalid_response" };
  }
  return {
    kind: "ok",
    data: {
      balance: Math.max(0, Math.trunc(balance)),
      currency:
        typeof result.data.currency === "string"
          ? result.data.currency.slice(0, 40)
          : "credits",
      asOf:
        typeof result.data.asOf === "string"
          ? result.data.asOf.slice(0, 40)
          : new Date().toISOString(),
    },
    ...(result.requestId !== undefined ? { requestId: result.requestId } : {}),
  };
}
