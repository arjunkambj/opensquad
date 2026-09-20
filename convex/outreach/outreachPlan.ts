/**
 * What the outreach loop does NEXT — the selection half of PLAN §9.1's
 * "steps, not loops", and the mode matrix of PLAN §9.3 expressed as who is
 * eligible for which step.
 *
 * Nothing here writes, spends or schedules. Every read is a bounded index
 * range, because this runs on every tick for every live agent. The reveal
 * step's own selection lives beside the step that performs it, in
 * `outreachReveal.ts`.
 *
 * The matrix, as the loop applies it:
 *
 * | mode          | lead approval | email reveal        | write + send |
 * |---------------|---------------|---------------------|--------------|
 * | sourcing_only | manual        | manual button only  | never        |
 * | review        | manual        | automatic once approved | draft, wait |
 * | autopilot     | automatic     | automatic, capped   | draft, send  |
 * | paused        | —             | —                   | never        |
 *
 * `sourcing_only` and `paused` never reach this file: `agentRunsOutreach`
 * refuses them at the top of the tick, so nothing is selected, nothing is
 * claimed and nothing is paid for.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { paidCallsPaused } from "../billing/platformBudgets";
import { SENDING_AGENT_MODES } from "../lib/validators";
import {
  CONVERSATION_SCAN_MAX,
  draftIsUnsent,
  followUpDelayMs,
  outreachStepOf,
} from "./outreachLeadState";

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/*                                                                     */
/* These belong in `convex/lib/limits.ts` with the rest of the policy  */
/* numbers; they are local constants only because that file is         */
/* integrator-only (EXECUTION §0).                                     */
/* ------------------------------------------------------------------ */

/** Leads one selection pass reads per index range. */
const CANDIDATE_SCAN_MAX = 100;

/**
 * Leads the stale-revision pass reads per stage. Smaller than the others on
 * purpose: this is the one scan that costs a read PER LEAD (its threads and
 * their current draft), and it runs every minute whether or not anything has
 * changed. An exact index on the drafts side would make it free — see the
 * hand-off note.
 */
const STALE_STAGE_SCAN = 25;

/* ------------------------------------------------------------------ */
/* Does this agent run outreach at all?                                */
/* ------------------------------------------------------------------ */

/**
 * The liveness gate, re-read on every tick: a paused agent, a paused
 * org, a disconnected inbox and the platform kill switch all mean
 * NOTHING NEW STARTS (PLAN §9.1). Work already in flight finishes and writes
 * its result; unsent drafts stay drafts.
 *
 * The inbox check is here as well as in the send gates because an org
 * that cannot send has no business paying to write.
 */
