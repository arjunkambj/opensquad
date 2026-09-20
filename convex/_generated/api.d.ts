/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity_model from "../activity/model.js";
import type * as activity_queries from "../activity/queries.js";
import type * as agents_filterOptions from "../agents/filterOptions.js";
import type * as agents_model from "../agents/model.js";
import type * as agents_mutations from "../agents/mutations.js";
import type * as agents_onboarding from "../agents/onboarding.js";
import type * as agents_queries from "../agents/queries.js";
import type * as ai_analyzeWebsite from "../ai/analyzeWebsite.js";
import type * as ai_failures from "../ai/failures.js";
import type * as ai_health from "../ai/health.js";
import type * as ai_models from "../ai/models.js";
import type * as ai_run from "../ai/run.js";
import type * as billing_credits from "../billing/credits.js";
import type * as billing_model from "../billing/model.js";
import type * as billing_paidCall from "../billing/paidCall.js";
import type * as billing_platformBalance from "../billing/platformBalance.js";
import type * as billing_platformBudgets from "../billing/platformBudgets.js";
import type * as billing_queries from "../billing/queries.js";
import type * as billing_reservations from "../billing/reservations.js";
import type * as billing_reserve from "../billing/reserve.js";
import type * as billing_settlement from "../billing/settlement.js";
import type * as billing_sweeps from "../billing/sweeps.js";
import type * as billing_transitions from "../billing/transitions.js";
import type * as billing_trialBuckets from "../billing/trialBuckets.js";
import type * as billing_withCredits from "../billing/withCredits.js";
import type * as bookings_confirmations from "../bookings/confirmations.js";
import type * as bookings_model from "../bookings/model.js";
import type * as bookings_outcomes from "../bookings/outcomes.js";
import type * as bookings_proposals from "../bookings/proposals.js";
import type * as bookings_queries from "../bookings/queries.js";
import type * as company_actions from "../company/actions.js";
import type * as company_analysis from "../company/analysis.js";
import type * as company_model from "../company/model.js";
import type * as company_mutations from "../company/mutations.js";
import type * as company_queries from "../company/queries.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as inbox_backfill from "../inbox/backfill.js";
import type * as inbox_connectActions from "../inbox/connectActions.js";
import type * as inbox_connection from "../inbox/connection.js";
import type * as inbox_connectionState from "../inbox/connectionState.js";
import type * as inbox_conversationLifecycle from "../inbox/conversationLifecycle.js";
import type * as inbox_conversationNotes from "../inbox/conversationNotes.js";
import type * as inbox_conversationResume from "../inbox/conversationResume.js";
import type * as inbox_conversationThread from "../inbox/conversationThread.js";
import type * as inbox_conversations from "../inbox/conversations.js";
import type * as inbox_conversationsModel from "../inbox/conversationsModel.js";
import type * as inbox_inbound from "../inbox/inbound.js";
import type * as inbox_inboundApply from "../inbox/inboundApply.js";
import type * as inbox_inboundModel from "../inbox/inboundModel.js";
import type * as inbox_inboundRoute from "../inbox/inboundRoute.js";
import type * as inbox_model from "../inbox/model.js";
import type * as inbox_quarantine from "../inbox/quarantine.js";
import type * as inbox_receiptDrain from "../inbox/receiptDrain.js";
import type * as inbox_replyGate from "../inbox/replyGate.js";
import type * as inbox_unassignedQueue from "../inbox/unassignedQueue.js";
import type * as integrations_agentmail from "../integrations/agentmail.js";
import type * as integrations_agentmailApi from "../integrations/agentmailApi.js";
import type * as integrations_enrich_catalog from "../integrations/enrich/catalog.js";
import type * as integrations_enrich_client from "../integrations/enrich/client.js";
import type * as integrations_enrich_filters from "../integrations/enrich/filters.js";
import type * as integrations_enrich_reveal from "../integrations/enrich/reveal.js";
import type * as integrations_enrich_revealContact from "../integrations/enrich/revealContact.js";
import type * as integrations_enrich_revealPoll from "../integrations/enrich/revealPoll.js";
import type * as integrations_enrich_rows from "../integrations/enrich/rows.js";
import type * as integrations_enrich_search from "../integrations/enrich/search.js";
import type * as integrations_enrich_wallet from "../integrations/enrich/wallet.js";
import type * as integrations_firecrawl from "../integrations/firecrawl.js";
import type * as integrations_firecrawlPages from "../integrations/firecrawlPages.js";
import type * as leads_events from "../leads/events.js";
import type * as leads_evidence from "../leads/evidence.js";
import type * as leads_model from "../leads/model.js";
import type * as leads_mutations from "../leads/mutations.js";
import type * as leads_queries from "../leads/queries.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_urlSafety from "../lib/urlSafety.js";
import type * as lib_validators_activity from "../lib/validators/activity.js";
import type * as lib_validators_agents from "../lib/validators/agents.js";
import type * as lib_validators_billing from "../lib/validators/billing.js";
import type * as lib_validators_bookings from "../lib/validators/bookings.js";
import type * as lib_validators_company from "../lib/validators/company.js";
import type * as lib_validators_inbox from "../lib/validators/inbox.js";
import type * as lib_validators_index from "../lib/validators/index.js";
import type * as lib_validators_leads from "../lib/validators/leads.js";
import type * as lib_validators_outreach from "../lib/validators/outreach.js";
import type * as lib_validators_shared from "../lib/validators/shared.js";
import type * as lib_validators_workspaces from "../lib/validators/workspaces.js";
import type * as migrations_clear from "../migrations/clear.js";
import type * as migrations_shape from "../migrations/shape.js";
import type * as migrations_tables from "../migrations/tables.js";
import type * as migrations_verify from "../migrations/verify.js";
import type * as outreach_approvals from "../outreach/approvals.js";
import type * as outreach_approvalsModel from "../outreach/approvalsModel.js";
import type * as outreach_conversationStaging from "../outreach/conversationStaging.js";
import type * as outreach_draftRevisions from "../outreach/draftRevisions.js";
import type * as outreach_drafts from "../outreach/drafts.js";
import type * as outreach_draftsModel from "../outreach/draftsModel.js";
import type * as outreach_sendActions from "../outreach/sendActions.js";
import type * as outreach_sendAttempts from "../outreach/sendAttempts.js";
import type * as outreach_sendControls from "../outreach/sendControls.js";
import type * as outreach_sendDispatch from "../outreach/sendDispatch.js";
import type * as outreach_sendGates from "../outreach/sendGates.js";
import type * as outreach_sendModel from "../outreach/sendModel.js";
import type * as outreach_sendOutcome from "../outreach/sendOutcome.js";
import type * as outreach_sendPreflight from "../outreach/sendPreflight.js";
import type * as outreach_sendReceipts from "../outreach/sendReceipts.js";
import type * as outreach_sendReconcile from "../outreach/sendReconcile.js";
import type * as outreach_sendReserve from "../outreach/sendReserve.js";
import type * as outreach_sendSweeps from "../outreach/sendSweeps.js";
import type * as outreach_suppressions from "../outreach/suppressions.js";
import type * as workspaces_model from "../workspaces/model.js";
import type * as workspaces_mutations from "../workspaces/mutations.js";
import type * as workspaces_queries from "../workspaces/queries.js";
import type * as workspaces_secrets from "../workspaces/secrets.js";
import type * as workspaces_trialGrant from "../workspaces/trialGrant.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "activity/model": typeof activity_model;
  "activity/queries": typeof activity_queries;
  "agents/filterOptions": typeof agents_filterOptions;
  "agents/model": typeof agents_model;
  "agents/mutations": typeof agents_mutations;
  "agents/onboarding": typeof agents_onboarding;
  "agents/queries": typeof agents_queries;
  "ai/analyzeWebsite": typeof ai_analyzeWebsite;
  "ai/failures": typeof ai_failures;
  "ai/health": typeof ai_health;
  "ai/models": typeof ai_models;
  "ai/run": typeof ai_run;
  "billing/credits": typeof billing_credits;
  "billing/model": typeof billing_model;
  "billing/paidCall": typeof billing_paidCall;
  "billing/platformBalance": typeof billing_platformBalance;
  "billing/platformBudgets": typeof billing_platformBudgets;
  "billing/queries": typeof billing_queries;
  "billing/reservations": typeof billing_reservations;
  "billing/reserve": typeof billing_reserve;
  "billing/settlement": typeof billing_settlement;
  "billing/sweeps": typeof billing_sweeps;
  "billing/transitions": typeof billing_transitions;
  "billing/trialBuckets": typeof billing_trialBuckets;
  "billing/withCredits": typeof billing_withCredits;
  "bookings/confirmations": typeof bookings_confirmations;
  "bookings/model": typeof bookings_model;
  "bookings/outcomes": typeof bookings_outcomes;
  "bookings/proposals": typeof bookings_proposals;
  "bookings/queries": typeof bookings_queries;
  "company/actions": typeof company_actions;
  "company/analysis": typeof company_analysis;
  "company/model": typeof company_model;
  "company/mutations": typeof company_mutations;
  "company/queries": typeof company_queries;
  crons: typeof crons;
  http: typeof http;
  "inbox/backfill": typeof inbox_backfill;
  "inbox/connectActions": typeof inbox_connectActions;
  "inbox/connection": typeof inbox_connection;
  "inbox/connectionState": typeof inbox_connectionState;
  "inbox/conversationLifecycle": typeof inbox_conversationLifecycle;
  "inbox/conversationNotes": typeof inbox_conversationNotes;
  "inbox/conversationResume": typeof inbox_conversationResume;
  "inbox/conversationThread": typeof inbox_conversationThread;
  "inbox/conversations": typeof inbox_conversations;
  "inbox/conversationsModel": typeof inbox_conversationsModel;
  "inbox/inbound": typeof inbox_inbound;
  "inbox/inboundApply": typeof inbox_inboundApply;
  "inbox/inboundModel": typeof inbox_inboundModel;
  "inbox/inboundRoute": typeof inbox_inboundRoute;
  "inbox/model": typeof inbox_model;
  "inbox/quarantine": typeof inbox_quarantine;
  "inbox/receiptDrain": typeof inbox_receiptDrain;
  "inbox/replyGate": typeof inbox_replyGate;
  "inbox/unassignedQueue": typeof inbox_unassignedQueue;
  "integrations/agentmail": typeof integrations_agentmail;
  "integrations/agentmailApi": typeof integrations_agentmailApi;
  "integrations/enrich/catalog": typeof integrations_enrich_catalog;
  "integrations/enrich/client": typeof integrations_enrich_client;
  "integrations/enrich/filters": typeof integrations_enrich_filters;
  "integrations/enrich/reveal": typeof integrations_enrich_reveal;
  "integrations/enrich/revealContact": typeof integrations_enrich_revealContact;
  "integrations/enrich/revealPoll": typeof integrations_enrich_revealPoll;
  "integrations/enrich/rows": typeof integrations_enrich_rows;
  "integrations/enrich/search": typeof integrations_enrich_search;
  "integrations/enrich/wallet": typeof integrations_enrich_wallet;
  "integrations/firecrawl": typeof integrations_firecrawl;
  "integrations/firecrawlPages": typeof integrations_firecrawlPages;
  "leads/events": typeof leads_events;
  "leads/evidence": typeof leads_evidence;
  "leads/model": typeof leads_model;
  "leads/mutations": typeof leads_mutations;
  "leads/queries": typeof leads_queries;
  "lib/auth": typeof lib_auth;
  "lib/errors": typeof lib_errors;
  "lib/limits": typeof lib_limits;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/secrets": typeof lib_secrets;
  "lib/urlSafety": typeof lib_urlSafety;
  "lib/validators/activity": typeof lib_validators_activity;
  "lib/validators/agents": typeof lib_validators_agents;
  "lib/validators/billing": typeof lib_validators_billing;
  "lib/validators/bookings": typeof lib_validators_bookings;
  "lib/validators/company": typeof lib_validators_company;
  "lib/validators/inbox": typeof lib_validators_inbox;
  "lib/validators/index": typeof lib_validators_index;
  "lib/validators/leads": typeof lib_validators_leads;
  "lib/validators/outreach": typeof lib_validators_outreach;
  "lib/validators/shared": typeof lib_validators_shared;
  "lib/validators/workspaces": typeof lib_validators_workspaces;
  "migrations/clear": typeof migrations_clear;
  "migrations/shape": typeof migrations_shape;
  "migrations/tables": typeof migrations_tables;
  "migrations/verify": typeof migrations_verify;
  "outreach/approvals": typeof outreach_approvals;
  "outreach/approvalsModel": typeof outreach_approvalsModel;
  "outreach/conversationStaging": typeof outreach_conversationStaging;
  "outreach/draftRevisions": typeof outreach_draftRevisions;
  "outreach/drafts": typeof outreach_drafts;
  "outreach/draftsModel": typeof outreach_draftsModel;
  "outreach/sendActions": typeof outreach_sendActions;
  "outreach/sendAttempts": typeof outreach_sendAttempts;
  "outreach/sendControls": typeof outreach_sendControls;
  "outreach/sendDispatch": typeof outreach_sendDispatch;
  "outreach/sendGates": typeof outreach_sendGates;
  "outreach/sendModel": typeof outreach_sendModel;
  "outreach/sendOutcome": typeof outreach_sendOutcome;
  "outreach/sendPreflight": typeof outreach_sendPreflight;
  "outreach/sendReceipts": typeof outreach_sendReceipts;
  "outreach/sendReconcile": typeof outreach_sendReconcile;
  "outreach/sendReserve": typeof outreach_sendReserve;
  "outreach/sendSweeps": typeof outreach_sendSweeps;
  "outreach/suppressions": typeof outreach_suppressions;
  "workspaces/model": typeof workspaces_model;
  "workspaces/mutations": typeof workspaces_mutations;
  "workspaces/queries": typeof workspaces_queries;
  "workspaces/secrets": typeof workspaces_secrets;
  "workspaces/trialGrant": typeof workspaces_trialGrant;
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
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
