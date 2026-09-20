/**
 * What the outreach loop WRITES on the lead: the claim, the rest, the retry
 * ladder and the follow-up clock (PLAN §9.1).
 *
 * `prospects` belongs to the leads domain, and these functions are the one
 * place this domain touches it — the mirror image of `leads/approval.ts`,
 * which patches `drafts` for the same reason: a claim that is not in the same
 * transaction as the decision it guards is not a claim at all.
 *
 * Every write here is one of exactly five facts:
 *   CLAIM      — this lead is being written for right now, with a watchdog
 *                time so a step that dies comes back due instead of vanishing.
 *   REST       — the message is written; whatever happens next belongs to the
 *                approval and the send ledger, not to the loop.
 *   LADDER     — the step failed: 5 min, then 30 min, then `needs_attention`
 *                with a reason a person can act on.
 *   RELEASE    — the step never began because of something that has nothing to
 *                do with this lead (out of credits, kill switch), so it goes
 *                back due WITHOUT burning an attempt (PLAN §9.1).
 *   FOLLOW-UP  — a provider accepted a send, so the next step in the ladder is
 *                scheduled (or the lead rests, having had them all).
 *
 * None of it decides money. Nothing here refunds, commits or reserves.
 */
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { GenericDatabaseReader } from "convex/server";
import { appendLeadEvent, findLeadEventByOperationKey } from "../leads/events";
import {
  advancedLeadStage,
  PROSPECT_STAGE_REASON_MAX_LENGTH,
  boundedString,
} from "../lib/validators";
import type { OperationErrorCode } from "../lib/validators";

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/*                                                                     */
/* These belong in `convex/lib/limits.ts` with the rest of the policy  */
/* numbers; they are local constants only because that file is         */
/* integrator-only (EXECUTION §0).                                     */
/* ------------------------------------------------------------------ */

/**
 * How long a lead may sit claimed for a write before the loop calls the step
 * lost and picks it up again. A Convex action cannot outlive ~10 minutes, so
 * past this nothing is still working on it.
 */
export const OUTREACH_STALL_MS = 15 * 60 * 1000;

/** Conversations one lead can hold. A lead has a handful at most. */
export const CONVERSATION_SCAN_MAX = 10;

/** PLAN §9.1's ladder: 5 min, 30 min, then the lead is parked. */
const STEP_RETRY_DELAYS_MS: readonly number[] = [5 * 60 * 1000, 30 * 60 * 1000];

const STEP_MAX_ATTEMPTS = 3;

/** How a parked lead explains itself. The CODE is what the client maps to
 *  copy; this sentence is what the lead's history shows. */
const PARK_REASONS: Record<OperationErrorCode, string> = {
  rate_limited: "Writing this email kept being throttled — try again later.",
  provider_unavailable: "The email writer is unavailable right now.",
  unreadable_source: "There was not enough about this lead to write from.",
  not_found: "The lead's conversation or address could not be resolved.",
  invalid_response: "The written email came back unusable three times.",
  insufficient_credits: "Not enough credits to write this email.",
  platform_paused: "Outreach is paused right now.",
  timeout: "Writing this email timed out three times.",
  unknown: "Writing this email failed three times.",
};

function stageReason(text: string): string {
  return boundedString(text, "stageReason", {
    min: 1,
    max: PROSPECT_STAGE_REASON_MAX_LENGTH,
  });
}

/* ------------------------------------------------------------------ */
/* Which step a lead is on                                             */
/* ------------------------------------------------------------------ */

/**
 * The outreach step this lead is due for: 0 is the first touch, 1 and up are
 * the numbered follow-ups.
 *
 * Derived from facts a provider gave us — `lastContactedAt` comes only from a
 * send acceptance and `followUpsSent` only from an accepted follow-up — so a
 * draft that was written but never sent can never advance the step.
 */
export function outreachStepOf(lead: Doc<"prospects">): number {
  return lead.lastContactedAt === undefined ? 0 : lead.followUpsSent + 1;
}

/** How long after the previous message this step's follow-up goes out, or
 *  `null` when the agent has no such step configured and the lead rests. */
export function followUpDelayMs(
  agent: Doc<"agents">,
  step: number,
): number | null {
  const days = agent.followUpDays[step - 1];
  return days === undefined ? null : days * 24 * 60 * 60 * 1000;
}

