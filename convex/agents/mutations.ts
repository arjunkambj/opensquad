/**
 * Agent writes — creating the draft agent onboarding fills in. Nothing here
 * schedules work.
 *
 * ONE AGENT PER ORG. Convex has no unique index, so `createDraft` reads
 * the org's agent range in the SAME transaction it inserts into. Convex
 * mutations are serializable, so two concurrent creates cannot both pass that
 * read — the lookup index is what turns into the constraint.
 *
 * EDITS LIVE IN `settings*.ts`. The agent's name, instructions, booking link,
 * deal size, follow-up rhythm and mode are written there and nowhere else, so
 * every field has exactly one writer and "what bumps `revision`" is one list
 * in one place (PLAN §9.1 "Revision fencing").
 */
import { mutation } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import { createDraftAgent, vAgentDoc } from "./model";
import { v } from "convex/values";

/**
 * Create the org's draft agent — the row onboarding fills in step by
 * step.
 *
 * ONE AGENT PER ORG, enforced in `createDraftAgent` rather than by an
 * index: the read and the insert are in one serializable transaction, so a
 * second create — concurrent or later — sees the first and refuses. Callers
 * that only want "the agent" read `agents.get` first; a CONFLICT here means
 * there already is one, never that anything was lost.
 *
 * Org creation makes this same draft agent in its own transaction, so
 * onboarding progress always has a home; this mutation stays for the case
 * where an org somehow has none.
 */
export const createDraft = mutation({
  args: { orgId: v.id("orgs") },
  returns: vAgentDoc,
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    return await createDraftAgent(ctx, args.orgId);
  },
});
