import { HexclaveClientApp } from "@hexclave/react";

export const hexclaveClientApp = new HexclaveClientApp({
  tokenStore: "cookie",
  urls: {
    handler: "/handler",
    signIn: "/sign-in",
    // `/leads` is the signed-in home (§3/§161) — the CRM is what the operator
    // lands on; Mission Control stays linked at the top of it.
    afterSignIn: "/leads",
    afterSignUp: "/leads",
    afterSignOut: "/",
  },
});
