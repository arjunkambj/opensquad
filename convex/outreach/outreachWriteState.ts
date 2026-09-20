/**
 * CLAIM one lead for one outreach write, and read everything the model needs.
 *
 * This is the first of the two transactions a write step is made of;
 * `outreachDraftInstall.ts` is the second, and `outreachWrite.ts` performs the
 * one paid call between them. Splitting them is what makes the step safe under
 * concurrent cron ticks: the claim is a serializable transaction that moves
 * the lead out of every selection range before a single credit is spent, so a
 * second tick reading the same index a millisecond later finds a lead that is
 * no longer due.
 *
 * The order inside it is deliberate: every refusal that costs nothing comes
 * first, the claim comes last, and no read between them can be invalidated by
 * another tick.
 */
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { bucketRemaining, findCreditsBucket } from "../billing/model";
import { getWorkspaceProfile, profileIsComplete } from "../company/model";
import { ACTION_PRICES } from "../lib/limits";
import {
  normalizeEmailAddress,
  vAgentGoal,
  vAgentMode,
  vAgentTone,
} from "../lib/validators";
import { retireConversationDrafts } from "./outreachInvalidation";
import {
  CONVERSATION_SCAN_MAX,
  claimLeadForOutreach,
  draftIsUnsent,
  failOutreachStep,
  followUpDelayMs,
  loadLeadForAgent,
  outreachStepOf,
  releaseLeadClaim,
  restLeadAfterWrite,
} from "./outreachLeadState";
import { agentRunsOutreach } from "./outreachPlan";
import {
  personalisationHooks,
  resolveConversation,
  sentThread,
} from "./outreachThread";
import { matchSuppression } from "./suppressions";
import { v } from "convex/values";

/* ------------------------------------------------------------------ */
/* Claim + context                                                     */
/* ------------------------------------------------------------------ */

const vOutreachWriteContext = v.union(
  /** Not writable right now; the lead has been left in an honest state. */
  v.object({ status: v.literal("skip"), reason: v.string() }),
  v.object({
    status: v.literal("ready"),
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    mode: vAgentMode,
    revision: v.number(),
    /** Failures so far; the attempt about to run is this plus one. */
    attempt: v.number(),
    step: v.number(),
    recipient: v.string(),
    /** Our own last sent message, so a follow-up threads onto it. */
    replyToMessageRef: v.optional(v.string()),
    /** The thread's subject, reused verbatim by every follow-up. */
    threadSubject: v.optional(v.string()),
    evidenceIds: v.array(v.string()),
    seller: v.object({
      companyName: v.string(),
      industry: v.string(),
      description: v.string(),
      keyFeatures: v.array(v.string()),
      socialProof: v.array(v.string()),
      painPoints: v.string(),
    }),
    lead: v.object({
      firstName: v.optional(v.string()),
      jobTitle: v.optional(v.string()),
      companyName: v.optional(v.string()),
      canonicalDomain: v.optional(v.string()),
      location: v.optional(v.string()),
      companyIndustry: v.optional(v.string()),
      employeeCount: v.optional(v.number()),
    }),
    research: v.optional(
      v.object({
        summary: v.string(),
        scoreReason: v.string(),
        hooks: v.array(v.string()),
      }),
    ),
    goal: vAgentGoal,
    tone: vAgentTone,
    instructions: v.optional(v.string()),
    bookingUrl: v.optional(v.string()),
    previousEmails: v.array(
      v.object({ subject: v.string(), body: v.string() }),
    ),
  }),
);

export type OutreachWriteContext = typeof vOutreachWriteContext.type;

/**
 * Claim one lead for one write step and return everything the model needs.
 *
 * The order is deliberate: every refusal that costs nothing comes first, the
 * claim comes last, and no read between them can be invalidated by another
 * tick, because the whole thing is one transaction.
 */
