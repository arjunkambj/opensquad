/**
 * Public demo surface (P16) — the sanitized read-only tour and the opt-in
 * isolated execution workspace.
 *
 * Everything here is gated by deployment env flags that are OFF by default:
 *
 *   OPENSQUAD_DEMO_TOUR       "1"/"true" — `demo.tour` returns the curated,
 *                           sanitized read model. Absent ⇒ `{enabled:false}`;
 *                           the query never reads workspace tables.
 *   OPENSQUAD_DEMO_EXECUTION  "1"/"true" — `demo.optIn` provisions the
 *                           caller's isolated `demoMode` workspace. Absent ⇒
 *                           FORBIDDEN; nothing outside this module can set
 *                           `demoMode` (schema comment on `workspaces`).
 *
 * Abuse limits are NOT re-implemented here: `workspaces.demoMode` rows route
 * through the existing send boundary in `convex/sending.ts`, which already
 * applies `OPENSQUAD_DEMO_ALLOWED_RECIPIENTS` (normalized allowlist; absent ⇒
 * demo sending disabled) and `OPENSQUAD_DEMO_MAX_DAILY_SENDS` (deployment cap
 * AND-ed with the workspace limit). Demo workspaces additionally get small
 * owner-visible quotas at creation (`dailySendLimit`, `modelRunDailyLimit`).
 *
 * Model work runs on the DEPLOYMENT's account, so a demo workspace keeps the
 * smallest quotas in the product and starts paused. A funded/shared demo
 * allowance is a separate product decision and is intentionally NOT built
 * here.
 */
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  expectedUsersIssuer,
  getUserIdentity,
  requireUser,
} from "./lib/auth";
import type { AuthCtx } from "./lib/auth";
import { assertIanaTimezone, domainError } from "./lib/validators";

function flagEnabled(name: "OPENSQUAD_DEMO_TOUR" | "OPENSQUAD_DEMO_EXECUTION") {
  const value = process.env[name];
  return value === "1" || value === "true";
}

/* ------------------------------------------------------------------ */
/* Read-only public tour                                               */
/* ------------------------------------------------------------------ */

/**
 * One sanitized step of the public tour. The shapes mirror the real read
 * models (lead card, approval card, meeting record) so the tour never needs
 * workspace access — every value below is prepared content and is labeled as
 * such for V20's "prepared data is visibly labeled" rule.
 */
const TOUR_STEPS = [
  {
    stage: "leads",
    route: "/leads",
    title: "The Leads CRM is home",
    body:
      "Every discovered company lands here with an owner, a sales stage, " +
      "its evidence and a dated next action. A campaign accepts at most " +
      "five prospects.",
    artifact: {
      kind: "lead_card",
      company: "northwind-studios.example.test",
      stage: "qualified",
      owner: "you",
      nextAction: "Approve Scout's research brief",
      dueIn: "today",
    },
  },
  {
    stage: "research",
    route: "/overview",
    title: "Research is source-backed",
    body:
      "The Researcher only reports what a retrieved page supports. Every " +
      "observation carries its source URL, retrieval time and confidence; " +
      "missing content stays explicitly unknown.",
    artifact: {
      kind: "evidence_card",
      sourceUrl: "https://northwind-studios.example.test/about",
      retrievedAt: "prepared",
      observation:
        "Site lists brand-identity work but no case-study page — " +
        "supporting observation, not proof of a gap.",
      confidence: "medium",
    },
  },
  {
    stage: "approval",
    route: "/inbox",
    title: "A human approves every word",
    body:
      "Outreach proposes an exact draft — recipient, subject, body and the " +
      "evidence behind it. Editing any of it invalidates the old approval. " +
      "Nothing sends itself.",
    artifact: {
      kind: "approval_card",
      recipient: "hello@northwind-studios.example.test",
      subject: "A case-study page for Northwind's brand work",
      decision: "exact_draft",
      state: "waiting_on_you",
    },
  },
  {
    stage: "reply",
    route: "/inbox",
    title: "Replies land in the shared inbox",
    body:
      "A verified inbound reply pauses automation, appears in the same " +
      "conversation and produces an unsent proposed response — never an " +
      "automatic send.",
    artifact: {
      kind: "conversation_card",
      from: "hello@northwind-studios.example.test",
      disposition: "interested",
      automation: "human_review",
    },
  },
  {
    stage: "booking",
    route: "/leads",
    title: "A person records the real meeting",
    body:
      "The squad proposes a booking link or up to three timezone-explicit " +
      "slots through an approved email. The agreed time is confirmed by an " +
      "authorized human — a link click never books anything, and no " +
      "calendar is synchronized.",
    artifact: {
      kind: "booking_card",
      state: "proposed",
      slots: "3",
      timezone: "America/New_York",
      confirmedBy: "human_only",
    },
  },
] as const;

/**
 * Public, unauthenticated sanitized tour. When `OPENSQUAD_DEMO_TOUR` is not
 * set the response carries `enabled:false` and NO tour content — the flag
 * state itself is all a disabled deployment reveals.
 */
