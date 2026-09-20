/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as agents from "../agents.js";
import type * as approvals from "../approvals.js";
import type * as bookings from "../bookings.js";
import type * as businessProfiles from "../businessProfiles.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as drafts from "../drafts.js";
import type * as evidence from "../evidence.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as integrations_agentmail from "../integrations/agentmail.js";
import type * as integrations_firecrawl from "../integrations/firecrawl.js";
import type * as leadEvents from "../leadEvents.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_validators from "../lib/validators.js";
import type * as prospects from "../prospects.js";
import type * as quarantine from "../quarantine.js";
import type * as sendAttempts from "../sendAttempts.js";
import type * as sending from "../sending.js";
import type * as suppressions from "../suppressions.js";
import type * as usage from "../usage.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  agents: typeof agents;
  approvals: typeof approvals;
  bookings: typeof bookings;
  businessProfiles: typeof businessProfiles;
  conversations: typeof conversations;
  crons: typeof crons;
  drafts: typeof drafts;
  evidence: typeof evidence;
  http: typeof http;
  inbox: typeof inbox;
  "integrations/agentmail": typeof integrations_agentmail;
  "integrations/firecrawl": typeof integrations_firecrawl;
  leadEvents: typeof leadEvents;
  "lib/auth": typeof lib_auth;
  "lib/validators": typeof lib_validators;
  prospects: typeof prospects;
  quarantine: typeof quarantine;
  sendAttempts: typeof sendAttempts;
  sending: typeof sending;
  suppressions: typeof suppressions;
  usage: typeof usage;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agentmail: import("@agentmail/convex/_generated/component.js").ComponentApi<"agentmail">;
  firecrawl: import("@firecrawl/firecrawl-convex/_generated/component.js").ComponentApi<"firecrawl">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
