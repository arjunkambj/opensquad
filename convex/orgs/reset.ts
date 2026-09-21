/**
 * Dev-only organization wipe.
 *
 * Deletes every row that belongs to the active organization — company
 * profile, website scrape blobs, onboarding, the agent, leads, inbox,
 * usage, the trial grant — so setup can run again from a clean slate.
 *
 * Gates, all on the server:
 *   1. This is the explicitly allowed demo deployment.
 *   2. The caller belongs to the organization and originally created it.
 *
 * Platform-wide rows and component-owned provider caches stay. This clears
 * application data; it does not erase the provider's mailbox or undo sends.
 */
import { internal } from "../_generated/api";
import type { DataModel, Doc, Id, TableNames } from "../_generated/dataModel";
import {
  action,
  env,
  internalMutation,
  query,
} from "../_generated/server";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { findTrialClaim } from "../billing/trialBuckets";
import { backfillOperationKey } from "../inbox/backfill";
import { deleteWebhook } from "../integrations/agentmailApi";
import { requireOrgMember } from "../lib/auth";
import { requireRateLimit } from "../lib/rateLimits";
import { decryptSecret } from "../lib/secrets";
import { domainError } from "../lib/validators";
import { generateWebhookToken } from "./model";
import { v } from "convex/values";
import type { OrderedQuery } from "convex/server";

/** Unknown deployments fail closed, including any future production host. */
const DEMO_CLOUD_HOST = "flexible-grasshopper-949.convex.cloud";

/** Documents one wipe page may delete. Well under the mutation write limit. */
const DELETE_PAGE_SIZE = 64;

/** Wipe pages the action will run before giving up. 64 × 500 is plenty. */
const DELETE_PAGE_LIMIT = 500;

type Budget = { remaining: number };

function exhausted(budget: Budget): boolean {
  return budget.remaining <= 0;
}

function orgResetEnabled(): boolean {
  try {
    const url = new URL(env.CONVEX_CLOUD_URL);
    return url.protocol === "https:" && url.host === DEMO_CLOUD_HOST;
  } catch {
    return false;
  }
}

function assertOrgResetEnabled(): void {
  if (!orgResetEnabled()) {
    throw domainError(
      "FORBIDDEN",
      "organization reset is not available on this deployment",
    );
  }
}

export const availability = query({
  args: { orgId: v.id("orgs") },
  returns: v.object({ enabled: v.boolean() }),
  handler: async (ctx, args) => {
    const { org, identityKey } = await requireOrgMember(ctx, args.orgId);
    return {
      enabled: orgResetEnabled() && org.createdByIdentityKey === identityKey,
    };
  },
});

export const begin = internalMutation({
  args: { orgId: v.id("orgs") },
  returns: v.object({
    webhookId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    assertOrgResetEnabled();
    const { org, identityKey } = await requireOrgMember(ctx, args.orgId);
    if (org.createdByIdentityKey !== identityKey) {
      throw domainError("FORBIDDEN", "only the demo organization's creator can reset it");
    }
    await requireRateLimit(ctx, "resetOrg", identityKey);
    const now = Date.now();
    await ctx.db.patch("orgs", org._id, {
      automationState: "paused",
      pauseReason: "org_reset",
      inboxConnection: "none",
      inboxRef: undefined,
      inboxAddress: undefined,
      connectedAt: undefined,
      webhookToken: generateWebhookToken(),
      updatedAt: now,
    });
    // The current import may already be awaiting a provider response. Its
    // result mutations require this operation row before inserting anything.
    if (org.connectedAt !== undefined) {
      const operationKey = backfillOperationKey(org.connectedAt);
      const importRun = await ctx.db
        .query("providerOperations")
        .withIndex("by_orgId_and_provider_and_operationKey", (q) =>
          q.eq("orgId", org._id).eq("provider", "agentmail")
            .eq("operationKey", operationKey),
        )
        .unique();
      if (importRun !== null) {
        await ctx.db.delete("providerOperations", importRun._id);
      }
    }
    const agent = await ctx.db.query("agents")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id)).unique();
    if (agent !== null) {
      await ctx.db.patch("agents", agent._id, {
        status: "draft",
        run: undefined,
        nextRunAt: undefined,
        revision: agent.revision + 1,
        updatedAt: now,
      });
    }
    return org.agentmailWebhookId === undefined
      ? {}
      : { webhookId: org.agentmailWebhookId };
  },
});

