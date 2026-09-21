/**
 * Company validators: the website-analysis status and the bounds on the
 * business profile an org writes during onboarding.
 */
import { vOperationErrorCode } from "./shared";
import { v } from "convex/values";

/**
 * Website analysis state (PLAN §5 "Onboarding edge cases"). The failure
 * variant carries a MAPPED code, never provider text: the screen says "We
 * couldn't read that website" and offers Retry / Fill in manually.
 * `firstRunUsed` is what makes the free first run free only on success.
 */
export const vAnalysisStatus = v.union(
  v.object({ state: v.literal("idle") }),
  v.object({ state: v.literal("analyzing"), startedAt: v.number() }),
  v.object({ state: v.literal("ready"), analyzedAt: v.number() }),
  v.object({
    state: v.literal("failed"),
    code: vOperationErrorCode,
    at: v.number(),
  }),
);

export const COMPANY_NAME_MAX_LENGTH = 200;

export const COMPANY_DESCRIPTION_MAX_LENGTH = 4_000;

export const COMPANY_PAIN_POINTS_MAX_LENGTH = 2_000;

export const COMPANY_LIST_MAX_ITEMS = 12;

export const COMPANY_LIST_ITEM_MAX_LENGTH = 300;