/* ------------------------------------------------------------------ */
/* Claim, rest, release                                                */
/* ------------------------------------------------------------------ */

/**
 * Claim this lead for one write step.
 *
 * The watchdog IS the claim: `nextActionAt` moves a stall window out, which
 * takes the lead out of every selection range until either the step finishes
 * or the window expires and the loop re-drives it. Concurrent cron ticks
 * therefore cannot both spend on the same lead — the second one reads a lead
 * that is no longer due, inside the same serializable transaction.
 *
 * A first touch also moves the lead to `queued`: the user can see it is about
 * to be written to. A follow-up leaves the stage where a send acceptance put
 * it (`contacted` or further), because a follow-up is not a new pipeline
 * position.
 */
export async function claimLeadForOutreach(
  ctx: MutationCtx,
  lead: Doc<"prospects">,
  step: number,
): Promise<void> {
  const now = Date.now();
  const stage = step === 0 ? advancedLeadStage(lead.stage, "queued") : lead.stage;
  const moved = stage !== lead.stage;
  await ctx.db.patch("prospects", lead._id, {
    nextActionAt: now + OUTREACH_STALL_MS,
    updatedAt: now,
    ...(moved
      ? { stage, stageReason: stageReason("Queued for the agent's first email") }
      : {}),
  });
  if (moved) {
    await appendLeadEvent(ctx, {
      workspaceId: lead.workspaceId,
      prospectId: lead._id,
      kind: "stage_changed",
      summary: `Stage ${lead.stage} → ${stage}`,
      // One row per lead: a lead re-queued after an instruction change is the
      // same pipeline position, not a second stage move.
      operationKey: `lead:${lead._id}:queued`,
      fromStage: lead.stage,
      toStage: stage,
    });
  }
}

/**
 * The message is written. The lead stops being due: from here the draft is
 * either waiting for a person (Review) or already with the send ledger
 * (Autopilot), and neither of those is a state the loop should re-enter.
 *
 * A send acceptance is what makes the lead due again, with the follow-up
 * clock; an instruction change is what makes it due again with a rewrite.
 */
export async function restLeadAfterWrite(
  ctx: MutationCtx,
  lead: Doc<"prospects">,
): Promise<void> {
  await ctx.db.patch("prospects", lead._id, {
    nextActionAt: undefined,
    lastError: undefined,
    updatedAt: Date.now(),
  });
}

/**
 * Put a claimed lead back WITHOUT burning an attempt — the refusal was about
 * the account (out of credits, a spent budget, the kill switch), not about
 * this lead, and those conditions clear by themselves.
 */
