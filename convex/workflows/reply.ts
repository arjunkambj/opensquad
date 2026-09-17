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
 * BUT IT OUTLIVES THE SEND IT AUTHORIZED. The mission may not go terminal at
 * approval, because `evaluateSendGates` refuses a `completed` mission with
 * `mission_inactive` and `beginDispatch` cancels the attempt on that refusal —
 * so a reply parked for the send window or the daily cap would be thrown away
 * hours later, and a lost acknowledgement would open no `delivery_uncertain`
 * ask at all. After an approval the workflow therefore polls
 * `internal.inbox.checkApprovedSend`, a pure read of the send path, sleeping
 * durably while the attempt is parked and parking on the uncertainty ask when
 * the provider outcome is unknown. It still dispatches nothing.
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
import type { Infer } from "convex/values";
import { vMissionOutcome, vWorkerRequestCompletion } from "../lib/validators";
import type { MissionOutcome } from "../lib/validators";
import { vDecisionContinuation } from "../decisions";
import { workflow } from "./manager";
import { resumeEvent } from "./events";

/**
 * How many times a dispatching stage may park and retry while the workspace
 * has no dispatchable runtime connection. A reply that arrives while the
 * runtime is reconnecting is worth waiting a few minutes for; waiting
 * forever would pin a workflow on a box nobody is going to start.
 */
const MAX_RUNTIME_WAITS = 10;
const RUNTIME_WAIT_MS = 60_000;

/**
 * How many drafts one reply mission may propose. A reviewer who asks for
 * changes gets one rewrite; a second refusal is a sign the thread needs a
 * person, not another model call.
 */
const MAX_DRAFT_ATTEMPTS = 2;

/**
 * How many times the workflow re-polls the send an approval authorized before
 * handing it to a human. A parked attempt waits out one closed send window
 * per poll, so this covers a long weekend with room to spare; an attempt that
 * is still unsettled after that is not something another sleep will fix.
 */
