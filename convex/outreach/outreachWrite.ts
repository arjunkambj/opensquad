/**
 * ONE outreach message: claim the lead, ask the model once, store what it
 * said (PLAN §9.1 "steps, not loops", §9.3).
 *
 * The step is deliberately small and idempotent. It performs exactly one paid
 * call, between two transactions that own every write, and it never loops: a
 * failure lands on the lead's retry ladder and the next tick is the retry,
 * because Convex does not re-run a failed action.
 *
 * TWO KINDS OF FAILURE, kept apart. A refusal about the ACCOUNT — the kill
 * switch, a spent platform budget, an empty balance — releases the lead
 * untouched, because burning a lead's retry ladder on a condition that clears
 * by itself would park perfectly good leads. Everything else is this lead's
 * problem and goes on the ladder.
 *
 * THE MONEY KEY. One email is one credit, keyed on agent + lead + step +
 * revision (PLAN §9.1). The attempt number is part of it because a completed
 * generation is billed whatever it answered, so a genuine retry must be a new
 * call rather than a free replay — and a REPLAY of the same attempt carries no
 * object at all, so it is answered by re-reading the draft that attempt
 * already stored instead of paying again.
 */
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import {
  boundOutreachResult,
  vWriteOutreachResult,
  WRITE_OUTREACH_MAX_OUTPUT_TOKENS,
  WRITE_OUTREACH_SYSTEM,
  writeOutreachInput,
} from "../ai/writeOutreach";
import { runStructured } from "../ai/run";
import type { RefundReason } from "../billing/paidCall";
import type { OutreachWriteContext } from "./outreachWriteState";
import { v } from "convex/values";

/**
 * Refusals that are about the account rather than the lead: the lead is put
 * back exactly as due as it was, with no attempt counted against it.
 */
const ACCOUNT_REFUSALS: readonly RefundReason[] = [
  "kill_switch",
  "platform_capacity",
  "no_credit_grant",
  "insufficient_credits",
  "trial_limit_reached",
  "rate_limited",
  "throttled",
  "unauthorized",
];

function isAccountRefusal(reason: RefundReason): boolean {
  return ACCOUNT_REFUSALS.includes(reason);
}

/**
 * The draft this operation key already stored, if it did.
 *
 * `createRevision` dedupes on `(orgId, requestId)` and the write step
 * passes its operation key as that request id, so a paid call that replays —
 * billed once, no object the second time — is answered from the row rather
 * than with another credit.
 */
export const draftForOperationKey = internalQuery({
  args: {
    orgId: v.id("orgs"),
    requestId: v.string(),
  },
  returns: v.union(v.id("drafts"), v.null()),
  handler: async (ctx, args): Promise<Id<"drafts"> | null> => {
    const draft = await ctx.db
      .query("drafts")
      .withIndex("by_orgId_and_requestId", (q) =>
        q.eq("orgId", args.orgId).eq("requestId", args.requestId),
      )
      .unique();
    return draft === null ? null : draft._id;
  },
});

export const vWriteStepOutcome = v.object({ outcome: v.string() });

/**
 * Write and store one message for one lead. Scheduled by the outreach tick,
 * once per selected lead per pass.
 */