export function agentRunsOutreach(
  org: Doc<"orgs">,
  agent: Doc<"agents">,
): boolean {
  return (
    agent.status === "live" &&
    SENDING_AGENT_MODES.includes(agent.mode) &&
    org.automationState === "active" &&
    org.inboxConnection === "connected" &&
    org.inboxRef !== undefined &&
    !paidCallsPaused()
  );
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

export type WriteTarget = {
  prospectId: Id<"prospects">;
  /** 0 = first touch, 1 and up = that follow-up. */
  step: number;
};

/**
 * The leads due for a message, from the two ranges that can hold one.
 *
 * FIRST TOUCH comes from the approval index: researched, approved, address
 * found, never contacted, nothing scheduled. A lead claimed for writing moves
 * to `queued` with a watchdog time, so it leaves this range until the claim
 * either finishes or expires.
 *
 * FOLLOW-UPS and RETRIES come from the due index: `stage` + `nextActionAt` is
 * the whole state machine (PLAN §7), so a follow-up that has come round, a
 * claim whose action died and a step waiting out its retry ladder all arrive
 * here the same way.
 *
 * A lead that has REPLIED is in neither: `lastReplyAt` excludes it, and the
 * reply also cleared its due time. The send mutation re-checks the same fact
 * at the moment of effect, which is the authority (PLAN §9.1).
 */
export async function selectWriteTargets(
  ctx: QueryCtx,
  agent: Doc<"agents">,
  limit: number,
): Promise<WriteTarget[]> {
  if (limit <= 0) {
    return [];
  }
  const now = Date.now();
  const targets: WriteTarget[] = [];
  const seen = new Set<string>();

  const push = (lead: Doc<"prospects">): void => {
    if (targets.length >= limit || seen.has(lead._id)) {
      return;
    }
    const step = outreachStepOf(lead);
    if (step > 0 && followUpDelayMs(agent, step) === null) {
      // The ladder is spent: this lead has had every follow-up the agent is
      // configured to send, and it rests.
      return;
    }
    seen.add(lead._id);
    targets.push({ prospectId: lead._id, step });
  };

  const due = await ctx.db
    .query("prospects")
    .withIndex("by_orgId_and_nextActionAt", (q) =>
      q
        .eq("orgId", agent.orgId)
        .gte("nextActionAt", 0)
        .lte("nextActionAt", now),
    )
    .order("asc")
    .take(CANDIDATE_SCAN_MAX);
  for (const lead of due) {
    if (writable(lead, agent)) {
      push(lead);
    }
  }

  if (targets.length < limit) {
    const approved = await ctx.db
      .query("prospects")
      .withIndex("by_orgId_and_approval", (q) =>
        q.eq("orgId", agent.orgId).eq("approval", "approved"),
      )
      .order("desc")
      .take(CANDIDATE_SCAN_MAX);
    for (const lead of approved) {
      if (
        lead.nextActionAt === undefined &&
        lead.stage === "researched" &&
        writable(lead, agent)
      ) {
        push(lead);
      }
    }
  }
  return targets;
}

/**
 * The facts every message needs, whichever range the lead came from: the user
 * said yes, we have an address we paid for, research has something to say,
 * and the lead is still inside the part of the pipeline outreach owns.
 *
 * `queued` is in the list because that is where a claimed lead sits: a write
 * whose action died comes back due in `queued` and must be re-drivable.
 * Suppression is NOT checked here — it is a per-address read the claim does
 * once on the lead it is about to spend on, and the send gates check it again.
 */
function writable(lead: Doc<"prospects">, agent: Doc<"agents">): boolean {
  return (
    lead.agentId === agent._id &&
    lead.approval === "approved" &&
    lead.research.status === "researched" &&
    lead.emailStatus === "found" &&
    lead.email !== undefined &&
    lead.lastReplyAt === undefined &&
    (lead.stage === "researched" ||
      lead.stage === "queued" ||
      lead.stage === "contacted")
  );
}

/**
 * Leads whose queued mail was written under a superseded revision.
 *
 * PLAN §9.1: changing instructions, tone, goal, ICP or mode bumps
 * `agents.revision`, and everything queued under the old one is no longer
 * what the agent would say. The send gates already refuse such a draft
 * (`agent_revision_changed`); this range is how it gets REWRITTEN rather than
 * sitting there refused — the tick supersedes the stale revision and makes
 * the lead due again.
 *
 * Two stages can hold one: `queued` is a first touch waiting to be approved
 * or sent, and `contacted` is a follow-up waiting the same way. Both are
 * scanned, both bounded, and a revision of 1 is skipped outright because
 * nothing can predate the first one.
 */
export async function selectStaleRevisionLeads(
  ctx: QueryCtx,
  agent: Doc<"agents">,
  limit: number,
): Promise<Id<"prospects">[]> {
  if (limit <= 0 || agent.revision <= 1) {
    return [];
  }
  const stale: Id<"prospects">[] = [];
  for (const stage of ["queued", "contacted"] as const) {
    if (stale.length >= limit) {
      break;
    }
    const leads = await ctx.db
      .query("prospects")
      .withIndex("by_agentId_and_stage", (q) =>
        q.eq("agentId", agent._id).eq("stage", stage),
      )
      .take(STALE_STAGE_SCAN);
    for (const lead of leads) {
      if (stale.length >= limit) {
        break;
      }
      if (lead.approval !== "approved" || lead.lastReplyAt !== undefined) {
        continue;
      }
      if (await holdsStaleDraft(ctx, lead._id, agent.revision)) {
        stale.push(lead._id);
      }
    }
  }
  return stale;
}

/**
 * Does any of this lead's threads still hold UNSENT mail written under a
 * revision the agent has moved past?
 *
 * "Unsent" is the load-bearing word. A draft stays `current` after it is
 * sent, so a lead contacted under revision 1 would otherwise look stale
 * forever and be dragged into an immediate rewrite — jumping the follow-up
 * delay it is patiently waiting out. Sent mail is untouched (PLAN §9.1).
 */
async function holdsStaleDraft(
  ctx: QueryCtx,
  prospectId: Id<"prospects">,
  revision: number,
): Promise<boolean> {
  const conversations = await ctx.db
    .query("conversations")
    .withIndex("by_prospectId", (q) => q.eq("prospectId", prospectId))
    .take(CONVERSATION_SCAN_MAX);
  for (const conversation of conversations) {
    if (conversation.currentDraftId === undefined) {
      continue;
    }
    const draft = await ctx.db.get("drafts", conversation.currentDraftId);
    if (
      draft !== null &&
      draft.state === "current" &&
      draft.agentRevision !== revision &&
      (await draftIsUnsent(ctx, draft._id))
    ) {
      return true;
    }
  }
  return false;
}
