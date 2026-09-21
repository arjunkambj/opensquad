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
import { getServiceToken } from "convex/server";

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

/** The handle for a tier — the form every AI task uses. */
export function modelForTier(tier: ModelTier): GatewayModel {
  return convexGateway(MODELS[tier]);
}

/**
 * Can this deployment talk to the gateway at all?
 *
 * The provider mints a deployment service token inside its own `fetch`, so a
 * gateway that is not enabled for the team — or a token service that is down —
 * fails BEFORE a single byte is sent. That failure is a plain `Error`, and the
 * SDK's `handleFetchError` returns it unchanged rather than wrapping it in an
 * `APICallError`, so by the time it reaches `ai/failures.ts` it is
 * indistinguishable from a dropped connection: the hold would park as
 * `uncertain` for a call that cannot have cost anything.
 *
 * Minting the token here first turns that into a fact the caller can prove.
 * It costs nothing to do twice: `getServiceToken` reuses one token per action,
 * and a failed mint is not cached, so the provider's own call a moment later
 * takes this token rather than a second one.
 */
export async function gatewayTokenMintable(): Promise<boolean> {
  try {
    await getServiceToken("ai-gateway");
    return true;
  } catch (error) {
    // Server-side only, and the token itself is never touched — only the
    // reason it could not be minted, which an operator needs to see.
    console.error("ai gateway token could not be minted", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}
