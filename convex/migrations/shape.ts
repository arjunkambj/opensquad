/**
 * The two shape migrations of the clean-slate cutover — MIGRATION.md §6.4.
 *
 * `orgs` is brought to the PLAN §7 shape (plan, fresh webhook token, inbox
 * reset to not-connected, opens not observed); `suppressions` only has
 * removed pre-pivot fields stripped. Both run through
 * `@convex-dev/migrations`, so each is batched, cursor-resumable,
 * re-runnable and supports the component's `dryRun`.
 *
 * NOTE ON THE PRE-PIVOT TABLE. Production's kept rows were written when the
 * tenant was a workspace with its own member list, so they carry no Hexclave
 * organization id and `orgsToFinalShape` cannot invent one: it fails the
 * batch, naming the row. Mapping each kept row to an organization, or
 * clearing it, is an owner decision recorded as an open item in
 * `plan/migration-log.md` — not something a migration may guess.
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
import { generateWebhookToken } from "../orgs/model";

export const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
});

/**
 * Runs any migration in this file by name, for the cutover runbook:
 * `npx convex run migrations/shape:run '{"fn":"migrations/shape:orgsToFinalShape"}'`.
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
 * An exhaustive containment test for a stored union value. The `Record` key
 * type is what makes it exhaustive: adding a member to the schema union turns
 * a missing key here into a compile error, so a new kind or reason can never
 * be silently rejected as invalid by a migration.
 */
function memberOf<T extends string>(
  members: Record<T, true>,
  value: unknown,
): value is T {
  return typeof value === "string" && Object.hasOwn(members, value);
}

function requireOrgRef(
  ctx: MutationCtx,
  row: RawDoc,
  label: string,
): Id<"orgs"> {
  const value = readString(row, "orgId");
  const orgId =
    value === undefined ? null : ctx.db.normalizeId("orgs", value);
  if (orgId === null) {
    throw invalid(`${label} has no usable orgId`);
  }
  return orgId;
}

/* ------------------------------------------------------------------ */
/* orgs → final shape                                                  */
/* ------------------------------------------------------------------ */


const WEBHOOK_TOKEN_PATTERN = new RegExp(
  `^[0-9a-f]{${WEBHOOK_TOKEN_LENGTH * 2}}$`,
);

/** The same defaults `orgs.ensureOrg` gives a new org. */
const DEFAULT_DAILY_SEND_LIMIT = 10;
const DEFAULT_POLICY_VERSION = 1;
const DEFAULT_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];
const DEFAULT_START_MINUTE = 9 * 60;
const DEFAULT_END_MINUTE = 17 * 60;

type SendWindow = Doc<"orgs">["sendWindow"];

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
 * The kept org, as PLAN §7 declares it.
 *
 * Preserved: `name`, `hexclaveOrgId`, `createdByIdentityKey`, `timezone`,
 * `createdAt`, `updatedAt`, and the send policy where the stored value is
 * structurally valid — the organization must still be able to sign in and
 * find its data. `updatedAt` is preserved rather than stamped so a second run
 * produces an identical document.
 *
 * Reset: `plan`; `automationState` / `pauseReason`, because every member lands
 * back in onboarding with an empty org (§6.7) and nothing may send
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
function finalOrg(
  doc: Doc<"orgs">,
): WithoutSystemFields<Doc<"orgs">> {
  const row = raw(doc);
  const label = `organization ${doc._id}`;
  // The tenant key. A row without it is reachable by nobody — every request
  // is authorised by matching the token's active organization against it —
  // and it cannot be derived from anything stored here, so the batch fails
  // and names the document rather than writing an orphan (see the open item
  // in `plan/migration-log.md`).
  const hexclaveOrgId = requireString(row, "hexclaveOrgId", label);
  const createdByIdentityKey = requireString(
    row,
    "createdByIdentityKey",
    label,
  );
  const existingToken = readString(row, "webhookToken");
  const createdAt = readNumber(row, "createdAt") ?? doc._creationTime;

  return {
    name: readString(row, "name") ?? "My organization",
    hexclaveOrgId,
    createdByIdentityKey,
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

export const orgsToFinalShape = migrations.define({
  table: "orgs",
  migrateOne: async (ctx, doc) => {
    await ctx.db.replace("orgs", doc._id, finalOrg(doc));
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
      orgId: requireOrgRef(ctx, row, label),
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
