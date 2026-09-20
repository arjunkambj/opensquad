import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { hexclaveClientApp } from "@/hexclave/client";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

/**
 * The auth SDK's token fetcher, wrapped so that a change of active
 * organization can force a NEW token.
 *
 * Every request's tenant comes from the token's active-organization claim, so
 * switching organization is only real once Convex is holding a token minted
 * after the switch. The SDK hands back a cached access token for up to ~75
 * seconds unless `forceRefreshToken` is set, and Convex's own
 * `setAuth` re-fetch does NOT set it — so a plain `setAuth` after a switch
 * would re-install the OLD claim and every query would keep reading the
 * previous organization's data. `pendingForceRefresh` is the one-shot flag
 * that turns the next fetch into a real token mint.
 */
const fetchHexclaveToken = hexclaveClientApp.getConvexClientAuth({});
let pendingForceRefresh = false;

function fetchConvexToken({
  forceRefreshToken,
}: {
  forceRefreshToken: boolean;
}): Promise<string | null> {
  const force = forceRefreshToken || pendingForceRefresh;
  pendingForceRefresh = false;
  return fetchHexclaveToken({ forceRefreshToken: force });
}

convex.setAuth(fetchConvexToken);

/**
 * Re-authenticate Convex with a freshly minted token.
 *
 * Called after `user.setSelectedTeam(...)`. `setAuth` pauses the socket,
 * fetches (here: mints) a token, authenticates with it and replays every live
 * query, so the switch reaches every subscription without a page reload.
 */
export function refreshConvexIdentity(): void {
  pendingForceRefresh = true;
  convex.setAuth(fetchConvexToken);
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
