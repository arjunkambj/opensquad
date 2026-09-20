/**
 * The public preflight preview: the same gate checklist the boundary runs,
 * surfaced honestly so a screen can say why a send is blocked without
 * pretending it would succeed.
 */
import { query } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import {
  localDayKey,
  sendWindowStatus,
  vSendAttemptState,
} from "../lib/validators";
import { getDraftInOrg } from "./draftsModel";
import {
  evaluateSendGates,
  sendResultCode,
  vSendResultCode,
} from "./sendGates";
import { effectiveSendLimit, nextWindowStart } from "./sendModel";
import { v } from "convex/values";

/**
 * Dry-run the send preflight for a draft (member-readable). Reports the
 * first blocking gate and the send-window state — the same checks
 * `beginDispatch` will enforce, so the UI can show an honest "why not yet".
 */
export const preflight = query({
  args: {
    orgId: v.id("orgs"),
    draftId: v.id("drafts"),
  },
  returns: v.object({
    permitted: v.boolean(),
    code: v.optional(v.string()),
    reason: v.optional(v.string()),
    nextPermittedAt: v.optional(v.number()),
    attempts: v.array(
      v.object({
        sendAttemptId: v.id("sendAttempts"),
        state: vSendAttemptState,
        resultCode: vSendResultCode,
        createdAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const draft = await getDraftInOrg(
      ctx,
      args.orgId,
      args.draftId,
    );
    const attempts = await ctx.db
      .query("sendAttempts")
      .withIndex("by_draftId", (q) => q.eq("draftId", draft._id))
      .collect();
    const attemptsView = attempts
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((attempt) => ({
        sendAttemptId: attempt._id,
        state: attempt.state,
        resultCode: sendResultCode(attempt),
        createdAt: attempt.createdAt,
      }));

    const conversation = await ctx.db.get(
      "conversations",
      draft.conversationId,
    );
    const org = await ctx.db.get("orgs", args.orgId);
    if (conversation === null || org === null) {
      return {
        permitted: false,
        code: "org_paused",
        reason: "send context is incomplete",
        attempts: attemptsView,
      };
    }
    const agent =
      conversation.agentId === undefined
        ? null
        : await ctx.db.get("agents", conversation.agentId);
    const gate = await evaluateSendGates(ctx, {
      org,
      conversation,
      draft,
      agent,
    });
    if (!gate.ok) {
      return {
        permitted: false,
        code: gate.code,
        reason: gate.reason,
        attempts: attemptsView,
      };
    }
    const window = sendWindowStatus(org, Date.now());
    if (!window.permitted) {
      return {
        permitted: false,
        code: "outside_window",
        reason: "outside the organization send window",
        nextPermittedAt: window.nextPermittedAt,
        attempts: attemptsView,
      };
    }
    const periodKey = localDayKey(Date.now(), org.timezone);
    const limit = effectiveSendLimit(org);
    const bucket = await ctx.db
      .query("usageBuckets")
      .withIndex(
        "by_orgId_and_scopeKey_and_metric_and_periodKey",
        (q) =>
          q
            .eq("orgId", args.orgId)
            .eq("scopeKey", "org")
            .eq("metric", "sends")
            .eq("periodKey", periodKey),
      )
      .unique();
    const used =
      bucket === null
        ? 0
        : bucket.reserved + bucket.committed + bucket.uncertain;
    if (limit - used < 1) {
      return {
        permitted: false,
        code: "send_limit_reached",
        reason: `daily send allowance exhausted (${used}/${limit})`,
        nextPermittedAt: nextWindowStart(org, Date.now()),
        attempts: attemptsView,
      };
    }
    return { permitted: true, attempts: attemptsView };
  },
});
