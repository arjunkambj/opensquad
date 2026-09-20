/**
 * The public preflight preview: the same gate checklist the boundary runs,
 * surfaced honestly so a screen can say why a send is blocked without
 * pretending it would succeed.
 */
import { query } from "../_generated/server";
import { requireWorkspaceMember } from "../lib/auth";
import {
  localDayKey,
  sendWindowStatus,
  vSendAttemptState,
} from "../lib/validators";
import { getDraftInWorkspace } from "./draftsModel";
import {
  evaluateSendGates,
  sendResultCode,
  vSendResultCode,
} from "./sendGates";
import { effectiveSendLimit, nextWindowStart } from "./sendModel";
import { v } from "convex/values";

/* ------------------------------------------------------------------ */
/* Public preflight preview (minimal honest surfacing)                   */
/* ------------------------------------------------------------------ */
/**
 * Dry-run the send preflight for a draft (member-readable). Reports the
 * first blocking gate and the send-window state — the same checks
 * `beginDispatch` will enforce, so the UI can show an honest "why not yet".
 */
export const preflight = query({
  args: {
    workspaceId: v.id("workspaces"),
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
    await requireWorkspaceMember(ctx, args.workspaceId);
    const draft = await getDraftInWorkspace(
      ctx,
      args.workspaceId,
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
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (conversation === null || workspace === null) {
      return {
        permitted: false,
        code: "workspace_paused",
        reason: "send context is incomplete",
        attempts: attemptsView,
      };
    }
    const agent =
      conversation.agentId === undefined
        ? null
        : await ctx.db.get("agents", conversation.agentId);
    const gate = await evaluateSendGates(ctx, {
      workspace,
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
    const window = sendWindowStatus(workspace, Date.now());
    if (!window.permitted) {
      return {
        permitted: false,
        code: "outside_window",
        reason: "outside the workspace send window",
        nextPermittedAt: window.nextPermittedAt,
        attempts: attemptsView,
      };
    }
    const periodKey = localDayKey(Date.now(), workspace.timezone);
    const limit = effectiveSendLimit(workspace);
    const bucket = await ctx.db
      .query("usageBuckets")
      .withIndex(
        "by_workspaceId_and_scopeKey_and_metric_and_periodKey",
        (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("scopeKey", "workspace")
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
        nextPermittedAt: nextWindowStart(workspace, Date.now()),
        attempts: attemptsView,
      };
    }
    return { permitted: true, attempts: attemptsView };
  },
});
