/**
 * The lead behind a thread, and the four ways a reply moves it.
 *
 * `prospects.stage` is the whole state machine (PLAN §7), so every write here
 * keeps the three rules it rests on: an automatic transition may only move a
 * lead FORWARD, it never enters or leaves `rejected`, and it can never reach
 * `meeting_booked` — a meeting is booked by a person pressing Mark as booked
 * and by nothing else (PLAN §9.5). The one stage outside the ordered pipeline
 * a reply may write is `closed_lost`, and only from a deterministic rule or a
 * clear "no".
 *
 * Every business update and its `leadEvents` row are written in ONE
 * transaction, so the lead's history can never disagree with the lead.
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { appendLeadEvent } from "../leads/events";
import {
  advancedLeadStage,
  boundedString,
  PROSPECT_STAGE_REASON_MAX_LENGTH,
  TERMINAL_LEAD_STAGES,
} from "../lib/validators";
import type { LeadPipelineStage } from "../lib/validators";

/** The lead a thread is bound to, re-checked against its own org. */
export async function leadOfConversation(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
): Promise<Doc<"prospects"> | null> {
  if (conversation.prospectId === undefined) {
    return null;
  }
  const lead = await ctx.db.get("prospects", conversation.prospectId);
  return lead === null || lead.orgId !== conversation.orgId
    ? null
    : lead;
}

/**
 * Move the lead forward, and record it — never backward, never out of a
 * terminal stage, and never into `meeting_booked`, which only the user's
 * "Mark as booked" writes (PLAN §9.5). `advancedLeadStage` enforces all
 * three; this adds the history row and the stated basis.
 */
export async function advanceLead(
  ctx: MutationCtx,
  lead: Doc<"prospects">,
  target: LeadPipelineStage,
  args: { reason: string; operationKey: string },
): Promise<Doc<"prospects">> {
  const next = advancedLeadStage(lead.stage, target);
  if (next === lead.stage) {
    return lead;
  }
  const reason = boundedString(args.reason, "reason", {
    min: 1,
    max: PROSPECT_STAGE_REASON_MAX_LENGTH,
  });
  await ctx.db.patch("prospects", lead._id, {
    stage: next,
    stageReason: reason,
    updatedAt: Date.now(),
  });
  await appendLeadEvent(ctx, {
    orgId: lead.orgId,
    prospectId: lead._id,
    kind: "stage_changed",
    summary: `Stage ${lead.stage} → ${next}: ${reason}`,
    operationKey: args.operationKey,
    fromStage: lead.stage,
    toStage: next,
  });
  return (await ctx.db.get("prospects", lead._id)) ?? lead;
}

/**
 * End the pipeline for this lead: `closed_lost`, due for nothing.
 *
 * `closed_lost` is outside the ordered pipeline, so `advancedLeadStage`
 * cannot express it and this writes the stage itself. The two guards it keeps
 * are the ones that rule out: a lead already terminal is left alone (a second
 * closure would only rewrite its reason), and `meeting_booked` is never
 * overwritten by a rule reading text — a meeting the user recorded outranks
 * anything a later mail says.
 */
export async function closeLeadLost(
  ctx: MutationCtx,
  lead: Doc<"prospects">,
  args: { reason: string; operationKey: string },
): Promise<void> {
  if (
    TERMINAL_LEAD_STAGES.includes(lead.stage) ||
    lead.stage === "meeting_booked"
  ) {
    return;
  }
  const reason = boundedString(args.reason, "reason", {
    min: 1,
    max: PROSPECT_STAGE_REASON_MAX_LENGTH,
  });
  await ctx.db.patch("prospects", lead._id, {
    stage: "closed_lost",
    stageReason: reason,
    nextActionAt: undefined,
    updatedAt: Date.now(),
  });
  await appendLeadEvent(ctx, {
    orgId: lead.orgId,
    prospectId: lead._id,
    kind: "stage_changed",
    summary: `Stage ${lead.stage} → closed_lost: ${reason}`,
    operationKey: args.operationKey,
    fromStage: lead.stage,
    toStage: "closed_lost",
  });
}

/** Milliseconds in a day, for a `not_now` reschedule. */
const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Record when this lead is worth another look — and it is now a date that
 * SELECTS the lead, not one that is merely displayed.
 *
 * `prospects.lastReplyAt` used to exclude a replied lead from every outreach
 * selection range, so this timestamp scheduled nothing: the thread note
 * promised "another look in about N days" and nothing ever looked.
 * `outreachPlan.replyFollowUpDue` is the reader — a lead at stage `replied`
 * whose `nextActionAt` has come round is due for exactly one more message,
 * and a NEWER reply clears the date (`markReplied`) so the promise is
 * withdrawn the moment the lead writes again.
 *
 * It is only ever a reschedule, never a resurrection: a closed, rejected or
 * suppressed lead is refused by the selection, the claim and the send gates
 * in turn.
 */
export async function scheduleLeadFollowUp(
  ctx: MutationCtx,
  lead: Doc<"prospects">,
  days: number,
): Promise<void> {
  await ctx.db.patch("prospects", lead._id, {
    nextActionAt: Date.now() + days * DAY_MS,
    updatedAt: Date.now(),
  });
}
