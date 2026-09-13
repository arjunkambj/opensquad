import { defineApp } from "convex/server";
import { v } from "convex/values";
import agentmail from "@agentmail/convex/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import workflow from "@convex-dev/workflow/convex.config";

const app = defineApp({
  env: {
    // P04: Firecrawl component credentials. Server-only; declared on the app
    // so they can be bound to the component's typed env by reference.
    FIRECRAWL_API_KEY: v.string(),
    FIRECRAWL_WEBHOOK_SECRET: v.optional(v.string()),
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

// P06: Workflow — durable stage ordering, safe retries, durable event waits
// and continuation after human decisions (architecture §2/§6.2). The mission
// machinery lives in convex/workflows/; the component owns step checkpoints
// and event state — no `jobs` table reproduces it.
app.use(workflow);

// Later tasks extend this file through the integrator — do not register these
// components here:
//   P16       @convex-dev/static-hosting  (app-owned root routing per G4)

export default app;
