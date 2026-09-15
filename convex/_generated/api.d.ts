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
import type * as approvals from "../approvals.js";
import type * as businessProfiles from "../businessProfiles.js";
import type * as campaigns from "../campaigns.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as decisions from "../decisions.js";
import type * as drafts from "../drafts.js";
import type * as employees from "../employees.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as integrations_agentmail from "../integrations/agentmail.js";
import type * as integrations_firecrawl from "../integrations/firecrawl.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_validators from "../lib/validators.js";
import type * as missions from "../missions.js";
import type * as runs from "../runs.js";
import type * as runtimeConnections from "../runtimeConnections.js";
import type * as runtimeControlRequests from "../runtimeControlRequests.js";
import type * as sendAttempts from "../sendAttempts.js";
import type * as sending from "../sending.js";
import type * as suppressions from "../suppressions.js";
import type * as usage from "../usage.js";
import type * as workerBridge from "../workerBridge.js";
import type * as workerOperations from "../workerOperations.js";
import type * as workflows_devFixture from "../workflows/devFixture.js";
import type * as workflows_events from "../workflows/events.js";
import type * as workflows_manager from "../workflows/manager.js";
import type * as workflows_reply from "../workflows/reply.js";
import type * as workflows_send from "../workflows/send.js";
import type * as workflows_steps from "../workflows/steps.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  approvals: typeof approvals;
  businessProfiles: typeof businessProfiles;
  campaigns: typeof campaigns;
  conversations: typeof conversations;
  crons: typeof crons;
  decisions: typeof decisions;
  drafts: typeof drafts;
  employees: typeof employees;
  http: typeof http;
  inbox: typeof inbox;
  "integrations/agentmail": typeof integrations_agentmail;
  "integrations/firecrawl": typeof integrations_firecrawl;
  "lib/auth": typeof lib_auth;
  "lib/validators": typeof lib_validators;
  missions: typeof missions;
  runs: typeof runs;
  runtimeConnections: typeof runtimeConnections;
  runtimeControlRequests: typeof runtimeControlRequests;
  sendAttempts: typeof sendAttempts;
  sending: typeof sending;
  suppressions: typeof suppressions;
  usage: typeof usage;
  workerBridge: typeof workerBridge;
  workerOperations: typeof workerOperations;
  "workflows/devFixture": typeof workflows_devFixture;
  "workflows/events": typeof workflows_events;
  "workflows/manager": typeof workflows_manager;
  "workflows/reply": typeof workflows_reply;
  "workflows/send": typeof workflows_send;
  "workflows/steps": typeof workflows_steps;
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
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
