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
import type * as agents_icp from "../agents/icp.js";
import type * as agents_icpGeneration from "../agents/icpGeneration.js";
import type * as agents_icpModel from "../agents/icpModel.js";
import type * as agents_icpResult from "../agents/icpResult.js";
import type * as agents_icpVocabulary from "../agents/icpVocabulary.js";
import type * as agents_model from "../agents/model.js";
import type * as agents_mutations from "../agents/mutations.js";
import type * as agents_onboarding from "../agents/onboarding.js";
import type * as agents_outreachGoals from "../agents/outreachGoals.js";
import type * as agents_queries from "../agents/queries.js";
import type * as agents_recovery from "../agents/recovery.js";
import type * as agents_run from "../agents/run.js";
import type * as agents_runPlan from "../agents/runPlan.js";
import type * as agents_settings from "../agents/settings.js";
import type * as agents_settingsMode from "../agents/settingsMode.js";
import type * as agents_settingsRun from "../agents/settingsRun.js";
import type * as agents_sourcing from "../agents/sourcing.js";
import type * as agents_strategies from "../agents/strategies.js";
import type * as agents_strategiesConfirm from "../agents/strategiesConfirm.js";
import type * as agents_strategiesGeneration from "../agents/strategiesGeneration.js";
import type * as agents_strategiesModel from "../agents/strategiesModel.js";
import type * as agents_strategiesResult from "../agents/strategiesResult.js";
import type * as ai_analyzeWebsite from "../ai/analyzeWebsite.js";
import type * as ai_failures from "../ai/failures.js";
import type * as ai_generateIcp from "../ai/generateIcp.js";
import type * as ai_health from "../ai/health.js";
import type * as ai_models from "../ai/models.js";
import type * as ai_recommendStrategies from "../ai/recommendStrategies.js";
import type * as ai_researchLead from "../ai/researchLead.js";
import type * as ai_run from "../ai/run.js";
import type * as ai_writeOutreach from "../ai/writeOutreach.js";
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
import type * as dashboard_leadReads from "../dashboard/leadReads.js";
import type * as dashboard_model from "../dashboard/model.js";
import type * as dashboard_outcomeReads from "../dashboard/outcomeReads.js";
import type * as dashboard_panels from "../dashboard/panels.js";
import type * as dashboard_queries from "../dashboard/queries.js";
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
import type * as inbox_inboxList from "../inbox/inboxList.js";
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
import type * as leads_approval from "../leads/approval.js";
import type * as leads_autoApproval from "../leads/autoApproval.js";
import type * as leads_counts from "../leads/counts.js";
import type * as leads_emailReveal from "../leads/emailReveal.js";
import type * as leads_emailRevealRun from "../leads/emailRevealRun.js";
import type * as leads_emailRevealState from "../leads/emailRevealState.js";
import type * as leads_events from "../leads/events.js";
import type * as leads_evidence from "../leads/evidence.js";
import type * as leads_manualResearch from "../leads/manualResearch.js";
import type * as leads_manualResearchRun from "../leads/manualResearchRun.js";
import type * as leads_model from "../leads/model.js";
import type * as leads_mutations from "../leads/mutations.js";
import type * as leads_preRank from "../leads/preRank.js";
import type * as leads_queries from "../leads/queries.js";
import type * as leads_research from "../leads/research.js";
import type * as leads_researchState from "../leads/researchState.js";
import type * as leads_rows from "../leads/rows.js";
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
import type * as lib_validators_orgs from "../lib/validators/orgs.js";
import type * as lib_validators_outreach from "../lib/validators/outreach.js";
import type * as lib_validators_shared from "../lib/validators/shared.js";
import type * as migrations_clear from "../migrations/clear.js";
import type * as migrations_shape from "../migrations/shape.js";
import type * as migrations_tables from "../migrations/tables.js";
import type * as migrations_verify from "../migrations/verify.js";
import type * as orgs_model from "../orgs/model.js";
import type * as orgs_mutations from "../orgs/mutations.js";
import type * as orgs_outreachDefaults from "../orgs/outreachDefaults.js";
import type * as orgs_queries from "../orgs/queries.js";
import type * as orgs_secrets from "../orgs/secrets.js";
import type * as orgs_trialGrant from "../orgs/trialGrant.js";
import type * as outreach_approvals from "../outreach/approvals.js";
import type * as outreach_approvalsModel from "../outreach/approvalsModel.js";
import type * as outreach_autopilotApproval from "../outreach/autopilotApproval.js";
import type * as outreach_conversationStaging from "../outreach/conversationStaging.js";
import type * as outreach_draftRevisions from "../outreach/draftRevisions.js";
import type * as outreach_drafts from "../outreach/drafts.js";
import type * as outreach_draftsModel from "../outreach/draftsModel.js";
import type * as outreach_outreachDraftInstall from "../outreach/outreachDraftInstall.js";
import type * as outreach_outreachInvalidation from "../outreach/outreachInvalidation.js";
import type * as outreach_outreachLeadState from "../outreach/outreachLeadState.js";
import type * as outreach_outreachPlan from "../outreach/outreachPlan.js";
import type * as outreach_outreachReveal from "../outreach/outreachReveal.js";
import type * as outreach_outreachThread from "../outreach/outreachThread.js";
import type * as outreach_outreachTick from "../outreach/outreachTick.js";
import type * as outreach_outreachWrite from "../outreach/outreachWrite.js";
import type * as outreach_outreachWriteState from "../outreach/outreachWriteState.js";
import type * as outreach_replyOutreach from "../outreach/replyOutreach.js";
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

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "activity/model": typeof activity_model;
  "activity/queries": typeof activity_queries;
  "agents/filterOptions": typeof agents_filterOptions;
  "agents/icp": typeof agents_icp;
  "agents/icpGeneration": typeof agents_icpGeneration;
  "agents/icpModel": typeof agents_icpModel;
  "agents/icpResult": typeof agents_icpResult;
  "agents/icpVocabulary": typeof agents_icpVocabulary;
  "agents/model": typeof agents_model;
  "agents/mutations": typeof agents_mutations;
  "agents/onboarding": typeof agents_onboarding;
  "agents/outreachGoals": typeof agents_outreachGoals;
  "agents/queries": typeof agents_queries;
  "agents/recovery": typeof agents_recovery;
  "agents/run": typeof agents_run;
  "agents/runPlan": typeof agents_runPlan;
  "agents/settings": typeof agents_settings;
  "agents/settingsMode": typeof agents_settingsMode;
  "agents/settingsRun": typeof agents_settingsRun;
  "agents/sourcing": typeof agents_sourcing;
  "agents/strategies": typeof agents_strategies;
  "agents/strategiesConfirm": typeof agents_strategiesConfirm;
  "agents/strategiesGeneration": typeof agents_strategiesGeneration;
  "agents/strategiesModel": typeof agents_strategiesModel;
  "agents/strategiesResult": typeof agents_strategiesResult;
  "ai/analyzeWebsite": typeof ai_analyzeWebsite;
  "ai/failures": typeof ai_failures;
  "ai/generateIcp": typeof ai_generateIcp;
  "ai/health": typeof ai_health;
  "ai/models": typeof ai_models;
  "ai/recommendStrategies": typeof ai_recommendStrategies;
  "ai/researchLead": typeof ai_researchLead;
  "ai/run": typeof ai_run;
  "ai/writeOutreach": typeof ai_writeOutreach;
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
  "dashboard/leadReads": typeof dashboard_leadReads;
  "dashboard/model": typeof dashboard_model;
  "dashboard/outcomeReads": typeof dashboard_outcomeReads;
  "dashboard/panels": typeof dashboard_panels;
  "dashboard/queries": typeof dashboard_queries;
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
  "inbox/inboxList": typeof inbox_inboxList;
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
  "leads/approval": typeof leads_approval;
  "leads/autoApproval": typeof leads_autoApproval;
  "leads/counts": typeof leads_counts;
  "leads/emailReveal": typeof leads_emailReveal;
  "leads/emailRevealRun": typeof leads_emailRevealRun;
  "leads/emailRevealState": typeof leads_emailRevealState;
  "leads/events": typeof leads_events;
  "leads/evidence": typeof leads_evidence;
  "leads/manualResearch": typeof leads_manualResearch;
  "leads/manualResearchRun": typeof leads_manualResearchRun;
  "leads/model": typeof leads_model;
  "leads/mutations": typeof leads_mutations;
  "leads/preRank": typeof leads_preRank;
  "leads/queries": typeof leads_queries;
  "leads/research": typeof leads_research;
  "leads/researchState": typeof leads_researchState;
  "leads/rows": typeof leads_rows;
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
  "lib/validators/orgs": typeof lib_validators_orgs;
  "lib/validators/outreach": typeof lib_validators_outreach;
  "lib/validators/shared": typeof lib_validators_shared;
  "migrations/clear": typeof migrations_clear;
  "migrations/shape": typeof migrations_shape;
  "migrations/tables": typeof migrations_tables;
  "migrations/verify": typeof migrations_verify;
  "orgs/model": typeof orgs_model;
  "orgs/mutations": typeof orgs_mutations;
  "orgs/outreachDefaults": typeof orgs_outreachDefaults;
  "orgs/queries": typeof orgs_queries;
  "orgs/secrets": typeof orgs_secrets;
  "orgs/trialGrant": typeof orgs_trialGrant;
  "outreach/approvals": typeof outreach_approvals;
  "outreach/approvalsModel": typeof outreach_approvalsModel;
  "outreach/autopilotApproval": typeof outreach_autopilotApproval;
  "outreach/conversationStaging": typeof outreach_conversationStaging;
  "outreach/draftRevisions": typeof outreach_draftRevisions;
  "outreach/drafts": typeof outreach_drafts;
  "outreach/draftsModel": typeof outreach_draftsModel;
  "outreach/outreachDraftInstall": typeof outreach_outreachDraftInstall;
  "outreach/outreachInvalidation": typeof outreach_outreachInvalidation;
  "outreach/outreachLeadState": typeof outreach_outreachLeadState;
  "outreach/outreachPlan": typeof outreach_outreachPlan;
  "outreach/outreachReveal": typeof outreach_outreachReveal;
  "outreach/outreachThread": typeof outreach_outreachThread;
  "outreach/outreachTick": typeof outreach_outreachTick;
  "outreach/outreachWrite": typeof outreach_outreachWrite;
  "outreach/outreachWriteState": typeof outreach_outreachWriteState;
  "outreach/replyOutreach": typeof outreach_replyOutreach;
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
