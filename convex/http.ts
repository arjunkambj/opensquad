import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpAction } from "./_generated/server";
import { components } from "./_generated/api";
import {
  inboundWebhook,
  ORG_WEBHOOK_PATH_PREFIX,
} from "./inbox/inboundRoute";

const http = httpRouter();

// --- AgentMail: the per-org inbound route (T10) -------------------------
// POST /agentmail/webhook/<token> — PLAN §4 step 4 / §9.4. The opaque path
// token resolves to ONE org; the request is verified against that
// org's own webhook secret (plus the rotated-out one during its
// ten-minute overlap), and is accepted only when the event's `inbox_id` is
// that org's `inboxRef`. Unknown token or bad signature → 401; a
// verified event naming another inbox is quarantined.
http.route({
  pathPrefix: ORG_WEBHOOK_PATH_PREFIX,
  method: "POST",
  handler: inboundWebhook,
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
http.route({
  path: "/firecrawl/webhook",
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

// Prefix-level GET guard: any not-yet-defined `/agentmail/*` path would
// otherwise fall through to the SPA shell and answer an API-looking request
// with index.html. That namespace is app-owned and POST-only, so an unmatched
// GET is a plain 404; the exact per-org POST handlers still win over the
// prefix. `/firecrawl/` is NOT guarded here — that prefix belongs to the
// component's `httpPrefix` mount, and an app-level route could collide with
// the component's own at push time.
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
// the exact POST handlers for /agentmail/webhook/<token> or the
// component-mounted /firecrawl/* prefix — the router prefers exact matches and
// the reserved-path guards above close the remaining GET gap.
registerStaticRoutes(http, components.staticHosting);

export default http;
