/**
 * Agent settings — what the user changes about their agent from `/agent`
 * (PLAN §9.1, §9.3, EXECUTION T32).
 *
 * This file holds the BASICS: the name, the instructions the writer is given,
 * the booking link it may offer and the follow-up rhythm. Its siblings hold
 * the two settings with consequences of their own — `settingsMode.ts` (the
 * mode matrix and Autopilot consent) and `settingsRun.ts` (signal toggles,
 * Run now, re-queueing a parked lead).
 *
 * Two rules govern every write here.
 *
 *   REVISION FENCING (PLAN §9.1). `agents.revision` moves when what the agent
 *   SAYS changes — instructions, tone, goal, ICP, template, mode — so work
 *   already queued under the old wording is superseded rather than sent. Of
 *   this file's fields only `instructions` is one of them, and it bumps
 *   EXACTLY ONCE and only on a real difference: the page re-saves the same
 *   text whenever the user leaves and returns, and invalidating queued drafts
 *   for a no-op edit would be a bug the user cannot see.
 *
 *   ONE WRITER PER FIELD. Everything that patches an agent's basics goes
 *   through `patchAgent` below, so "what changes the revision" is one list in
 *   one place rather than a rule each mutation re-implements.
 */
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireOrgMember } from "../lib/auth";
import { checkPublicHttpUrl } from "../lib/urlSafety";
import {
  AGENT_INSTRUCTIONS_MAX_LENGTH,
  AGENT_NAME_MAX_LENGTH,
  boundedInt,
  boundedString,
  domainError,
  invalid,
  normalizeHttpUrl,
} from "../lib/validators";
import { requireOrgAgent, vAgentDoc } from "./model";
import { v } from "convex/values";

/* Bounds                                                              */
/*                                                                     */
/* These belong in `convex/lib/limits.ts` with the rest of the policy  */
/* numbers; they are local constants only because that file is         */
/* integrator-only (EXECUTION §0).                                     */

/** At most three follow-ups per thread, and none further out than a quarter:
 *  past that the first mail is not a thread the recipient remembers. An empty
 *  list is the honest way to say "send once and stop". */
export const FOLLOW_UP_STEPS_MAX = 3;

export const FOLLOW_UP_DAY_MIN = 1;

export const FOLLOW_UP_DAY_MAX = 90;

/** A deal size is a figure the dashboard multiplies, not a currency string. */
export const DEAL_SIZE_MAX = 10_000_000;

export type AgentEditContext = {
  agent: Doc<"agents">;
  identityKey: string;
};

/**
 * Resolve "the caller may edit this org's agent" once, for this file and
 * its siblings. A row in another org is the same NOT_FOUND as a missing
 * one — existence never leaks across an org boundary.
 */
export async function requireAgentEditor(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  agentId: Id<"agents">,
): Promise<AgentEditContext> {
  const { identityKey } = await requireOrgMember(ctx, orgId);
  const agent = await requireOrgAgent(ctx, orgId, agentId);
  return { agent, identityKey };
}

/**
 * Patch the agent and hand back the stored record.
 *
 * `fenced` is the caller's answer to "did what the agent SAYS change?" — the
 * only thing that moves `revision`. Passing `false` for an unchanged value is
 * what makes a re-save cost nothing.
 */
export async function patchAgent(
  ctx: MutationCtx,
  agent: Doc<"agents">,
  patch: Partial<Doc<"agents">>,
  fenced: boolean,
): Promise<Doc<"agents">> {
  await ctx.db.patch("agents", agent._id, {
    ...patch,
    ...(fenced ? { revision: agent.revision + 1 } : {}),
    updatedAt: Date.now(),
  });
  const updated = await ctx.db.get("agents", agent._id);
  if (updated === null) {
    throw domainError("NOT_FOUND", "agent not found after update");
  }
  return updated;
}

/**
 * Rename the agent. The name is generated from the ICP at onboarding and is
 * a label only: nothing the model writes reads it, so it fences nothing.
 */
export const rename = mutation({
  args: {
    orgId: v.id("orgs"),
    agentId: v.id("agents"),
    name: v.string(),
  },
  returns: vAgentDoc,
  handler: async (ctx, args) => {
    const { agent } = await requireAgentEditor(
      ctx,
      args.orgId,
      args.agentId,
    );
    const name = boundedString(args.name, "name", {
      min: 1,
      max: AGENT_NAME_MAX_LENGTH,
    });
    return await patchAgent(ctx, agent, { name }, false);
  },
});

