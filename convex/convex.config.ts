import { defineApp } from "convex/server";
import { v } from "convex/values";
import agentmail from "@agentmail/convex/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp({
  // EVERY deployment setting the backend reads is declared here, so backend
  // code reads it through the typed `env` from `./_generated/server` and a
  // misspelt name is a BUILD failure rather than a silent `undefined`. That
  // matters most for the money settings below: an undeclared variable still
  // reaches `process.env`, so `PLATFORM_PAUSE` would compile and fail OPEN,
  // and a mistyped budget name would silently fall back to its default limit.
  //
  // Our own credentials are OPTIONAL on purpose: a deployment that is missing
  // a key must fail closed at the call site with our own error copy, not
  // refuse to deploy at all. The one exception is `FIRECRAWL_API_KEY` — see
  // the note on it below.
  //
  // `CONVEX_SITE_URL` / `CONVEX_CLOUD_URL` are platform-provided and must
  // never be redeclared here. `convex/auth.config.ts` is evaluated outside a
  // function context, where no `env` exists, so it alone reads `process.env`
  // (it says so, and it fails closed on an empty value).
  env: {
    // P04: Firecrawl component credentials. Server-only; declared on the app
    // so they can be bound to the component's typed env by reference.
    //
    // REQUIRED, deliberately, and it is the one exception to the rule above.
    // The installed component declares `FIRECRAWL_API_KEY: v.string()` in its
    // OWN `convex.config.ts` (verified in
    // @firecrawl/firecrawl-convex dist/component/convex.config.js), and the
    // value below is bound to it by reference — so the component requires a
    // value whatever this line says. Declaring it optional here would only
    // make the app's contract disagree with the component's.
    //
    // The fail-closed path is kept, and stays exercised, by the EMPTY string:
    // a deployment with no key sets `FIRECRAWL_API_KEY=""`, the component's
    // own guard rejects a falsy key with `firecrawl_missing_api_key` before
    // any request leaves (dist/component/api.js#apiKey), and
    // `integrations/firecrawl.ts#classifyProviderFailure` maps that to a full
    // refund. Nobody is charged for a scrape that never happened.
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

    // --- PLAN §6 money settings, read through `lib/limits.ts` ----------
    // The kill switch. Exactly `"true"` stops every paid call instantly, with
    // no deploy; anything else leaves the product running.
    PLATFORM_PAUSED: v.optional(v.string()),
    // The platform-wide circuit breakers, in the provider's own units. An
    // unset budget uses the conservative default in `lib/limits.ts`.
    ENRICH_DAILY_CREDIT_BUDGET: v.optional(v.string()),
    ENRICH_MONTHLY_SEARCH_BUDGET: v.optional(v.string()),
    AI_DAILY_CALL_BUDGET: v.optional(v.string()),
    FIRECRAWL_DAILY_BUDGET: v.optional(v.string()),
    // Signup capacity: how many trial GRANTS exist before the waitlist.
    MAX_TRIAL_ORGS: v.optional(v.string()),
    // The lead-data wallet balance below which the overdraft watchdog trips
    // the platform breaker (`billing/platformBalance.ts`).
    ENRICH_BALANCE_FLOOR: v.optional(v.string()),
    // Recovery timing: when a paid call is parked `uncertain`, and when an
    // unresolved hold is committed at worst case. Tunable without a deploy
    // because recovery timing is an operational decision.
    PAID_CALL_STALE_MS: v.optional(v.string()),
    UNCERTAIN_HOLD_MAX_AGE_MS: v.optional(v.string()),
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