export const runOutreachWriteStep = internalAction({
  args: {
    agentId: v.id("agents"),
    prospectId: v.id("prospects"),
    step: v.number(),
  },
  returns: vWriteStepOutcome,
  handler: async (ctx, args): Promise<{ outcome: string }> => {
    const context: OutreachWriteContext = await ctx.runMutation(
      internal.outreach.outreachWriteState.beginOutreachWrite,
      args,
    );
    if (context.status === "skip") {
      return { outcome: `skipped:${context.reason}` };
    }

    const attempt = context.attempt + 1;
    // agent + lead + step + revision (PLAN §9.1), plus the attempt, which is
    // what makes a retry a real call instead of a replayed refusal.
    const operationKey = `${args.agentId}:${args.prospectId}:write:s${context.step}:r${context.revision}:a${attempt}`;

    const written = await runStructured(ctx, {
      orgId: context.orgId,
      action: "write_email",
      tier: "smart",
      system: WRITE_OUTREACH_SYSTEM,
      input: writeOutreachInput({
        seller: context.seller,
        lead: context.lead,
        goal: context.goal,
        tone: context.tone,
        step: context.step,
        previousEmails: context.previousEmails,
        ...(context.research !== undefined ? { research: context.research } : {}),
        ...(context.instructions !== undefined
          ? { instructions: context.instructions }
          : {}),
        ...(context.bookingUrl !== undefined
          ? { bookingUrl: context.bookingUrl }
          : {}),
      }),
      result: vWriteOutreachResult,
      operationKey,
      maxOutputTokens: WRITE_OUTREACH_MAX_OUTPUT_TOKENS,
    });

    if (written.kind === "refunded") {
      if (isAccountRefusal(written.reason)) {
        await release(ctx, args);
        return { outcome: `refused:${written.reason}` };
      }
      await fail(ctx, args, "invalid_response");
      return { outcome: "failed" };
    }
    if (written.kind === "uncertain") {
      await fail(ctx, args, "timeout");
      return { outcome: "uncertain" };
    }
    if (written.replayed) {
      // This exact attempt was already bought. Whatever it stored is what we
      // send; if it stored nothing, the next attempt asks under a new key.
      const existing = await ctx.runQuery(
        internal.outreach.outreachWrite.draftForOperationKey,
        { orgId: context.orgId, requestId: operationKey },
      );
      if (existing === null) {
        await fail(ctx, args, "invalid_response");
        return { outcome: "replayed_without_draft" };
      }
      return { outcome: "replayed" };
    }
    if (written.result.status !== "object") {
      // A completed generation we could not parse: billed, and unusable.
      await fail(ctx, args, "invalid_response");
      return { outcome: "failed" };
    }

    const message = boundOutreachResult(written.result.object);
    if (message.subject === "" || message.body === "") {
      await fail(ctx, args, "invalid_response");
      return { outcome: "failed" };
    }
    const installed = await ctx.runMutation(
      internal.outreach.outreachDraftInstall.installOutreachDraft,
      {
        agentId: args.agentId,
        prospectId: args.prospectId,
        conversationId: context.conversationId,
        revision: context.revision,
        recipient: context.recipient,
        // A follow-up keeps the thread's subject verbatim, so the provider —
        // and the recipient's client — keep it in one conversation.
        subject: context.threadSubject ?? message.subject,
        body: message.body,
        requestId: operationKey,
        evidenceIds: context.evidenceIds,
        ...(context.replyToMessageRef !== undefined
          ? { replyToMessageRef: context.replyToMessageRef }
          : {}),
      },
    );
    if (!installed.installed) {
      return { outcome: `not_installed:${installed.reason}` };
    }
    return {
      outcome: installed.approved ? "drafted_and_sending" : "drafted",
    };
  },
});

/* ------------------------------------------------------------------ */
/* The two ways a step ends badly                                      */
/* ------------------------------------------------------------------ */

type StepArgs = {
  agentId: Id<"agents">;
  prospectId: Id<"prospects">;
};

async function fail(
  ctx: ActionCtx,
  args: StepArgs,
  code: "invalid_response" | "timeout" | "not_found",
): Promise<void> {
  await ctx.runMutation(internal.outreach.outreachDraftInstall.failOutreachWrite, {
    agentId: args.agentId,
    prospectId: args.prospectId,
    code,
  });
}

async function release(ctx: ActionCtx, args: StepArgs): Promise<void> {
  await ctx.runMutation(
    internal.outreach.outreachDraftInstall.releaseOutreachWrite,
    { agentId: args.agentId, prospectId: args.prospectId },
  );
}
