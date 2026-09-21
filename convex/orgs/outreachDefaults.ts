/**
 * The org's default outreach instructions — Settings → Outreach
 * (PLAN §1: "templates as one instructions field").
 *
 * ONE field, not a template library. The writer reads it only when the agent
 * that is sending has no instructions of its own, so this is a fallback and
 * never an override; the Outreach tab says so in as many words.
 *
 * Absent and empty are the SAME state — "no default" — so clearing the field
 * removes it rather than storing `""`. A save that changes nothing does not
 * touch the record at all: `updatedAt` is what every settings form resyncs
 * on, and churning it would reset a form nobody edited.
 */
import { mutation, query } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import {
  boundedString,
  DEFAULT_INSTRUCTIONS_MAX_LENGTH,
  domainError,
} from "../lib/validators";
import { v } from "convex/values";


const vDefaultInstructions = v.object({
  /** `null` — no default set; the agent's own instructions decide alone. */
  instructions: v.union(v.string(), v.null()),
  /** The org record's `updatedAt`, so the editor can resync on it. */
  updatedAt: v.number(),
});

/** The current default instructions. Readable by any active member. */
export const get = query({
  args: { orgId: v.id("orgs") },
  returns: vDefaultInstructions,
  handler: async (ctx, args) => {
    const { org } = await requireOrgMember(ctx, args.orgId);
    return {
      instructions: org.defaultInstructions ?? null,
      updatedAt: org.updatedAt,
    };
  },
});

/**
 * Save (or clear) the default instructions, guarded by the active
 * organization like every other write that changes what the agent will say.
 *
 * Unguarded by `policyVersion` on purpose: instructions do not change WHEN or
 * WHETHER a queued draft may go out, so invalidating pending approvals here
 * would be a lie about what changed. A draft already written keeps its words;
 * the next one is written from the new default.
 */
export const save = mutation({
  args: {
    orgId: v.id("orgs"),
    /** Blank or whitespace-only clears the default. */
    instructions: v.string(),
  },
  returns: vDefaultInstructions,
  handler: async (ctx, args) => {
    const { org } = await requireOrgMember(ctx, args.orgId);
    const trimmed = boundedString(args.instructions, "instructions", {
      max: DEFAULT_INSTRUCTIONS_MAX_LENGTH,
    });
    const next = trimmed.length === 0 ? undefined : trimmed;

    if (next === org.defaultInstructions) {
      return {
        instructions: org.defaultInstructions ?? null,
        updatedAt: org.updatedAt,
      };
    }

    await ctx.db.patch("orgs", org._id, {
      // `undefined` removes the field — absent is the canonical "no default".
      defaultInstructions: next,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get("orgs", org._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    return {
      instructions: updated.defaultInstructions ?? null,
      updatedAt: updated.updatedAt,
    };
  },
});