/**
 * The agent's own outreach instructions — what the writer is told to say.
 *
 * This is the one field here that PLAN §9.1 fences: a queued draft written
 * under the old wording must not go out, so a real change bumps `revision`
 * and the outreach loop supersedes and rewrites. An empty string clears the
 * override, and the org default from Settings → Outreach applies again.
 */
export const setInstructions = mutation({
  args: {
    orgId: v.id("orgs"),
    agentId: v.id("agents"),
    instructions: v.string(),
  },
  returns: vAgentDoc,
  handler: async (ctx, args) => {
    const { agent } = await requireAgentEditor(
      ctx,
      args.orgId,
      args.agentId,
    );
    const instructions = boundedString(args.instructions, "instructions", {
      max: AGENT_INSTRUCTIONS_MAX_LENGTH,
    });
    const changed = instructions !== (agent.instructions ?? "");
    return await patchAgent(
      ctx,
      agent,
      { instructions: instructions === "" ? undefined : instructions },
      changed,
    );
  },
});

/**
 * The link the agent may offer when someone wants to meet.
 *
 * Checked with the shared fetch policy (`checkPublicHttpUrl`) so an intranet
 * name, an IP literal or a `javascript:` string can never be put in front of a
 * recipient. The STORED value comes from `normalizeHttpUrl` rather than from
 * the safety check's normalisation, because that one drops the query string —
 * and a booking link's query string is usually the booking.
 *
 * `null` clears it.
 */
export const setBookingUrl = mutation({
  args: {
    orgId: v.id("orgs"),
    agentId: v.id("agents"),
    bookingUrl: v.union(v.string(), v.null()),
  },
  returns: vAgentDoc,
  handler: async (ctx, args) => {
    const { agent } = await requireAgentEditor(
      ctx,
      args.orgId,
      args.agentId,
    );
    const raw = args.bookingUrl === null ? "" : args.bookingUrl.trim();
    if (raw === "") {
      return await patchAgent(ctx, agent, { bookingUrl: undefined }, false);
    }
    // A pasted "cal.com/you/30min" is the common case, and https is the only
    // guess that cannot widen the policy.
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const safety = checkPublicHttpUrl(candidate);
    if (!safety.ok) {
      throw invalid(
        `bookingUrl must be a public web address (${safety.reason})`,
      );
    }
    const bookingUrl = normalizeHttpUrl(candidate, "bookingUrl");
    return await patchAgent(ctx, agent, { bookingUrl }, false);
  },
});

/**
 * What one won deal is worth — the multiplier behind the dashboard's pipeline
 * figure. `null` clears it, and the dashboard shows "Set deal size" again
 * rather than a manufactured zero.
 */
export const setDealSize = mutation({
  args: {
    orgId: v.id("orgs"),
    agentId: v.id("agents"),
    dealSize: v.union(v.number(), v.null()),
  },
  returns: vAgentDoc,
  handler: async (ctx, args) => {
    const { agent } = await requireAgentEditor(
      ctx,
      args.orgId,
      args.agentId,
    );
    if (args.dealSize === null) {
      return await patchAgent(ctx, agent, { dealSize: undefined }, false);
    }
    const dealSize = boundedInt(args.dealSize, "dealSize", {
      min: 0,
      max: DEAL_SIZE_MAX,
    });
    return await patchAgent(ctx, agent, { dealSize }, false);
  },
});

/**
 * When follow-ups go out, counted in days after the previous message.
 *
 * Strictly ascending, because each entry is the next step of one ladder and
 * two steps on the same day would be two mails in one morning. An empty list
 * means the agent sends once and stops.
 */
export const setFollowUpDays = mutation({
  args: {
    orgId: v.id("orgs"),
    agentId: v.id("agents"),
    followUpDays: v.array(v.number()),
  },
  returns: vAgentDoc,
  handler: async (ctx, args) => {
    const { agent } = await requireAgentEditor(
      ctx,
      args.orgId,
      args.agentId,
    );
    if (args.followUpDays.length > FOLLOW_UP_STEPS_MAX) {
      throw invalid(`followUpDays allows at most ${FOLLOW_UP_STEPS_MAX} steps`);
    }
    const followUpDays = args.followUpDays.map((day, index) =>
      boundedInt(day, `followUpDays[${index}]`, {
        min: FOLLOW_UP_DAY_MIN,
        max: FOLLOW_UP_DAY_MAX,
      }),
    );
    for (let index = 1; index < followUpDays.length; index += 1) {
      const previous = followUpDays[index - 1] ?? 0;
      const current = followUpDays[index] ?? 0;
      if (current <= previous) {
        throw invalid("followUpDays must increase");
      }
    }
    return await patchAgent(ctx, agent, { followUpDays }, false);
  },
});
