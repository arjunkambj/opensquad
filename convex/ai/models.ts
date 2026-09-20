/**
 * Which model each tier means, and the one factory that turns a tier into a
 * gateway handle (PLAN §4 "AI", spikes §1).
 *
 * Two tiers, `fast` and `smart`, so a call site says what it needs rather
 * than naming a model. Both currently point at the same pinned id: the owner
 * chose it after the T00 spike measured every id the gateway serves, and
 * keeping the two names means retuning `fast` later is a one-line change here
 * instead of an edit to every AI task.
 *
 * Always a PINNED id. Never a `~…-latest` alias — a model that changes under
 * us changes every prompt's behaviour without a deploy — and never a `:batch`
 * twin, which answers on a different latency contract than the product's.
 */
// Pinned EXACTLY at 0.2.0-alpha.1 (package.json). Schema-constrained object
// output works on that version and FAILS on 0.1.0, which builds the provider
// without `supportsStructuredOutputs`, so the SDK silently downgrades to
// `response_format: { type: "json_object" }`, sends no schema, and the
// upstream answers 400 (spikes §2). Do not float this dependency.
import { convexGateway } from "@convex-dev/ai-sdk-provider";

export const MODEL_TIERS = ["fast", "smart"] as const;

/** Which tier a call site asks for: the cheap pass, or the careful one. */
export type ModelTier = (typeof MODEL_TIERS)[number];

export const MODELS: Record<ModelTier, string> = {
  fast: "openai/gpt-5.6-sol",
  smart: "openai/gpt-5.6-sol",
};

/** The model handle `generateText` takes. Named so call sites never have to
 *  spell out the provider package's own return type. */
export type GatewayModel = ReturnType<typeof convexGateway>;

/**
 * A gateway handle for a raw model id. The deployment's own service token is
 * minted inside the provider, so no model key is stored or passed anywhere.
 */
export function gatewayModel(modelId: string): GatewayModel {
  return convexGateway(modelId);
}

/** The handle for a tier — the form every AI task uses. */
export function modelForTier(tier: ModelTier): GatewayModel {
  return gatewayModel(MODELS[tier]);
}