const MAX_SEND_SETTLE_WAITS = 14;

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
    let reclassify = 0;
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
      reclassify += 1;
      classify = await step.runMutation(
        internal.inbox.classifyReplyStage,
        { ...stageArgs, targetWorkflowId: step.workflowId },
        { name: `classify:${reclassify}` },
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
        ...stageArgs,
        workerRequestId: classify.workerRequestId,
      },
      { name: "applyDisposition" },
    );

    // 5. Dispositions that must not be answered stop here — no draft, no
    //    send, no second model call.
    if (classified.next === "stop") {
      return await finish(
        classified.outcome,
        classified.summary,
        "finish:disposition",
      );
    }

    // 6. Propose a response draft. Each attempt re-runs the gate, dispatches
    //    one bounded drafting turn, installs the result as an immutable
    //    revision through `drafts.createRevision` and parks on the required
    //    `draft_approval` ask that it opens.
    let attempt = 1;
    let guidance: string | undefined;
    for (;;) {
      let redispatch = 0;
      let proposed = await step.runMutation(
        internal.inbox.proposeReplyDraftStage,
        {
          ...stageArgs,
          attempt,
          targetWorkflowId: step.workflowId,
          ...(guidance === undefined ? {} : { guidance }),
        },
        { name: `draft:${attempt}:${redispatch}` },
      );
      while (proposed.action === "wait" || proposed.action === "unavailable") {
        if (proposed.action === "wait") {
          await step.awaitEvent(resumeEvent);
        } else {
          if (runtimeWaits >= MAX_RUNTIME_WAITS) {
            return await finish(
              "contact_needed",
              "No runtime connection was available to draft a response; the reply is waiting for a human.",
              "finish:draftRuntimeUnavailable",
            );
          }
          runtimeWaits += 1;
          await step.sleep(RUNTIME_WAIT_MS, {
            name: `draftRuntimeWait:${runtimeWaits}`,
          });
        }
        redispatch += 1;
        proposed = await step.runMutation(
          internal.inbox.proposeReplyDraftStage,
          {
            ...stageArgs,
            attempt,
            targetWorkflowId: step.workflowId,
            ...(guidance === undefined ? {} : { guidance }),
          },
          { name: `draft:${attempt}:${redispatch}` },
        );
      }
      if (proposed.action === "abandon") {
        return { outcome: "cancelled" as const };
      }
      if (proposed.action === "halt") {
        return await finish(
          "contact_needed",
          `No response was drafted (${proposed.reason}); the reply is waiting for a human.`,
          `finish:draftHalted:${attempt}`,
        );
      }

      await step.awaitEvent({
        id: proposed.continuationEventId as EventId,
        validator: vWorkerRequestCompletion,
      });

      const installed = await step.runMutation(
        internal.inbox.installReplyDraft,
        {
          ...stageArgs,
          attempt,
          workerRequestId: proposed.workerRequestId,
          targetWorkflowId: step.workflowId,
        },
        { name: `install:${attempt}` },
      );
      if (installed.action === "halt") {
        return await finish(
          "contact_needed",
          `The proposed response was not installed (${installed.reason}); the reply is waiting for a human.`,
          `finish:installHalted:${attempt}`,
        );
      }

      // 7. Park on the human. The worker request is already terminal, so the
      //    workspace execution slot the worker held is released before this
      //    wait begins; the mission is out of `waiting_for_runtime` and reads
      //    Needs you instead. Nothing here can send — only
      //    `approvals.approve` can, and only a human can call it.
      await step.runMutation(
        internal.workflows.steps.markAwaitingUser,
        { missionId: args.missionId },
        { name: `markAwaitingUser:${attempt}` },
      );
      let resolution: Infer<typeof vDecisionContinuation>;
      try {
        resolution = await step.awaitEvent({
          id: installed.continuationEventId as EventId,
          validator: vDecisionContinuation,
        });
      } catch {
        // The ask was superseded or cancelled underneath us — a newer inbound
        // message, a revision, or a mission termination. Finish honestly
        // rather than returning `cancelled`, which `onMissionWorkflowComplete`
        // would reconcile into a misleading `failed`.
        return await finish(
          "skipped",
          "The approval ask was retired before it was answered; nothing was sent.",
          `finish:askRetired:${attempt}`,
        );
      }

      // 8. The delivered payload is a hint; the recorded decision row is
      //    re-validated (resolved, at exactly this version, same workflow
      //    generation) before anything acts on it.
      let check = await step.runMutation(
        internal.workflows.steps.checkContinuation,
        {
          missionId: args.missionId,
          decisionId: installed.decisionId,
          decisionVersion: resolution.version,
        },
        { name: `checkContinuation:${attempt}` },
      );
      while (check.action === "wait") {
        await step.awaitEvent(resumeEvent);
        check = await step.runMutation(
          internal.workflows.steps.checkContinuation,
          {
            missionId: args.missionId,
            decisionId: installed.decisionId,
            decisionVersion: resolution.version,
          },
          { name: `checkContinuation:${attempt}` },
        );
      }
      if (check.action === "abandon") {
        return { outcome: "cancelled" as const };
      }

      // `changes_requested` and `rejected` BOTH carry `approved: false`, so
      // the branch reads `fields.draftResolution` and never `answer.approved`.
      const draftResolution = resolution.answer.fields?.draftResolution;
      if (draftResolution === "approved") {
        // `approvals.approve` already scheduled the send boundary, and this
        // workflow still does not dispatch: a second dispatcher on one attempt
        // row would race the first for the `reserved → requesting` flip and
        // add nothing. What it MUST do is outlive the send it authorized.
        //
        // The boundary can legitimately park the attempt — outside the send
        // window, or with the day's allowance spent — and re-drive it hours
        // later. Every re-entry re-runs `evaluateSendGates`, which refuses a
        // `completed` mission with `mission_inactive`, on which `beginDispatch`
        // CANCELS the attempt. Completing here therefore discarded the
        // reviewer's explicitly approved reply the moment the send had to
        // wait. A terminal transition also retires a `delivery_uncertain`
        // ask mid-flight via `completeReplyMission`'s `retireAllOpenDecisions`
        // — and a cancelled ask cannot be resolved.
        //
        // So the mission stays non-terminal until the send settles: polled
        // through a journaled read-only step, slept on durably while parked,
        // and parked on the `delivery_uncertain` ask when the provider
        // outcome is unknown. Nothing here can send — only `approvals.approve`
        // can, a human already did, and every gate still re-runs inside
        // `beginDispatch`.
        const awaited = new Set<string>();
        let settleWaits = 0;
        let unsettledReason = "no_attempt";
        for (;;) {
          const send = await step.runMutation(
            internal.inbox.checkApprovedSend,
            { missionId: args.missionId, draftId: installed.draftId },
            { name: `awaitSend:${attempt}:${settleWaits}` },
          );
          if (send.action === "settled") {
            return await finish(
              send.outcome,
              send.summary,
              `finish:sent:${attempt}:${settleWaits}`,
            );
          }
          if (settleWaits >= MAX_SEND_SETTLE_WAITS) {
            return await finish(
              "contact_needed",
              `Approved response revision ${installed.revision} has not settled (${unsettledReason}); it is waiting for a human.`,
              `finish:sendUnsettled:${attempt}`,
            );
          }
          settleWaits += 1;
          if (send.action === "review") {
            // One event id may be awaited exactly once; a second await throws.
            // A `delivery_uncertain` ask that comes back unchanged means the
            // reconciliation is genuinely a human's, so stop waiting on it.
            if (awaited.has(send.continuationEventId)) {
              return await finish(
                "contact_needed",
                `Delivery of approved response revision ${installed.revision} is uncertain; a human owns the reconciliation.`,
                `finish:sendUncertain:${attempt}`,
              );
            }
            awaited.add(send.continuationEventId);
            unsettledReason = "delivery_uncertain";
            await step.runMutation(
              internal.workflows.steps.markAwaitingUser,
              { missionId: args.missionId },
              { name: `markAwaitingSend:${attempt}:${settleWaits}` },
            );
            try {
              await step.awaitEvent({
                id: send.continuationEventId as EventId,
                validator: vDecisionContinuation,
              });
            } catch {
              // Superseded or cancelled underneath us. Re-read the attempt
              // rather than guessing what replaced the ask.
            }
            continue;
          }
          unsettledReason = send.reason;
          await step.sleep(Math.max(0, send.untilMs - Date.now()), {
            name: `sendWait:${attempt}:${settleWaits}`,
          });
        }
      }
      if (draftResolution === "changes_requested") {
        if (attempt < MAX_DRAFT_ATTEMPTS) {
          guidance = resolution.answer.body;
          attempt += 1;
          continue;
        }
        return await finish(
          "contact_needed",
          "The reviewer asked for changes again; the reply is waiting for a human to write it.",
          "finish:changesExhausted",
        );
      }
      return await finish(
        "skipped",
        "The reviewer rejected the proposed response; nothing was sent.",
        `finish:rejected:${attempt}`,
      );
    }
  });
