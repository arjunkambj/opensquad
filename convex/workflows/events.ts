/**
 * Shared durable-event definitions for the mission workflows.
 *
 * `resumeEvent` is the named event a mission workflow waits on when it is
 * parked (paused mid-execution); `missions.resume` sends it. Decision and
 * branch-completion events are created per-occurrence via `createEvent` with
 * per-ask/per-branch names (`decision:<askKey>`, `branch-complete:<key>`) —
 * their validators live next to the records that produce them
 * (`vDecisionContinuation` in decisions.ts, `vBranchCompletion` below).
 */
import { defineEvent } from "@convex-dev/workflow";
import { v } from "convex/values";
import { vMissionProspectOutcome } from "../lib/validators";

export const resumeEvent = defineEvent({
  name: "mission-resume",
  validator: v.object({ resumedAt: v.number() }),
});

/**
 * Terminal outcome a prospect-branch child workflow delivers to its parent.
 * The parent treats it as a hint: `missionProspects.outcome` is the record of
 * truth and was written transactionally before this event was sent.
 */
export const vBranchCompletion = v.object({
  branchId: v.id("missionProspects"),
  prospectId: v.string(),
  outcome: vMissionProspectOutcome,
  reason: v.string(),
});