export async function releaseLeadClaim(
  ctx: MutationCtx,
  lead: Doc<"prospects">,
): Promise<void> {
  await ctx.db.patch("prospects", lead._id, {
    nextActionAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/* ------------------------------------------------------------------ */
/* The retry ladder                                                    */
/* ------------------------------------------------------------------ */

/**
 * One step-level failure: move the lead out along the ladder, or park it with
 * a reason. Convex does not re-run a failed action, so the next tick — which
 * sees the lead come due again — is the retry (PLAN §9.1).
 */
export async function failOutreachStep(
  ctx: MutationCtx,
  lead: Doc<"prospects">,
  code: OperationErrorCode,
): Promise<{ attempts: number; parked: boolean }> {
  const now = Date.now();
  const attempts = (lead.lastError?.attempts ?? 0) + 1;
  const lastError = { code, at: now, attempts };
  const delay = STEP_RETRY_DELAYS_MS[attempts - 1];
  const parked = attempts >= STEP_MAX_ATTEMPTS || delay === undefined;
  await ctx.db.patch("prospects", lead._id, {
    lastError,
    updatedAt: now,
    ...(parked
      ? {
          // Not `advancedLeadStage`: parking is not progress, and it is the
          // one transition that deliberately leaves the pipeline.
          stage: "needs_attention" as const,
          stageReason: stageReason(PARK_REASONS[code]),
          nextActionAt: undefined,
        }
      : { nextActionAt: now + delay }),
  });
  if (parked) {
    await appendLeadEvent(ctx, {
      workspaceId: lead.workspaceId,
      prospectId: lead._id,
      kind: "stage_changed",
      summary: PARK_REASONS[code],
      operationKey: `lead:${lead._id}:outreach-parked:${code}:${attempts}`,
      fromStage: lead.stage,
      toStage: "needs_attention",
    });
  }
  return { attempts, parked };
}

/* ------------------------------------------------------------------ */
/* The follow-up clock                                                 */
/* ------------------------------------------------------------------ */

/**
 * A provider accepted a send on this attempt, so the ladder moves on.
 *
 * Called from inside `recordSendOutcome`'s accepted transaction and BEFORE
 * `leads/mutations.markSendAccepted`, which is what makes the arithmetic
 * work: the lead still carries its pre-send `lastContactedAt`, so "was this
 * the first touch or follow-up n" is readable from the row rather than from
 * anything the caller passes.
 *
 * `followUpsSent` counts accepted follow-ups only. When the agent's
 * `followUpDays` has no entry for the next step, the lead rests: no due time,
 * nothing scheduled, and only a reply or a person moves it again.
 *
 * Non-throwing by contract, like every other derivation the send outcome
 * calls: a broken association records less, never rolls back an acceptance
 * the provider has already made.
 */
export async function scheduleNextOutreachStep(
  ctx: MutationCtx,
  attempt: Doc<"sendAttempts">,
  at: number,
): Promise<void> {
  const conversation = await ctx.db.get("conversations", attempt.conversationId);
  if (conversation === null || conversation.prospectId === undefined) {
    return;
  }
  const lead = await ctx.db.get("prospects", conversation.prospectId);
  if (lead === null || lead.workspaceId !== attempt.workspaceId) {
    return;
  }
  // Replay guard: `markSendAccepted` keys its receipt on this attempt, so its
  // presence means this acceptance has already moved the ladder once.
  const prior = await findLeadEventByOperationKey(
    ctx,
    lead.workspaceId,
    `lead:${lead._id}:send-accepted:${attempt._id}`,
  );
  if (prior !== null) {
    return;
  }
  // They have replied, or a person has taken the lead out of the pipeline.
  // Neither gets another scheduled mail (PLAN §9.1's invalidation table).
  if (
    lead.lastReplyAt !== undefined ||
    lead.approval === "rejected" ||
    lead.stage === "rejected" ||
    lead.stage === "closed_lost"
  ) {
    return;
  }
  const agent = await ctx.db.get("agents", lead.agentId);
  if (agent === null || agent.workspaceId !== lead.workspaceId) {
    return;
  }

  const sentStep = lead.lastContactedAt === undefined ? 0 : lead.followUpsSent + 1;
  const followUpsSent = sentStep === 0 ? lead.followUpsSent : sentStep;
  const delay = followUpDelayMs(agent, followUpsSent + 1);
  await ctx.db.patch("prospects", lead._id, {
    followUpsSent,
    nextActionAt: delay === null ? undefined : at + delay,
    lastError: undefined,
    updatedAt: Date.now(),
  });
}

/**
 * Has this draft revision been put on the wire, or could it still be?
 *
 * A draft stays `current` on its conversation after it is sent — nothing
 * supersedes it until the next revision is written — so "is there an open
 * draft" is not the same question as "is there UNSENT mail here". Only the
 * second one may be rewritten or retired, and the difference is the attempt
 * ledger: anything past `reserved` has reached, or may have reached, the
 * provider, and a request that already left us is never retracted.
 */
export async function draftIsUnsent(
  ctx: { db: GenericDatabaseReader<DataModel> },
  draftId: Id<"drafts">,
): Promise<boolean> {
  const attempts = await ctx.db
    .query("sendAttempts")
    .withIndex("by_draftId", (q) => q.eq("draftId", draftId))
    .take(ATTEMPT_SCAN_MAX);
  return !attempts.some(
    (attempt) =>
      attempt.state === "acknowledged" ||
      attempt.state === "requesting" ||
      attempt.state === "uncertain",
  );
}

/** Attempts one draft revision can hold. One logical send, plus its retries. */
const ATTEMPT_SCAN_MAX = 10;

/** Load a lead for an outreach write, scoped to the agent that owns it. */
export async function loadLeadForAgent(
  ctx: MutationCtx,
  agentId: Id<"agents">,
  prospectId: Id<"prospects">,
): Promise<Doc<"prospects"> | null> {
  const lead = await ctx.db.get("prospects", prospectId);
  return lead !== null && lead.agentId === agentId ? lead : null;
}
