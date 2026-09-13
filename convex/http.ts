import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
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

// --- Reserved sections; owning tasks add their routes here --------------------
//   /worker/*     P07 — authenticated ASCII worker bridge
//   /firecrawl/*  P04/P09 — Firecrawl component callbacks
//   /*            P16 — Vite SPA static fallback, registered LAST per G4

export default http;
