/**
 * The reply mission workflow (P11 — architecture §6.1/§8, card step 3).
 *
 * One inbound reply that passed the automation gate gets one of these. It is
 * pure orchestration: every decision it makes is a journaled step mutation in
 * `convex/inbox.ts`, so a backend restart mid-wait resumes instead of
 * re-running, and this file holds no business rule of its own.
 *
 * WHAT IT MAY DO, AND WHAT IT MAY NEVER DO.
 *
 * It classifies the reply, and — when the classification warrants one — it
 * PROPOSES a response draft. It never sends. There is no call to `sending.*`
 * here, no `agentmail.sendMessage`/`replyToMessage`/`forwardMessage`, and it
 * does not start `sendDraftWorkflow`. The only transition from a draft to the
 * wire is `approvals.approve`, an editor-authenticated human mutation, which
 * itself only schedules `internal.sending.sendApprovedDraft` — a boundary
 * that re-runs every gate fresh. "Every external response still needs its own
 * exact approval" is therefore a property of the code, not a convention.
 *
 * THE DRAFT REACHES THE SHIPPED APPROVAL PATH, NOT A NEW ONE.
 * `internal.drafts.createRevision` opens a normal required `draft_approval`
 * decision (`askKey: draft_approval:<draftId>`), which is exactly what
 * `decisions.listOpen` and the `/decisions/$decisionId` screen already render
 * and what `approvals.approve/requestChanges/reject` already resolve. This
 * workflow never calls `decisions.resolve` — that mutation REFUSES
 * `draft_approval`, and wiring it to one is the single most likely bug in
 * anything touching decisions.
 *
 * HOW IT WAITS. Two different waits, both durable, neither holding anything:
 *
 * - on model work, `awaitEvent` on the worker request's continuation event;
 * - on a human, `awaitEvent` on the decision's continuation event, after
 *   `markAwaitingUser` has parked the mission so its card honestly reads
 *   Needs you.
 *
 * The workspace execution slot is acquired by the WORKER at `/worker/claim`
 * and released when its request reaches a terminal state — never by a
 * workflow. So by the time this workflow parks on a human, its worker request
 * is already terminal and the slot is already free: the wait costs a journal
 * row and nothing else. The mission is moved out of `waiting_for_runtime`
 * before it parks on the human, so the two waits are never conflated.
 *
 * WHY EVERY PARK RETURNS RATHER THAN THROWS. A mid-pipeline pause must park
 * on `resumeEvent` and a closed gate must complete honestly; a throw escalates
 * the mission to `failed` through `onMissionWorkflowComplete` and makes resume
 * impossible. `ConvexError` data does not survive a step boundary either, so
 * every step returns a discriminated union instead of signalling by throwing.
 */
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { EventId } from "@convex-dev/workflow";
import { vMissionOutcome, vWorkerRequestCompletion } from "../lib/validators";
import type { MissionOutcome } from "../lib/validators";
import { workflow } from "./manager";
import { resumeEvent } from "./events";

/**
 * How many times the classify stage may park and retry while the workspace
 * has no dispatchable runtime connection. A reply that arrives while the
 * runtime is reconnecting is worth waiting a few minutes for; waiting
 * forever would pin a workflow on a box nobody is going to start.
 */
const MAX_RUNTIME_WAITS = 10;
const RUNTIME_WAIT_MS = 60_000;

export const replyMissionWorkflow = workflow
  .define({
    args: {
      missionId: v.id("missions"),
      conversationId: v.id("conversations"),
      /**
       * The inbound message this mission answers, fixed at creation. The
       * classify stage stands down if a newer message has since arrived —
       * that newer message started its own mission.
       */
      messageRef: v.string(),
    },
    returns: v.object({ outcome: vMissionOutcome }),
  })
  .handler(async (step, args): Promise<{ outcome: MissionOutcome }> => {
    const stageArgs = {
      missionId: args.missionId,
      conversationId: args.conversationId,
      messageRef: args.messageRef,
    };

    /** Finish honestly with a stated outcome rather than abandoning. */
    const finish = async (
      outcome: MissionOutcome,
      summary: string,
      name: string,
    ): Promise<{ outcome: MissionOutcome }> => {
      const completed = await step.runMutation(
        internal.inbox.completeReplyMission,
        { missionId: args.missionId, outcome, summary },
        { name },
      );
      return { outcome: completed.outcome };
    };

    // 1. Dispatch gate — a mission paused or terminated before its workflow
    //    ran parks or abandons here, exactly as every other mission does.
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

    // 2. Classify. The stage re-runs the whole reply-automation gate before
    //    it spends anything, because a takeover, a close, a workspace pause
    //    or a suppression can land while this workflow sits in the queue.
    let classify = await step.runMutation(
      internal.inbox.classifyReplyStage,
      { ...stageArgs, targetWorkflowId: step.workflowId },
      { name: "classify:0" },
    );
    let runtimeWaits = 0;
    let attempt = 0;
    while (classify.action === "wait" || classify.action === "unavailable") {
      if (classify.action === "wait") {
        // Paused mid-pipeline: park on the resume event, never throw.
        await step.awaitEvent(resumeEvent);
      } else {
        if (runtimeWaits >= MAX_RUNTIME_WAITS) {
          return await finish(
            "contact_needed",
            "No runtime connection was available to classify this reply; it is waiting for a human.",
            "finish:runtimeUnavailable",
          );
        }
        runtimeWaits += 1;
        await step.sleep(RUNTIME_WAIT_MS, { name: `runtimeWait:${runtimeWaits}` });
      }
      attempt += 1;
      classify = await step.runMutation(
        internal.inbox.classifyReplyStage,
        { ...stageArgs, targetWorkflowId: step.workflowId },
        { name: `classify:${attempt}` },
      );
    }
    if (classify.action === "abandon") {
      return { outcome: "cancelled" as const };
    }
    if (classify.action === "halt") {
      return await finish(
        "skipped",
        `Reply automation stood down before classifying (${classify.reason}).`,
        "finish:classifyHalted",
      );
    }

    // 3. Durable wait on the worker request. The completion event is always
    //    delivered with a value — `cancelled` and `uncertain` included — so
    //    this wait cannot hang on a request the sweep retired.
    await step.awaitEvent({
      id: classify.continuationEventId as EventId,
      validator: vWorkerRequestCompletion,
    });

    // 4. The recorded request row is the truth; the event was a hint. The
    //    step re-reads it rather than trusting the payload that woke us, and
    //    an unusable answer becomes `needs_review`, never a guess.
    const classified = await step.runMutation(
      internal.inbox.applyReplyDisposition,
      {
        missionId: args.missionId,
        conversationId: args.conversationId,
        workerRequestId: classify.workerRequestId,
      },
      { name: "applyDisposition" },
    );

    // 5. Dispositions that must not be answered stop here — no draft, no
    //    send, no second model call.
    return await finish(
      classified.outcome,
      classified.summary,
      "finish:disposition",
    );
  });
