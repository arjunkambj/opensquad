/**
 * Where the user got to in setup — the one mutation every onboarding dot
 * calls to move (PLAN §5 "Onboarding edge cases", §11 M1).
 *
 * Progress lives on the draft agent, not in the URL and not in the browser, so
 * a refresh, a different device or a sign-out and back resumes on the step the
 * user actually reached. The page renders from the agent row; this is the only
 * thing that writes it.
 *
 * Three rules, enforced here rather than trusted from the client:
 *
 *   ONE STEP FORWARD. A caller may go back to any step it has already been
 *   through, or forward to the very next one. Jumping ahead would skip the
 *   answers the skipped step collects, and the screens after it would render
 *   from data nobody gave.
 *
 *   NEVER TO `done`. Finishing onboarding is a separate act with its own
 *   consequences — the agent goes live and the first run is scheduled — and it
 *   belongs to the Confirm button on the last dot, not to a step change.
 *
 *   A DOT CANNOT BE LEFT HALF-ANSWERED. Leaving the company dot requires a
 *   saved profile with the fields everything downstream reads.
 */
import { mutation } from "../_generated/server";
import { getOrgProfile, profileIsComplete } from "../company/model";
import { requireOrgMember } from "../lib/auth";
import {
  domainError,
  invalid,
  ONBOARDING_STEPS,
  vOnboardingStep,
} from "../lib/validators";
import type { OnboardingStep } from "../lib/validators";
import { getOrgAgent, vAgentDoc } from "./model";
import { v } from "convex/values";

function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

/**
 * Move the org's draft agent to `step`.
 *
 * Idempotent: asking for the step the agent is already on returns it
 * unchanged, so a double click or a replayed request is not an error the user
 * has to read.
 */
export const setStep = mutation({
  args: {
    orgId: v.id("orgs"),
    step: vOnboardingStep,
  },
  returns: vAgentDoc,
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const agent = await getOrgAgent(ctx, args.orgId);
    if (agent === null) {
      throw domainError("NOT_FOUND", "this organization has no agent yet");
    }
    if (args.step === "done") {
      throw invalid(
        "onboarding is finished by the confirmation step, not by a step change",
      );
    }

    const from = stepIndex(agent.onboardingStep);
    const to = stepIndex(args.step);
    if (to === from) {
      return agent;
    }
    if (to > from + 1) {
      throw invalid("onboarding moves one step forward at a time");
    }

    // Going forward out of the company dot needs the profile every later step
    // reads. Going back never does — a user returning to fix something must
    // not be held by the rule that sent them there.
    if (to > from && agent.onboardingStep === "company") {
      const profile = await getOrgProfile(ctx, args.orgId);
      if (!profileIsComplete(profile)) {
        throw invalid(
          "the company profile needs a name, industry, description and at least one key feature",
        );
      }
    }

    await ctx.db.patch("agents", agent._id, {
      onboardingStep: args.step,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get("agents", agent._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "agent not found after update");
    }
    return updated;
  },
});
