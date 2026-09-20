/**
 * The AI foundation's smoke test (EXECUTION T03 "Done when").
 *
 * One tiny schema-constrained generation through `runStructured`, under the
 * zero-credit `profile_company` action, so the integrator can prove on a real
 * deployment that the gateway answers, that the object comes back validated
 * by our own Convex validator, and that exactly one `ai_calls` unit is
 * debited out of the two the worst case reserves.
 *
 * The result shape deliberately exercises the whole schema mapping: an
 * object, a boolean, a union of literals (→ `enum`), an array of strings and
 * an OPTIONAL string (→ required-and-nullable on the wire, absent again once
 * parsed).
 *
 * Internal only, and it spends real money — a few tenths of a cent per run.
 */
import { internalAction } from "../_generated/server";
import { vPaidOutcome, vRefundReason } from "../billing/paidCall";
import { runStructured } from "./run";
import { v } from "convex/values";

const vHealthObject = v.object({
  ok: v.boolean(),
  color: v.union(v.literal("red"), v.literal("green"), v.literal("blue")),
  words: v.array(v.string()),
  note: v.optional(v.string()),
});

const HEALTH_SYSTEM =
  "You are a service health probe. Answer only with the required object.";

const HEALTH_INPUT =
  "Set ok to true, color to green, and words to exactly two short words " +
  "describing a clear sky. Leave note out.";

export const check = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    /** A fresh key each run, or the operation replays instead of calling. */
    operationKey: v.optional(v.string()),
    /** Pass a nonsense id to provoke the gateway's 400 refusal branch. */
    modelId: v.optional(v.string()),
  },
  returns: v.object({
    kind: vPaidOutcome,
    replayed: v.boolean(),
    operationKey: v.string(),
    status: v.optional(
      v.union(v.literal("object"), v.literal("invalid_response")),
    ),
    object: v.optional(vHealthObject),
    attempts: v.optional(v.number()),
    credits: v.optional(v.number()),
    /** Units actually committed — the "exactly one" the task asks for. */
    aiCalls: v.optional(v.number()),
    reason: v.optional(vRefundReason),
  }),
  handler: async (ctx, args) => {
    const outcome = await runStructured(ctx, {
      workspaceId: args.workspaceId,
      action: "profile_company",
      tier: "fast",
      system: HEALTH_SYSTEM,
      input: HEALTH_INPUT,
      result: vHealthObject,
      operationKey: args.operationKey ?? `health:${Date.now()}`,
      maxOutputTokens: 256,
      ...(args.modelId !== undefined ? { modelId: args.modelId } : {}),
    });

    if (outcome.kind === "refunded") {
      return {
        kind: "refunded" as const,
        replayed: outcome.replayed,
        operationKey: outcome.operationKey,
        reason: outcome.reason,
      };
    }
    if (outcome.kind === "uncertain") {
      return {
        kind: "uncertain" as const,
        replayed: false,
        operationKey: outcome.hold.operationKey,
        credits: outcome.hold.credits,
        aiCalls: outcome.hold.providerUnits.ai_calls ?? 0,
      };
    }
    if (outcome.replayed) {
      // Already bought under this key: the caller re-reads what it stored.
      return {
        kind: "billed" as const,
        replayed: true,
        operationKey: outcome.operationKey,
        credits: outcome.credits,
        aiCalls: outcome.providerUnits.ai_calls ?? 0,
      };
    }
    return {
      kind: "billed" as const,
      replayed: false,
      operationKey: outcome.operationKey,
      status: outcome.result.status,
      ...(outcome.result.status === "object"
        ? { object: outcome.result.object }
        : {}),
      attempts: outcome.result.attempts,
      credits: outcome.credits,
      aiCalls: outcome.providerUnits.ai_calls ?? 0,
    };
  },
});
