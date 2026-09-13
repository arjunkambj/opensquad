import { defineApp } from "convex/server";
import agentmail from "@agentmail/convex/convex.config";

const app = defineApp();

// --- Components ---------------------------------------------------------------
// P05: AgentMail — owns inbound message storage and verified, event_id-deduped
// provider webhook ingestion (plan/architecture.md §2 ownership table).
// Outbound sends deliberately bypass this component's Workpool sender, which
// has no approval preflight and attaches no HTTP idempotency key (verified in
// @agentmail/convex@0.1.0 dist/component/lib.js + utils.js). The single
// dispatch boundary is convex/integrations/agentmail.ts (integrations.md §G3).
app.use(agentmail);

// Later tasks extend this file through the integrator — do not register these
// components here:
//   P06       @convex-dev/workflow        (durable missions/decisions)
//   P04/P09   @firecrawl/firecrawl-convex (backend-owned research)
//   P16       @convex-dev/static-hosting  (app-owned root routing per G4)

export default app;
