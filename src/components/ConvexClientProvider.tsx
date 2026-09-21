import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { hexclaveClientApp } from "@/hexclave/client";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

/** Organization switches require a fresh token: the SDK cache and Convex setAuth can reuse old claims.
 * pendingForceRefresh forces the next fetch to mint a token for the new organization. */
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

/** Force a fresh token after setSelectedTeam so every subscription reads the new organization. */
export function refreshConvexIdentity(): void {
  pendingForceRefresh = true;
  convex.setAuth(fetchConvexToken);
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
