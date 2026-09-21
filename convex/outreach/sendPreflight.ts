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
 * Dry-run the send preflight for a draft (member-readable). Reports the first
 * blocking refusal — the attempt ledger, then the gates, then the window and
 * the daily allowance, in the order `reserveSendIntent` and `beginDispatch`
 * apply them — so `permitted` means the boundary would accept it, not merely
 * that the gates would.
 *
 * `unresolved_attempt` (a live attempt on a SIBLING revision of the same
 * conversation) is not repeated here: `evaluateSendGates` already returns it,
 * and this mirrors only the refusals that live outside the shared gate.
 */
export const preflight = query({
  args: {
    orgId: v.id("orgs"),
    draftId: v.id("drafts"),
    /**
     * The caller's clock. A Convex query must not read the wall clock
     * (`convex_rules.txt`): it is not re-run because time passed, so a window
     * or daily-allowance verdict computed inside the query could be served
     * from a cached result taken on the other side of the boundary —
     * "outside your sending hours" left on screen for an hour after the
     * window opened. The client passes a coarse, slowly-changing instant,
     * which keeps the subscription stable and the answer fresh.
     */
    now: v.number(),
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

    // THE ATTEMPT LEDGER, MIRRORED — this is a preview of what dispatch will
    // do, and `reserveSendIntent` refuses on the attempt history BEFORE it
    // looks at any gate. Leaving those refusals out made `permitted: true` a
    // promise the boundary would break: an already-sent draft reported
    // sendable, and the button offered a second send of the same mail.
    // Reported with the same codes the reservation uses, so the screen says
    // exactly what dispatch will say.
    if (attempts.some((attempt) => attempt.state === "acknowledged")) {
      return {
        permitted: false,
        code: "already_sent",
        reason: "draft revision already sent",
        attempts: attemptsView,
      };
    }
    if (
      attempts.some(
        (attempt) =>
          attempt.state === "reserved" || attempt.state === "requesting",
      )
    ) {
      return {
        permitted: false,
        code: "attempt_in_flight",
        reason: "a send for this revision is already under way",
        attempts: attemptsView,
      };
    }
    if (attempts.some((attempt) => attempt.state === "uncertain")) {
      return {
        permitted: false,
        code: "attempt_uncertain",
        reason:
          "an earlier attempt for this revision is still uncertain — reconcile it before sending again",
        attempts: attemptsView,
      };
    }
    if (attempts.some((attempt) => attempt.state === "definitively_failed")) {
      return {
        permitted: false,
        code: "attempt_failed",
        reason:
          "this exact payload was already definitively refused — a corrected draft revision is required",
        attempts: attemptsView,
      };
    }

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
    const window = sendWindowStatus(org, args.now);
    if (!window.permitted) {
      return {
        permitted: false,
        code: "outside_window",
        reason: "outside the organization send window",
        nextPermittedAt: window.nextPermittedAt,
        attempts: attemptsView,
      };
    }
    const periodKey = localDayKey(args.now, org.timezone);
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
        nextPermittedAt: nextWindowStart(org, args.now),
        attempts: attemptsView,
      };
    }
    return { permitted: true, attempts: attemptsView };
  },
});
