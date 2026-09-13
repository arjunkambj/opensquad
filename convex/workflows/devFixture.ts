/**
 * DEVELOPMENT FIXTURE — P06 machinery gate only.
 *
 * `devFixtureMissionWorkflow` is a stand-in for the real sales-mission
 * pipeline (P09). Its stages are deterministic internal mutations producing
 * synthetic prospect keys — there is no model, no provider call and no
 * discovery here, and this file is NOT evidence for any of those. What it
 * exercises for real is the durable contract every later pipeline reuses:
 *
 *   dispatch gate → validated stage output → prospect branches with stable
 *   start keys → durable child-completion events → required human decision →
 *   durable event wait → persisted continuation → aggregated terminal outcome.
 *
 * Everything is journaled: completed steps are never re-executed on replay,
 * so a backend restart mid-wait resumes instead of re-running.
 */
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { vMissionOutcome } from "../lib/validators";
import type { EventId } from "@convex-dev/workflow";
import type { Infer } from "convex/values";
import { vDecisionContinuation } from "../decisions";
import { workflow } from "./manager";
import { resumeEvent, vBranchCompletion } from "./events";

/**
 * Parent mission workflow (dev fixture). `missions.create` starts one of
 * these per mission; `onMissionWorkflowComplete` reconciles terminal state.
 */
export const devFixtureMissionWorkflow = workflow.define({
  args: { missionId: v.id("missions") },
  returns: v.object({ outcome: vMissionOutcome }),
}).handler(async (step, args) => {
  // 1. Dispatch gate — a mission paused/cancelled before its workflow ran
  //    parks here; `missions.resume`/`cancel` move it again.
  let gate = await step.runMutation(
    internal.workflows.steps.gateMission,
    { missionId: args.missionId },
    { name: "gate:dispatch" },
  );
  while (gate.action === "wait") {
    await step.awaitEvent(resumeEvent);
    gate = await step.runMutation(
      internal.workflows.steps.gateMission,
      { missionId: args.missionId },
      { name: "gate:dispatch" },
    );
  }
  if (gate.action === "abandon") {
    return { outcome: "cancelled" as const };
  }

  // 2. Validated stage output — dev fixture only (deterministic synthetic
  //    prospect keys, run receipt recorded inside the step).
  const scan = await step.runMutation(
    internal.workflows.steps.devFixtureStage,
    { missionId: args.missionId },
    { name: "devFixtureStage" },
  );

  // 3. Prospect branches — stable (missionId, prospectId) start keys make a
  //    replayed step idempotent; each child gets a backend-created
  //    completion event on THIS workflow.
  const registered = await step.runMutation(
    internal.workflows.steps.registerBranches,
    {
      missionId: args.missionId,
      parentWorkflowId: step.workflowId,
      prospectKeys: scan.prospectKeys,
    },
    { name: "registerBranches" },
  );

  // 4. Durable wait for each child's terminal outcome — events may arrive in
  //    any order and survive a backend restart; the branch row is truth.
  const branchOutcomes: Infer<typeof vBranchCompletion>[] = [];
  for (const branch of registered.branches) {
    branchOutcomes.push(
      await step.awaitEvent({
        id: branch.completionEventId as EventId,
        validator: vBranchCompletion,
      }),
    );
  }

  // 5. Required human decision — one open ask per semantic askKey; the
  //    decision row records targetWorkflowId + continuationEventId +
  //    workflowGeneration before the workflow parks.
  const ask = await step.runMutation(
    internal.decisions.openRequiredDecision,
    {
      missionId: args.missionId,
      kind: "missing_information",
      reason:
        "Dev fixture: confirm this run may complete. This exercises the " +
        "durable decision wait — answer with any field value.",
      askKey: "dev_fixture:confirm_completion",
      required: true,
      requestedFields: ["confirmation"],
      targetWorkflowId: step.workflowId,
    },
    { name: "openDecision" },
  );
  await step.runMutation(
    internal.workflows.steps.markAwaitingUser,
    { missionId: args.missionId },
    { name: "markAwaitingUser" },
  );

  // 6. Durable event wait — the ONLY path that continues this workflow is a
  //    transactional `decisions.resolve`; a retired ask errors the wait so a
  //    parked workflow never hangs on a stale ask.
  let resolution: Infer<typeof vDecisionContinuation>;
  try {
    resolution = await step.awaitEvent({
      id: ask.continuationEventId as EventId,
      validator: vDecisionContinuation,
    });
  } catch {
    // Ask was superseded/cancelled underneath us — re-check and abandon.
    const check = await step.runMutation(
      internal.workflows.steps.checkContinuation,
      { missionId: args.missionId, decisionId: ask.decisionId },
      { name: "checkContinuation" },
    );
    return {
      outcome:
        check.action === "proceed" ? ("completed" as const) : ("cancelled" as const),
    };
  }

  // 7. Persisted continuation — re-validate the recorded decision (version,
  //    generation) and recheck pause/cancel/current inputs before finishing.
  let check = await step.runMutation(
    internal.workflows.steps.checkContinuation,
    {
      missionId: args.missionId,
      decisionId: ask.decisionId,
      decisionVersion: resolution.version,
    },
    { name: "checkContinuation" },
  );
  while (check.action === "wait") {
    await step.awaitEvent(resumeEvent);
    check = await step.runMutation(
      internal.workflows.steps.checkContinuation,
      {
        missionId: args.missionId,
        decisionId: ask.decisionId,
        decisionVersion: resolution.version,
      },
      { name: "checkContinuation" },
    );
  }
  if (check.action === "abandon") {
    return { outcome: "cancelled" as const };
  }

  const completed = await step.runMutation(
    internal.workflows.steps.completeMission,
    { missionId: args.missionId },
    { name: "completeMission" },
  );
  return { outcome: completed.outcome };
});

/**
 * Prospect-branch child workflow (dev fixture). One durable stage, then a
 * transactional outcome write + parent completion signal. `onComplete`
 * guarantees the parent event is always delivered, even on failure.
 */
export const devFixtureProspectWorkflow = workflow.define({
  args: {
    branchId: v.id("missionProspects"),
    missionId: v.id("missions"),
  },
  returns: v.null(),
}).handler(async (step, args) => {
  const stage = await step.runMutation(
    internal.workflows.steps.devFixtureBranchStage,
    { branchId: args.branchId },
    { name: "devFixtureBranchStage" },
  );
  await step.runMutation(
    internal.workflows.steps.completeBranch,
    { branchId: args.branchId, outcome: stage.outcome, reason: stage.reason },
    { name: "completeBranch" },
  );
  return null;
});
