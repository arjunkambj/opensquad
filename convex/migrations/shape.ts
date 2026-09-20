/**
 * The two shape migrations of the clean-slate cutover — MIGRATION.md §6.4.
 *
 * `workspaces` is brought to the PLAN §7 shape (plan, fresh webhook token,
 * inbox reset to not-connected, opens not observed); `memberships` and
 * `suppressions` only have removed pre-pivot fields stripped. All three run
 * through `@convex-dev/migrations`, so each is batched, cursor-resumable,
 * re-runnable and supports the component's `dryRun`.
 *
 * Why `db.replace` and not `db.patch`: the job is to REMOVE fields, and the
 * fields being removed no longer exist in the generated document type, so
 * there is no typed way to patch them to `undefined`. `replace` writes the
 * document as exactly the final shape and drops everything else, which is
 * precisely the requirement — and it is what makes each step idempotent,
 * since a second run writes the same value over the same document.
 *
 * Why the documents are read through `unknown`: these run against a
 * deployment whose schema validation is OFF (see the runbook in
 * `plan/migration-log.md`). The stored document is still the PRE-PIVOT one —
 * it carries fields the final schema removed and lacks fields the final
 * schema requires — so the generated `Doc` type is a claim about the target
 * shape, not a description of what is in front of us. Every field is
 * therefore read defensively, and a document that cannot be brought to the
 * final shape fails loudly, naming its id, rather than being written half
 * migrated.
 */
import { Migrations } from "@convex-dev/migrations";
import type { WithoutSystemFields } from "convex/server";
import { components } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { invalid, WEBHOOK_TOKEN_LENGTH } from "../lib/validators";

export const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
});

/**
 * Runs any migration in this file by name, for the cutover runbook:
 * `npx convex run migrations/shape:run '{"fn":"migrations/shape:workspacesToFinalShape"}'`.
 * Each migration is also runnable directly by its own name.
 */
export const run = migrations.runner();

/* ------------------------------------------------------------------ */
/* Reading a pre-pivot document                                        */
/* ------------------------------------------------------------------ */

type RawDoc = Readonly<Record<string, unknown>>;

/** See the module comment: the stored shape is not the declared shape. */
function raw(doc: object): RawDoc {
  return doc as RawDoc;
}

