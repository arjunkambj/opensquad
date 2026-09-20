/**
 * The mode switch, and the only door Autopilot is ever turned on through
 * (PLAN §9.3 "Approval and Autopilot").
 *
 * Four modes, one mutation, three invariants:
 *
 *   NOTHING ELSE ENTERS AUTOPILOT. This is the only code in the backend that
 *   writes `agents.mode` after creation and the only code that writes
 *   `agents.autopilot`. A migration, a key reconnect, a recovery sweep or a
 *   run step cannot turn it on, because none of them can reach this mutation.
 *
 *   CONSENT IS EXPLICIT AND CURRENT. Switching TO Autopilot requires the
 *   consent payload the dialog collects, carrying the `revision` the dialog
 *   showed the caps under. A revision that has moved since means the user
 *   consented to a different agent, and the switch is refused rather than
 *   quietly applied. Leaving Autopilot clears the authorisation, so coming
 *   back always asks again.
 *
 *   A MODE THAT SENDS NEEDS AN INBOX. Review and Autopilot both put mail on
 *   the wire, so both are refused while the org has no connected inbox
 *   — before the mode is stored, not at the first send.
 *
 * Refusals the user can act on are RETURNED as a typed reason rather than
 * thrown: "connect your inbox first" is a state of the screen, not an error
 * in it. Guard and validation failures are still `ConvexError`s.
 */
import { mutation } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import {
  domainError,
  SENDING_AGENT_MODES,
  vAgentMode,
} from "../lib/validators";
import type { AgentAutopilot } from "../lib/validators";
import { requireOrgAgent, vAgentDoc } from "./model";
import { patchAgent } from "./settings";
import { v } from "convex/values";

/**
 * Why a mode change was refused. Every member is something the user can fix
 * on the screen they are looking at.
 */
const vModeRefusal = v.union(
  /** Review and Autopilot send; this org has no inbox to send from. */
  v.literal("inbox_not_connected"),
  /** Autopilot was asked for without the consent the dialog collects. */
  v.literal("consent_required"),
  /** The agent changed while the dialog was open, so the consent is stale. */
  v.literal("consent_stale"),
);

/**
 * Switch the agent's mode (PLAN §9.3 matrix).
 *
 * The mode is part of what the agent is allowed to do on its own, so a real
 * change bumps `revision` (PLAN §9.1) and supersedes drafts queued under the
 * previous one. Re-selecting the current mode changes nothing at all.
 *
 * `autopilotConsent.revision` is the revision the dialog quoted the caps
 * under. The authorisation is recorded against the revision the agent ends up
 * on, because that is the state Autopilot will actually run in; a later
 * instruction change then leaves `autopilot.revision` behind
 * `agents.revision`, which is exactly PLAN §9.3's "recorded, not silently
 * re-authorised".
 */
export const setMode = mutation({
  args: {
    orgId: v.id("orgs"),
    agentId: v.id("agents"),
    mode: vAgentMode,
    autopilotConsent: v.optional(
      v.object({
        /** The agent revision the consent dialog displayed. */
        revision: v.number(),
        /** The dialog's Accept, and nothing else, sets this. */
        accepted: v.literal(true),
      }),
    ),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), agent: vAgentDoc }),
    v.object({ ok: v.literal(false), reason: vModeRefusal }),
  ),
  handler: async (ctx, args) => {
    const { identityKey, org } = await requireOrgMember(
      ctx,
      args.orgId,
    );
    const agent = await requireOrgAgent(
      ctx,
      args.orgId,
      args.agentId,
    );

    if (
      SENDING_AGENT_MODES.includes(args.mode) &&
      org.inboxConnection !== "connected"
    ) {
      return { ok: false as const, reason: "inbox_not_connected" as const };
    }

    if (args.mode === "autopilot") {
      if (args.autopilotConsent === undefined) {
        return { ok: false as const, reason: "consent_required" as const };
      }
      if (args.autopilotConsent.revision !== agent.revision) {
        return { ok: false as const, reason: "consent_stale" as const };
      }
    }

    const changed = agent.mode !== args.mode;
    if (!changed) {
      return { ok: true as const, agent };
    }

    // The revision this change lands on: `patchAgent` bumps it, so the
    // authorisation is stamped with the value the agent will hold.
    const revision = agent.revision + 1;
    const autopilot: AgentAutopilot | undefined =
      args.mode === "autopilot"
        ? { authorizedBy: identityKey, authorizedAt: Date.now(), revision }
        : undefined;

    const updated = await patchAgent(
      ctx,
      agent,
      { mode: args.mode, autopilot },
      true,
    );
    if (updated.revision !== revision) {
      // Unreachable: `patchAgent` bumps by exactly one. Asserted because a
      // stamp that disagrees with the record would make the authorisation
      // look stale the moment it was written.
      throw domainError("CONFLICT", "agent revision moved during the switch");
    }
    return { ok: true as const, agent: updated };
  },
});