export const deletePage = internalMutation({
  args: { orgId: v.id("orgs") },
  returns: v.object({ done: v.boolean() }),
  handler: async (ctx, args) => {
    assertOrgResetEnabled();
    const org = await ctx.db.get("orgs", args.orgId);
    if (org === null) {
      return { done: true };
    }
    if (org.pauseReason !== "org_reset" || org.automationState !== "paused") {
      throw domainError("CONFLICT", "organization reset has not started");
    }
    const budget: Budget = { remaining: DELETE_PAGE_SIZE };
    await drainOrgData(ctx, args.orgId, budget);
    if (exhausted(budget)) {
      return { done: false };
    }
    await deleteTrialGrantForOrg(ctx, org);
    await ctx.db.delete("orgs", org._id);
    return { done: true };
  },
});

/**
 * Wipe the active organization. The browser waits until the org row is
 * gone, then `/onboarding` creates it again.
 */
export const resetOrg = action({
  args: { orgId: v.id("orgs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const started = await ctx.runMutation(internal.orgs.reset.begin, {
      orgId: args.orgId,
    });
    if (started.webhookId !== undefined) {
      await deleteOrgWebhook(ctx, args.orgId, started.webhookId);
    }
    for (let page = 0; page < DELETE_PAGE_LIMIT; page += 1) {
      const result = await ctx.runMutation(internal.orgs.reset.deletePage, {
        orgId: args.orgId,
      });
      if (result.done) {
        return null;
      }
    }
    throw domainError(
      "CONFLICT",
      "organization reset did not finish; try again",
    );
  },
});

async function deleteOrgWebhook(
  ctx: ActionCtx,
  orgId: Id<"orgs">,
  webhookId: string,
): Promise<void> {
  const envelope = await ctx.runQuery(internal.orgs.secrets.getEnvelope, {
    orgId,
    provider: "agentmail",
  });
  if (envelope === null) {
    return;
  }
  try {
    await deleteWebhook(await decryptSecret(envelope), webhookId);
  } catch {
    // Best effort: local rows still go. An orphaned provider webhook
    // posts at a path that will 401 once this org is gone.
  }
}

async function deleteTrialGrantForOrg(
  ctx: MutationCtx,
  org: Doc<"orgs">,
): Promise<void> {
  const claim = await findTrialClaim(ctx, org.createdByIdentityKey);
  if (claim !== null && claim.orgId === org._id) {
    await ctx.db.delete("trialGrants", claim._id);
  }
}

async function drainOrgData(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  budget: Budget,
): Promise<void> {
  // Returning imports and paid-call settlements must lose their operation
  // before the rows they could update are drained.
  await drainProviderOperations(ctx, orgId, budget);
  await drainRows(ctx, "agents", ctx.db.query("agents")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId)), budget);
  await drainRows(ctx, "activityEvents", ctx.db.query("activityEvents")
    .withIndex("by_orgId_and_createdAt", (q) => q.eq("orgId", orgId)), budget);
  await drainRows(ctx, "emailEventReceipts", ctx.db.query("emailEventReceipts")
    .withIndex("by_orgId_and_applicationKey", (q) => q.eq("orgId", orgId)), budget);
  await drainRows(ctx, "quarantinedEmailEvents", ctx.db.query("quarantinedEmailEvents")
    .withIndex("by_releasedTo", (q) => q.eq("releasedTo", orgId)), budget);
  await drainRows(ctx, "suppressions", ctx.db.query("suppressions")
    .withIndex("by_orgId_and_kind_and_normalizedValue", (q) => q.eq("orgId", orgId)), budget);
  await drainRows(ctx, "usageReservations", ctx.db.query("usageReservations")
    .withIndex("by_orgId_and_operationKey_and_bucketId", (q) => q.eq("orgId", orgId)), budget);
  await drainRows(ctx, "sendAttempts", ctx.db.query("sendAttempts")
    .withIndex("by_orgId_and_state_and_updatedAt", (q) => q.eq("orgId", orgId)), budget);
  await drainRows(ctx, "approvals", ctx.db.query("approvals")
    .withIndex("by_orgId_and_requestId", (q) => q.eq("orgId", orgId)), budget);
  await drainConversations(ctx, orgId, budget);
  await drainRows(ctx, "drafts", ctx.db.query("drafts")
    .withIndex("by_orgId_and_requestId", (q) => q.eq("orgId", orgId)), budget);
  await drainRows(ctx, "leadEvents", ctx.db.query("leadEvents")
    .withIndex("by_orgId_and_operationKey", (q) => q.eq("orgId", orgId)), budget);
  await drainRows(ctx, "bookings", ctx.db.query("bookings")
    .withIndex("by_orgId_and_state_and_startsAt", (q) => q.eq("orgId", orgId)), budget);
  await drainProspects(ctx, orgId, budget);
  await drainRows(ctx, "strategies", ctx.db.query("strategies")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId)), budget);
  await drainRows(ctx, "orgSecrets", ctx.db.query("orgSecrets")
    .withIndex("by_orgId_and_provider", (q) => q.eq("orgId", orgId)), budget);
  await drainRows(ctx, "usageBuckets", ctx.db.query("usageBuckets")
    .withIndex("by_orgId_and_scopeKey_and_metric_and_periodKey", (q) => q.eq("orgId", orgId)), budget);
  await drainRows(ctx, "businessProfiles", ctx.db.query("businessProfiles")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId)), budget);
}