export const tour = query({
  args: {},
  returns: v.union(
    v.object({ enabled: v.literal(false) }),
    v.object({
      enabled: v.literal(true),
      /** Always true — tour content is prepared, sanitized and labeled. */
      preparedData: v.literal(true),
      steps: v.array(
        v.object({
          stage: v.string(),
          route: v.string(),
          title: v.string(),
          body: v.string(),
          artifact: v.record(v.string(), v.string()),
        }),
      ),
      limits: v.object({
        leadsPerCampaign: v.number(),
        oneInboxPerWorkspace: v.boolean(),
        humanRecordedMeetings: v.boolean(),
        calendarSync: v.boolean(),
      }),
    }),
  ),
  handler: async () => {
    if (!flagEnabled("OPENSQUAD_DEMO_TOUR")) {
      return { enabled: false } as const;
    }
    return {
      enabled: true,
      preparedData: true,
      // Record<string,string> projection: every artifact field is a bounded
      // display string — no ids, addresses beyond *.example.test, or
      // timestamps from real records.
      steps: TOUR_STEPS.map((step) => ({
        stage: step.stage,
        route: step.route,
        title: step.title,
        body: step.body,
        artifact: { ...step.artifact },
      })),
      limits: {
        leadsPerCampaign: 5,
        oneInboxPerWorkspace: true,
        humanRecordedMeetings: true,
        calendarSync: false,
      },
    } as const;
  },
});

/* ------------------------------------------------------------------ */
/* Opt-in isolated execution                                           */
/* ------------------------------------------------------------------ */

/** Demo workspaces get deliberately small quotas; the deployment-level
 *  `OPENSQUAD_DEMO_MAX_DAILY_SENDS` cap and the
 *  `OPENSQUAD_DEMO_ALLOWED_RECIPIENTS` allowlist still apply on top via the
 *  send boundary in `convex/sending.ts`. */
const DEMO_DAILY_SEND_LIMIT = 2;
const DEMO_MODEL_RUN_DAILY_LIMIT = 3;

async function findOwnedWorkspaces(
  ctx: AuthCtx,
  identityKey: string,
): Promise<Doc<"workspaces">[]> {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_identityKey_and_status", (q) =>
      q.eq("identityKey", identityKey).eq("status", "active"),
    )
    .collect();
  const owned = memberships.filter((entry) => entry.role === "owner");
  const workspaces: Doc<"workspaces">[] = [];
  for (const membership of owned) {
    const workspace = await ctx.db.get("workspaces", membership.workspaceId);
    if (workspace !== null) {
      workspaces.push(workspace);
    }
  }
  return workspaces;
}

/**
 * Public read of the caller's demo posture for the tour page: whether the
 * flags are on and which isolated demo workspace (if any) they own. Signed-
 * out callers get `demoWorkspaceId:null`; a demo workspace id is not a
 * secret — it grants nothing without an active membership.
 */
export const executionStatus = query({
  args: {},
  returns: v.object({
    tourEnabled: v.boolean(),
    executionEnabled: v.boolean(),
    demoWorkspaceId: v.union(v.id("workspaces"), v.null()),
  }),
  handler: async (ctx) => {
    const base = {
      tourEnabled: flagEnabled("OPENSQUAD_DEMO_TOUR"),
      executionEnabled: flagEnabled("OPENSQUAD_DEMO_EXECUTION"),
      demoWorkspaceId: null as Id<"workspaces"> | null,
    };
    const identity = await getUserIdentity(ctx);
    if (identity === null || identity.issuer !== expectedUsersIssuer()) {
      return base;
    }
    const owned = await findOwnedWorkspaces(ctx, identity.tokenIdentifier);
    const demo = owned.find((workspace) => workspace.demoMode);
    return { ...base, demoWorkspaceId: demo?._id ?? null };
  },
});

/**
 * Opt-in isolated execution: create the caller's own `demoMode` workspace.
 *
 * Isolation rules (enforced here, not in UI):
 *  - flag off ⇒ FORBIDDEN — the mutation does not exist as far as a disabled
 *    deployment is concerned;
 *  - one demo workspace per identity — repeat calls return the same row;
 *  - an identity that already owns a NON-demo workspace is refused — the
 *    demo must never blur into a real workspace's quotas or data;
 *  - `demoMode` can only be set by this bootstrap (and is never unset).
 *
 * The workspace starts paused with the smallest quotas in the product. The
 * opt-in demos the pipeline shell and approval UX; a funded demo allowance is
 * a separate decision (see the module header).
 */
export const optIn = mutation({
  args: {
    timezone: v.optional(v.string()),
  },
  returns: v.object({
    workspaceId: v.id("workspaces"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (!flagEnabled("OPENSQUAD_DEMO_EXECUTION")) {
      throw domainError(
        "FORBIDDEN",
        "isolated demo execution is not enabled on this deployment",
      );
    }
    const { identityKey } = await requireUser(ctx);
    const owned = await findOwnedWorkspaces(ctx, identityKey);
    const existingDemo = owned.find((workspace) => workspace.demoMode);
    if (existingDemo !== undefined) {
      return { workspaceId: existingDemo._id, created: false };
    }
    if (owned.length > 0) {
      throw domainError(
        "FORBIDDEN",
        "this account already owns a workspace — demo execution is only for new visitors",
      );
    }

    const now = Date.now();
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Demo workspace",
      ownerIdentityKey: identityKey,
      timezone:
        args.timezone !== undefined
          ? assertIanaTimezone(args.timezone)
          : "UTC",
      automationState: "paused",
      pauseReason: "demo_setup_pending",
      policyVersion: 1,
      dailySendLimit: DEMO_DAILY_SEND_LIMIT,
      sendWindow: {
        weekdays: [1, 2, 3, 4, 5],
        startMinute: 9 * 60,
        endMinute: 17 * 60,
      },
      demoMode: true,
      modelRunDailyLimit: DEMO_MODEL_RUN_DAILY_LIMIT,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("memberships", {
      workspaceId,
      identityKey,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    return { workspaceId, created: true };
  },
});
