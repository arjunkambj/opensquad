import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { hexclaveClientApp } from "@/hexclave/client";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

convex.setAuth(hexclaveClientApp.getConvexClientAuth({}));

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