function readString(row: RawDoc, field: string): string | undefined {
  const value = row[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(row: RawDoc, field: string): number | undefined {
  const value = row[field];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readPositiveInt(row: RawDoc, field: string): number | undefined {
  const value = readNumber(row, field);
  return value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function requireString(row: RawDoc, field: string, label: string): string {
  const value = readString(row, field);
  if (value === undefined) {
    throw invalid(`${label} has no ${field}`);
  }
  return value;
}

/**
 * An exhaustive membership test for a stored union value. The `Record` key
 * type is what makes it exhaustive: adding a member to the schema union turns
 * a missing key here into a compile error, so a new role or reason can never
 * be silently rejected as invalid by a migration.
 */
function memberOf<T extends string>(
  members: Record<T, true>,
  value: unknown,
): value is T {
  return typeof value === "string" && Object.hasOwn(members, value);
}

function requireWorkspaceRef(
  ctx: MutationCtx,
  row: RawDoc,
  label: string,
): Id<"workspaces"> {
  const value = readString(row, "workspaceId");
  const workspaceId =
    value === undefined ? null : ctx.db.normalizeId("workspaces", value);
  if (workspaceId === null) {
    throw invalid(`${label} has no usable workspaceId`);
  }
  return workspaceId;
}

/* ------------------------------------------------------------------ */
/* workspaces → final shape                                            */
/* ------------------------------------------------------------------ */

/**
 * The token in this workspace's inbound webhook path. This is the same
 * construction workspace creation uses (`generateWebhookToken` in
 * `convex/workspaces.ts`): `WEBHOOK_TOKEN_LENGTH` bytes from the runtime
 * CSPRNG, lower-case hex, never derived from anything a caller can see. That
 * function is module-private, so the shared length constant is imported and
 * the construction repeated; see the T06 hand-off note.
 */
function generateWebhookToken(): string {
  const bytes = new Uint8Array(WEBHOOK_TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const WEBHOOK_TOKEN_PATTERN = new RegExp(
  `^[0-9a-f]{${WEBHOOK_TOKEN_LENGTH * 2}}$`,
);

/** The same defaults `workspaces.ensureWorkspace` gives a new workspace. */
const DEFAULT_DAILY_SEND_LIMIT = 10;
const DEFAULT_POLICY_VERSION = 1;
const DEFAULT_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];
const DEFAULT_START_MINUTE = 9 * 60;
const DEFAULT_END_MINUTE = 17 * 60;

type SendWindow = Doc<"workspaces">["sendWindow"];

function defaultSendWindow(): SendWindow {
  return {
    weekdays: [...DEFAULT_WEEKDAYS],
    startMinute: DEFAULT_START_MINUTE,
    endMinute: DEFAULT_END_MINUTE,
  };
}

function isWeekday(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 6
  );
}

/** The stored send window if it is structurally usable, else the default. */
function readSendWindow(row: RawDoc): SendWindow {
  const stored = row["sendWindow"];
  if (typeof stored !== "object" || stored === null) {
    return defaultSendWindow();
  }
  const window = raw(stored);
  const storedWeekdays: unknown = window["weekdays"];
  if (!Array.isArray(storedWeekdays)) {
    return defaultSendWindow();
  }
  const weekdays = (storedWeekdays as unknown[]).filter(isWeekday);
  const startMinute = readNumber(window, "startMinute");
  const endMinute = readNumber(window, "endMinute");
  if (
    weekdays.length === 0 ||
    weekdays.length !== storedWeekdays.length ||
    startMinute === undefined ||
    endMinute === undefined ||
    startMinute < 0 ||
    endMinute > 1439 ||
    startMinute >= endMinute
  ) {
    return defaultSendWindow();
  }
  return { weekdays, startMinute, endMinute };
}

/**
 * The kept workspace, as PLAN §7 declares it.
 *
 * Preserved: `name`, `ownerIdentityKey`, `timezone`, `createdAt`,
 * `updatedAt`, and the send policy where the stored value is structurally
 * valid — the owner must still be able to sign in and find their workspace.
 * `updatedAt` is preserved rather than stamped so a second run produces an
 * identical document.
 *
 * Reset: `plan`; `automationState` / `pauseReason`, because every owner lands
 * back in onboarding with an empty workspace (§6.7) and nothing may send
 * before they say so; `inboxConnection` and every inbox field — neither
 * deployment holds a platform mail key any more, so `legacy_platform_inbox`
 * would be a claim we cannot honour; `opensObserved`; and a freshly generated
 * `webhookToken`, kept only if a valid one is already stored so that a
 * re-run does not rotate the route out from under a connected inbox.
 *
 * Removed: every pre-pivot field, by writing the document rather than
 * patching it.
 *
 * `onboardingStep` is not reset here although §6.4 names it: in the final
 * schema it lives on `agents`, which the clear step empties outright.
 */
function finalWorkspace(
  doc: Doc<"workspaces">,
): WithoutSystemFields<Doc<"workspaces">> {
  const row = raw(doc);
  const label = `workspace ${doc._id}`;
  // Without an owner identity key nobody can ever sign in to this workspace.
  // Fail the batch and name the document rather than write it.
  const ownerIdentityKey = requireString(row, "ownerIdentityKey", label);
  const existingToken = readString(row, "webhookToken");
  const createdAt = readNumber(row, "createdAt") ?? doc._creationTime;

  return {
    name: readString(row, "name") ?? "My workspace",
    ownerIdentityKey,
    timezone: readString(row, "timezone") ?? "UTC",
    plan: "trial",
    automationState: "paused",
    pauseReason: "onboarding_pending",
    policyVersion:
      readPositiveInt(row, "policyVersion") ?? DEFAULT_POLICY_VERSION,
    dailySendLimit:
      readPositiveInt(row, "dailySendLimit") ?? DEFAULT_DAILY_SEND_LIMIT,
    sendWindow: readSendWindow(row),
    inboxConnection: "none",
    webhookToken:
      existingToken !== undefined && WEBHOOK_TOKEN_PATTERN.test(existingToken)
        ? existingToken
        : generateWebhookToken(),
    opensObserved: false,
    createdAt,
    updatedAt: readNumber(row, "updatedAt") ?? createdAt,
  };
}

export const workspacesToFinalShape = migrations.define({
  table: "workspaces",
  migrateOne: async (ctx, doc) => {
    await ctx.db.replace("workspaces", doc._id, finalWorkspace(doc));
  },
});

/* ------------------------------------------------------------------ */
/* memberships → removed fields stripped                               */
/* ------------------------------------------------------------------ */

type Role = Doc<"memberships">["role"];
type MembershipStatus = Doc<"memberships">["status"];

const ROLES: Record<Role, true> = { owner: true, operator: true, viewer: true };
const MEMBERSHIP_STATUSES: Record<MembershipStatus, true> = {
  active: true,
  revoked: true,
};

export const membershipsStripRemoved = migrations.define({
  table: "memberships",
  migrateOne: async (ctx, doc) => {
    const row = raw(doc);
    const label = `membership ${doc._id}`;
    const role = row["role"];
    const status = row["status"];
    if (!memberOf(ROLES, role)) {
      throw invalid(`${label} has an unmapped role`);
    }
    if (!memberOf(MEMBERSHIP_STATUSES, status)) {
      throw invalid(`${label} has an unmapped status`);
    }
    const createdAt = readNumber(row, "createdAt") ?? doc._creationTime;

    await ctx.db.replace("memberships", doc._id, {
      workspaceId: requireWorkspaceRef(ctx, row, label),
      identityKey: requireString(row, "identityKey", label),
      role,
      status,
      createdAt,
      updatedAt: readNumber(row, "updatedAt") ?? createdAt,
    });
  },
});

/* ------------------------------------------------------------------ */
/* suppressions → removed fields stripped                              */
/* ------------------------------------------------------------------ */

type SuppressionKind = Doc<"suppressions">["kind"];
type SuppressionReason = Doc<"suppressions">["reason"];

const SUPPRESSION_KINDS: Record<SuppressionKind, true> = {
  email: true,
  domain: true,
};
const SUPPRESSION_REASONS: Record<SuppressionReason, true> = {
  unsubscribe: true,
  manual: true,
  bounce: true,
  provider: true,
};

export const suppressionsStripRemoved = migrations.define({
  table: "suppressions",
  migrateOne: async (ctx, doc) => {
    const row = raw(doc);
    const label = `suppression ${doc._id}`;
    const kind = row["kind"];
    const reason = row["reason"];
    if (!memberOf(SUPPRESSION_KINDS, kind)) {
      throw invalid(`${label} has an unmapped kind`);
    }
    if (!memberOf(SUPPRESSION_REASONS, reason)) {
      throw invalid(`${label} has an unmapped reason`);
    }
    // An opt-out with no address suppresses nothing, and losing one is the
    // single irreversible harm this runbook exists to prevent.
    const normalizedValue = requireString(row, "normalizedValue", label);

    const storedConversation = readString(row, "sourceConversationId");
    const sourceConversationId =
      storedConversation === undefined
        ? null
        : ctx.db.normalizeId("conversations", storedConversation);

    await ctx.db.replace("suppressions", doc._id, {
      workspaceId: requireWorkspaceRef(ctx, row, label),
      kind,
      normalizedValue,
      reason,
      createdAt: readNumber(row, "createdAt") ?? doc._creationTime,
      // The clear step empties `conversations`, so a pre-pivot back-reference
      // would dangle. Keep it only while it still resolves.
      ...(sourceConversationId === null ? {} : { sourceConversationId }),
    });
  },
});
