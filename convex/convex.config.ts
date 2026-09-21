import { defineApp } from "convex/server";
import { v } from "convex/values";
import agentmail from "@agentmail/convex/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import migrations from "@convex-dev/migrations/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp({
  // Declared here so backend code reads them through the typed `env` from
  // `./_generated/server` instead of untyped `process.env`. Every one is
  // OPTIONAL on purpose: a deployment that is missing a key must fail closed
  // at the call site with our own error copy, not refuse to deploy at all.
  // `CONVEX_SITE_URL` / `CONVEX_CLOUD_URL` are platform-provided and must
  // never be redeclared here.
  env: {
    // P04: Firecrawl component credentials. Server-only; declared on the app
    // so they can be bound to the component's typed env by reference.
    FIRECRAWL_API_KEY: v.string(),
    FIRECRAWL_WEBHOOK_SECRET: v.optional(v.string()),
    // Hexclave project id — the issuer `lib/auth.ts` expects on every token.
    VITE_HEXCLAVE_PROJECT_ID: v.optional(v.string()),
    // Base64 AES-256 key that encrypts the provider keys an org pastes in.
    SECRETS_ENCRYPTION_KEY: v.optional(v.string()),
    // Lead-data provider credentials (`integrations/enrich/client.ts`).
    ENRICH_API_KEY: v.optional(v.string()),
    // Mail provider: the Svix secret on `/agentmail/webhook`, and the base
    // URL override the adapter uses for staging/mock runs.
    AGENTMAIL_WEBHOOK_SECRET: v.optional(v.string()),
    AGENTMAIL_BASE_URL: v.optional(v.string()),
  },
});

// --- Components ---------------------------------------------------------------
// P05: AgentMail — owns inbound message storage and verified, event_id-deduped
// provider webhook ingestion (plan/architecture.md §2 ownership table).
// Outbound sends deliberately bypass this component's Workpool sender, which
// has no approval preflight and attaches no HTTP idempotency key (verified in
// @agentmail/convex@0.1.0 dist/component/lib.js + utils.js). The single
// dispatch boundary is convex/integrations/agentmail.ts (integrations.md §G3).
app.use(agentmail);

// P04: Firecrawl — backend-owned bounded research (integrations.md §G2
// "Firecrawl route"). The component self-mounts its signed webhook at
// <site>/firecrawl/webhook via httpPrefix; app code reaches it only through
// the narrow wrapper in convex/integrations/firecrawl.ts (scrape of ONE
// validated public page; no arbitrary URL fan-out). Credentials are bound by
// reference — values live only in deployment env, never in code.
app.use(firecrawl, {
  httpPrefix: "/firecrawl/",
  env: {
    FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY,
    FIRECRAWL_WEBHOOK_SECRET: app.env.FIRECRAWL_WEBHOOK_SECRET,
  },
});

// T06: Migrations — batched, cursor-resumable, dry-runnable data migrations
// with their own state table (MIGRATION.md §2, §6.4). Only `convex/migrations/**`
// uses it, and only during a cutover; nothing in the request path touches it.
app.use(migrations);

// T02: Rate limiter — per-user token buckets on every credit-spending entry
// point (PLAN §6 "Closing the ways in"). The buckets are evaluated inside the
// caller's own transaction, so a mutation that later fails rolls its token
// back with everything else. Only `convex/lib/rateLimits.ts` talks to it.
app.use(rateLimiter);

// P16: Static hosting for the Vite `dist` SPA — app-owned root routing per
// integrations.md §G4. Deliberately NO `httpPrefix`: the component must not
// own the root URL space (the default setup would also move app routes under
// `/api`, silently breaking every webhook URL). The app's convex/http.ts
// keeps `/agentmail/webhook` and `/firecrawl/*` and registers the static GET
// catch-all LAST via `registerStaticRoutes`; uploads, manifest and file
// storage stay inside the component.
app.use(staticHosting);

export default app;
