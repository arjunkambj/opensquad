import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpAction } from "./_generated/server";
import { components } from "./_generated/api";
import { agentmail } from "./integrations/agentmail";

const http = httpRouter();

// The component's RunMutationCtx.runMutation is typed with the
// (mutation, args, options?) ArgsAndOptions signature while convex 1.45's
// http-action ctx exposes the single-argument OptionalRestArgs form. The
// component only ever calls runMutation(mutation, argsObject) — verified in
// dist/client/index.js — so the adapter below drops the unused options
// element; runtime behavior is unchanged.
type WebhookCtx = Parameters<typeof agentmail.handleWebhook>[0];

// --- AgentMail (P05) ----------------------------------------------------------
// POST /agentmail/webhook — signed AgentMail receiver. `handleWebhook` verifies
// the svix-id / svix-timestamp / svix-signature headers over the raw request
// body against AGENTMAIL_WEBHOOK_SECRET before any state change; unsigned or
// badly signed requests get 401. This is the ONLY AgentMail HTTP route —
// outbound sending is never reachable over HTTP (internalAction only, see
// convex/integrations/agentmail.ts).
http.route({
  path: "/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) =>
    agentmail.handleWebhook(
      {
        runMutation: ((mutation, args) =>
          ctx.runMutation(mutation, args)) as WebhookCtx["runMutation"],
      },
      request,
    ),
  ),
});

// --- Reserved-path method guards (P16) ----------------------------------------
// Convex route lookup checks exact (path, method) pairs BEFORE prefix routes.
// The static catch-all registered below is GET-only, so a bare GET on a
// reserved webhook path would still fall through to it and render index.html —
// a misleading 200 on an API path, and exactly the "swallowed route" failure
// G4 forbids. Pin every reserved path to an app-owned 405 for GET so NO method
// on these paths can ever serve the SPA. (POST keeps its exact handlers above;
// other methods have no prefix route to fall into and already 404.)
// `/firecrawl/webhook` is component-mounted for POST; the guard only claims the
// unused GET method on the same path.
const RESERVED_GET_PATHS = [
  "/agentmail/webhook",
  "/firecrawl/webhook",
] as const;

for (const path of RESERVED_GET_PATHS) {
  http.route({
    path,
    method: "GET",
    handler: httpAction(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "METHOD_NOT_ALLOWED",
              message: "this endpoint accepts POST only",
            },
          }),
          {
            status: 405,
            headers: {
              "Content-Type": "application/json",
              Allow: "POST",
            },
          },
        ),
    ),
  });
}

// Prefix-level GET guard: the exact-path 405 above misses trailing slashes
// (`/agentmail/webhook/`) and any not-yet-defined `/agentmail/*` path — all of
// which would otherwise fall through to the SPA shell and answer an
// API-looking request with index.html. That namespace is app-owned and
// POST-only, so an unmatched GET is a plain 404; exact matches still win over
// the prefix, keeping the 405 meaningful. `/firecrawl/` is NOT guarded here —
// that prefix belongs to the component's `httpPrefix` mount, and an app-level
// route could collide with the component's own at push time.
http.route({
  pathPrefix: "/agentmail/",
  method: "GET",
  handler: httpAction(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "NOT_FOUND",
            message: "no such endpoint",
          },
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      ),
  ),
});

// --- Static hosting SPA fallback (P16) ----------------------------------------
// App-owned root routing (integrations.md §G4): registered LAST, after every
// app route and method guard above. `registerStaticRoutes` adds a single GET
// prefix route at "/" that resolves uploaded Vite `dist` assets from the
// staticHosting component (with SPA fallback to index.html). It cannot shadow
// the exact POST route for /agentmail/webhook or the component-mounted
// /firecrawl/* prefix — the router prefers exact matches and the reserved-path
// guards above close the remaining GET gap.
registerStaticRoutes(http, components.staticHosting);

export default http;
