import { getConvexProvidersConfig } from "@hexclave/react/convex-auth.config";

// This file is evaluated by the deployment as plain configuration, outside a
// function context, so it reads `process.env` rather than the typed `env` from
// `./_generated/server` (the rest of the backend uses `env`; the names are
// declared in `convex.config.ts`).
//
// No `!`, and deliberately no throw either: a missing project id must fail
// CLOSED at the call site — `lib/auth.expectedUsersIssuer()` refuses every
// request with our own FORBIDDEN copy — rather than refuse the deploy and
// take the whole deployment down with it. An empty issuer matches no token,
// which is the same answer one layer earlier.
// oxlint-disable-next-line @convex-dev/no-process-env -- deploy config, no `env` object exists here
const projectId = process.env.VITE_HEXCLAVE_PROJECT_ID ?? "";

export default {
  providers: getConvexProvidersConfig({ projectId }),
};