async function drainRows<Table extends TableNames>(
  ctx: MutationCtx,
  table: Table,
  query: OrderedQuery<DataModel[Table]>,
  budget: Budget,
): Promise<void> {
  if (!exhausted(budget)) {
    await takeAndDelete(ctx, table, await query.take(budget.remaining), budget);
  }
}

async function takeAndDelete<Table extends TableNames>(
  ctx: MutationCtx,
  table: Table,
  rows: Array<{ _id: Id<Table> }>,
  budget: Budget,
): Promise<void> {
  for (const row of rows) {
    await ctx.db.delete(table, row._id);
    budget.remaining -= 1;
  }
}

async function drainConversations(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  budget: Budget,
): Promise<void> {
  while (!exhausted(budget)) {
    const conversation = await ctx.db.query("conversations")
      .withIndex("by_orgId_and_lastInboundAt", (q) => q.eq("orgId", orgId)).first();
    if (conversation === null) return;
    const notes = await ctx.db.query("conversationNotes")
      .withIndex("by_conversationId_and_createdAt", (q) => q.eq("conversationId", conversation._id))
      .take(budget.remaining);
    if (notes.length > 0) {
      await takeAndDelete(ctx, "conversationNotes", notes, budget);
      continue;
    }
    const drafts = await ctx.db.query("drafts")
      .withIndex("by_conversationId_and_revision", (q) => q.eq("conversationId", conversation._id))
      .take(budget.remaining);
    if (drafts.length > 0) {
      await takeAndDelete(ctx, "drafts", drafts, budget);
      continue;
    }
    await ctx.db.delete("conversations", conversation._id);
    budget.remaining -= 1;
  }
}

async function drainProspects(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  budget: Budget,
): Promise<void> {
  while (!exhausted(budget)) {
    const prospect = await ctx.db.query("prospects")
      .withIndex("by_orgId_and_createdAt", (q) => q.eq("orgId", orgId)).first();
    if (prospect === null) return;
    const evidence = await ctx.db.query("evidence")
      .withIndex("by_prospectId_and_createdAt", (q) => q.eq("prospectId", prospect._id))
      .take(budget.remaining);
    if (evidence.length > 0) {
      await takeAndDelete(ctx, "evidence", evidence, budget);
      continue;
    }
    await ctx.db.delete("prospects", prospect._id);
    budget.remaining -= 1;
  }
}

async function drainProviderOperations(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  budget: Budget,
): Promise<void> {
  if (exhausted(budget)) return;
  const rows = await ctx.db.query("providerOperations")
    .withIndex("by_orgId_and_provider_and_operationKey", (q) => q.eq("orgId", orgId))
    .take(budget.remaining);
  for (const row of rows) {
    const ref = row.resultRef;
    const storageId = ref?.kind === "storage"
      ? ref.storageId
      : row.provider === "firecrawl" && ref?.kind === "inline" && typeof ref.value === "string"
        ? ctx.db.system.normalizeId("_storage", ref.value)
        : null;
    if (storageId !== null && await ctx.db.system.get("_storage", storageId) !== null) {
      await ctx.storage.delete(storageId);
    }
    await ctx.db.delete("providerOperations", row._id);
    budget.remaining -= 1;
  }
}