export const beginOutreachWrite = internalMutation({
  args: {
    agentId: v.id("agents"),
    prospectId: v.id("prospects"),
    step: v.number(),
  },
  returns: vOutreachWriteContext,
  handler: async (ctx, args): Promise<OutreachWriteContext> => {
    const skip = (reason: string): OutreachWriteContext => ({
      status: "skip" as const,
      reason,
    });

    const agent = await ctx.db.get("agents", args.agentId);
    if (agent === null) {
      return skip("agent_missing");
    }
    const workspace = await ctx.db.get("workspaces", agent.workspaceId);
    if (workspace === null) {
      return skip("workspace_missing");
    }
    // Pause, the kill switch, a disconnected inbox: nothing new starts.
    if (!agentRunsOutreach(workspace, agent)) {
      return skip("agent_not_running");
    }
    const inboxRef = workspace.inboxRef;
    if (inboxRef === undefined) {
      return skip("inbox_unassigned");
    }

    const lead = await loadLeadForAgent(ctx, agent._id, args.prospectId);
    if (lead === null) {
      return skip("lead_missing");
    }
    const now = Date.now();
    // Another tick claimed this lead, or its retry ladder has not come round.
    if (lead.nextActionAt !== undefined && lead.nextActionAt > now) {
      return skip("not_due");
    }
    if (
      lead.approval !== "approved" ||
      lead.stage === "rejected" ||
      lead.stage === "closed_lost" ||
      lead.stage === "needs_attention" ||
      lead.lastReplyAt !== undefined
    ) {
      return skip("lead_not_writable");
    }
    if (lead.research.status !== "researched") {
      return skip("lead_not_researched");
    }
    if (lead.emailStatus !== "found" || lead.email === undefined) {
      return skip("no_address");
    }
    // The step the ROW says it is on wins over the step the tick selected: a
    // send that landed in between has already moved the ladder.
    const step = outreachStepOf(lead);
    if (step !== args.step) {
      return skip("step_changed");
    }
    if (step > 0 && followUpDelayMs(agent, step) === null) {
      return skip("follow_ups_exhausted");
    }

    let recipient: string;
    try {
      recipient = normalizeEmailAddress(lead.email, "recipient");
    } catch {
      // The stored address is unusable. That is this lead's problem and goes
      // on its ladder, so it parks with a reason instead of being retried
      // every minute forever.
      await failOutreachStep(ctx, lead, "not_found");
      return skip("recipient_invalid");
    }
    // Suppression is checked here so we never PAY to write to an address that
    // can never be mailed; the send gates check it again at the moment of
    // effect, which is the authority.
    if ((await matchSuppression(ctx, workspace._id, recipient)) !== null) {
      await restLeadAfterWrite(ctx, lead);
      return skip("suppressed");
    }

    // One email is one credit. Checked before the claim so an empty balance
    // costs one read a minute rather than a claim, a refused paid call and a
    // release every time round.
    const credits = await findCreditsBucket(ctx, workspace._id);
    if (
      credits === null ||
      bucketRemaining(credits) < ACTION_PRICES.write_email.credits
    ) {
      return skip("out_of_credits");
    }

    const profile = await getWorkspaceProfile(ctx, workspace._id);
    if (!profileIsComplete(profile)) {
      // Nothing true to say yet. Not this lead's fault, so no attempt is
      // burned — it comes back due and waits for the profile.
      await releaseLeadClaim(ctx, lead);
      return skip("profile_incomplete");
    }

    const conversation = await resolveConversation(ctx, {
      workspace,
      agent,
      lead,
      inboxRef,
      step,
    });
    if (conversation === null) {
      return skip(step === 0 ? "conversation_unavailable" : "no_thread");
    }
    // What this thread has PENDING, which is not the same as what it has
    // open: a draft stays `current` after it is sent, so the first mail of a
    // thread would otherwise look like a message already waiting and block
    // every follow-up. Only unsent mail counts.
    const open = await ctx.db
      .query("drafts")
      .withIndex("by_conversationId_and_state", (q) =>
        q.eq("conversationId", conversation._id).eq("state", "current"),
      )
      .take(CONVERSATION_SCAN_MAX);
    const pending: Doc<"drafts">[] = [];
    for (const draft of open) {
      if (await draftIsUnsent(ctx, draft._id)) {
        pending.push(draft);
      }
    }
    // A pending draft at the CURRENT revision is already the message for this
    // step: in Review it is waiting for a person, in Autopilot for the
    // ledger. Writing a second one would spend a credit to say the same
    // thing. One under an OLDER revision is retired here and rewritten,
    // which is PLAN §9.1's "superseded and rewritten on the next pass".
    if (pending.some((draft) => draft.agentRevision === agent.revision)) {
      await restLeadAfterWrite(ctx, lead);
      return skip("draft_pending");
    }
    if (pending.length > 0) {
      await retireConversationDrafts(
        ctx,
        conversation,
        `the agent's instructions moved to revision ${agent.revision} after this draft was written`,
      );
    }

    const thread = await sentThread(ctx, conversation);
    if (step > 0 && thread.messages.length === 0) {
      // A follow-up with nothing to follow up on: the ladder believes a mail
      // was accepted, but this thread holds none. Refuse rather than start a
      // second first-touch under a follow-up's wording.
      await restLeadAfterWrite(ctx, lead);
      return skip("no_sent_message");
    }

    const hooks = await personalisationHooks(ctx, lead);
    const location = [
      lead.location?.city,
      lead.location?.state,
      lead.location?.country,
    ]
      .filter((part): part is string => part !== undefined)
      .join(", ");
    const instructions = agent.instructions ?? workspace.defaultInstructions;

    await claimLeadForOutreach(ctx, lead, step);
    return {
      status: "ready" as const,
      workspaceId: workspace._id,
      conversationId: conversation._id,
      mode: agent.mode,
      revision: agent.revision,
      attempt: lead.lastError?.attempts ?? 0,
      step,
      recipient,
      ...(step > 0 && thread.lastMessageRef !== undefined
        ? { replyToMessageRef: thread.lastMessageRef }
        : {}),
      ...(step > 0 && thread.subject !== undefined
        ? { threadSubject: thread.subject }
        : {}),
      evidenceIds: hooks.evidenceIds,
      seller: {
        companyName: profile.companyName,
        industry: profile.industry,
        description: profile.description,
        keyFeatures: profile.keyFeatures,
        socialProof: profile.socialProof,
        painPoints: profile.painPoints,
      },
      lead: {
        ...(lead.firstName !== undefined ? { firstName: lead.firstName } : {}),
        ...(lead.jobTitle !== undefined ? { jobTitle: lead.jobTitle } : {}),
        ...(lead.companyName !== undefined
          ? { companyName: lead.companyName }
          : {}),
        ...(lead.canonicalDomain !== undefined
          ? { canonicalDomain: lead.canonicalDomain }
          : {}),
        ...(location !== "" ? { location } : {}),
        ...(lead.company?.industry !== undefined
          ? { companyIndustry: lead.company.industry }
          : {}),
        ...(lead.company?.employeeCount !== undefined
          ? { employeeCount: lead.company.employeeCount }
          : {}),
      },
      research: {
        summary: lead.research.summary,
        scoreReason: lead.research.aiScoreReason,
        hooks: hooks.observations,
      },
      goal: agent.goal,
      tone: agent.tone,
      ...(instructions !== undefined && instructions.trim() !== ""
        ? { instructions }
        : {}),
      ...(agent.bookingUrl !== undefined ? { bookingUrl: agent.bookingUrl } : {}),
      previousEmails: thread.messages,
    };
  },
});

