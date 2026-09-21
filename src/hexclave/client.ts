import { HexclaveClientApp } from "@hexclave/react";

export const hexclaveClientApp = new HexclaveClientApp({
  tokenStore: "cookie",
  urls: {
    handler: "/handler",
    signIn: "/sign-in",
    afterSignIn: "/overview",
    afterSignUp: "/overview",
    afterSignOut: "/",
  },
});
