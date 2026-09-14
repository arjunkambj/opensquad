/**
 * Workflow send boundary (P10 — architecture §6.1 step 8, G3 step 2).
 *
 * A sales/reply workflow reaches this AFTER a `draft_approval` decision
 * resolved `approved`. The whole outbound contract lives in `sending.ts`;
 * this file only adds the two durable behaviors a pipeline cannot do
 * itself:
 *
 * - `sendApprovedDraft` runs as a journaled step with `retry: false` — the
 *   adapter contract forbids blind retries; a re-run re-enters through the
 *   same attempt row + idempotency key, which is provider-safe.
 * - When preflight defers (`outside_send_window` with `nextPermittedAt`),
 *   the workflow sleeps DURABLY until the window opens, then re-runs the
 *   whole guarded path — nothing else is trusted to wait.
 *
 * Every other refusal is terminal for this dispatch and returned verbatim so
 * the caller can record a workflow receipt (§4.5 `send` output kind:
 * `sent | skipped | failed | partial` — refusals map to `skipped`,
 * `definitively_failed`/`uncertain` to `failed`/`uncertain` review).
 */
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { workflow } from "./manager";

/** Cap on window waits — a pathological policy can't park a workflow
 *  forever; each wait re-runs the entire preflight anyway. */
const MAX_WINDOW_WAITS = 14;

const vSendWorkflowResult = v.union(
  v.object({
    outcome: v.literal("acknowledged"),
    sendAttemptId: v.id("sendAttempts"),
    providerMessageRef: v.string(),
    providerThreadRef: v.string(),
  }),
  v.object({
    outcome: v.literal("definitively_failed"),
    sendAttemptId: v.id("sendAttempts"),
    reason: v.string(),
  }),
  v.object({
    outcome: v.literal("uncertain"),
    sendAttemptId: v.id("sendAttempts"),
    reason: v.string(),
  }),
  v.object({
    outcome: v.literal("preflight_refused"),
    code: v.string(),
    reason: v.string(),
    nextPermittedAt: v.optional(v.number()),
    // Carried whenever the refusal follows a committed reservation so the
    // pipeline can reference the parked attempt (mirrors vDispatchOutcome —
    // the workflow `returns` validator rejects extra fields).
    sendAttemptId: v.optional(v.id("sendAttempts")),
  }),
  v.object({
    outcome: v.literal("already_resolved"),
    sendAttemptId: v.id("sendAttempts"),
    state: v.string(),
  }),
  v.object({
    outcome: v.literal("in_flight"),
    sendAttemptId: v.id("sendAttempts"),
    state: v.string(),
  }),
);

/**
 * Dispatch one approved draft inside the durable send window. The caller
 * passes `expectedWorkflowGeneration` so a superseded mission workflow
 * abandons at preflight instead of sending.
 */
export const sendDraftWorkflow = workflow.define({
  args: {
    draftId: v.id("drafts"),
    expectedWorkflowGeneration: v.optional(v.number()),
    replacementDecisionId: v.optional(v.id("decisions")),
  },
  returns: vSendWorkflowResult,
}).handler(async (step, args) => {
  for (let wait = 0; wait <= MAX_WINDOW_WAITS; wait++) {
    const result = await step.runAction(
      internal.sending.sendApprovedDraft,
      {
        draftId: args.draftId,
        ...(args.expectedWorkflowGeneration !== undefined
          ? { expectedWorkflowGeneration: args.expectedWorkflowGeneration }
          : {}),
        ...(args.replacementDecisionId !== undefined
          ? { replacementDecisionId: args.replacementDecisionId }
          : {}),
      },
      // NO retry — the one-attempt boundary. The journaled step re-entering
      // through the same attempt row IS the safe replay; workpool retries
      // would violate the adapter contract.
      { name: `sendApprovedDraft:${wait}`, retry: false },
    );
    if (
      result.outcome === "preflight_refused" &&
      result.code === "outside_send_window" &&
      result.nextPermittedAt !== undefined &&
      wait < MAX_WINDOW_WAITS
    ) {
      // Durable wait until the window opens — the workflow is parked, not
      // spinning; on wake the entire preflight re-runs.
      await step.sleep(Math.max(0, result.nextPermittedAt - Date.now()), {
        name: `sendWindowWait:${wait}`,
      });
      continue;
    }
    return result;
  }
  return {
    outcome: "preflight_refused" as const,
    code: "outside_send_window",
    reason: `send window never opened within ${MAX_WINDOW_WAITS} waits`,
  };
});
