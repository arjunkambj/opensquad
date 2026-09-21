/**
 * The `orgSecrets` store — one encrypted row per (org, provider)
 * (PLAN §4 "Bring-your-own keys", §9.4 "Rotation").
 *
 * WHAT THIS FILE IS ALLOWED TO RETURN. Every function here is internal. The
 * envelope readers hand ciphertext to an ACTION, which is the only place
 * `lib/secrets.decryptSecret` may run; nothing here decrypts, and no return
 * value reaches a client. The public Manage-inbox surface reads
 * `summariseSecret` instead, which projects `{ status, last4 }` and nothing
 * else.
 *
 * ROTATION. PLAN §9.4 keeps the PREVIOUS webhook secret valid for ten minutes
 * so an event signed under the old one during the swap is still verified. The
 * overlap lives on the row (`previousCiphertext`/`previousIv`/
 * `previousValidUntil`) rather than in a second row, because the receiver
 * needs both halves in one read and a second row would need its own
 * uniqueness rule.
 */
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { activeHexclaveOrgId, expectedUsersIssuer } from "../lib/auth";
import {
  boundedString,
  domainError,
  vSecretProvider,
  vSecretStatus,
} from "../lib/validators";
import type { SecretProvider, SecretStatus } from "../lib/validators";
import { v } from "convex/values";

/**
 * How long a rotated-out secret stays acceptable (PLAN §9.4 "Both secrets are
 * accepted for 10 minutes so nothing is lost in between").
 */
export const SECRET_ROTATION_OVERLAP_MS = 10 * 60 * 1000;

/** Longest ciphertext/iv this store accepts — a bound, not a shape check. */
const SECRET_FIELD_MAX_LENGTH = 2_000;

/** The two providers a connected org holds keys for. */
export const AGENTMAIL_SECRET_PROVIDERS: readonly SecretProvider[] = [
  "agentmail",
  "agentmail_webhook",
];

export async function readOrgSecret(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  provider: SecretProvider,
): Promise<Doc<"orgSecrets"> | null> {
  return await ctx.db
    .query("orgSecrets")
    .withIndex("by_orgId_and_provider", (q) =>
      q.eq("orgId", orgId).eq("provider", provider),
    )
    .unique();
}

/** The whole client-visible truth about a stored key. */
export const vSecretSummary = v.object({
  status: v.union(vSecretStatus, v.literal("missing")),
  last4: v.optional(v.string()),
  checkedAt: v.optional(v.number()),
});

export type SecretSummary = typeof vSecretSummary.type;

export function summariseSecret(
  row: Doc<"orgSecrets"> | null,
): SecretSummary {
  if (row === null) {
    return { status: "missing" as const };
  }
  return {
    status: row.status,
    last4: row.last4,
    ...(row.checkedAt !== undefined ? { checkedAt: row.checkedAt } : {}),
  };
}

/**
 * The ciphertext an action needs. Internal only — an action decrypts it and
 * never returns the plaintext.
 */
const secretEnvelopeFields = {
  ciphertext: v.string(),
  iv: v.string(),
  status: vSecretStatus,
  last4: v.string(),
};

/** The CURRENT envelope alone: no rotation overlap, and therefore nothing in
 *  it that depends on what time it is. */
export const vSecretEnvelopeCurrent = v.object(secretEnvelopeFields);

export type SecretEnvelopeCurrent = typeof vSecretEnvelopeCurrent.type;

/** The current envelope plus the rotation overlap when one is still open. */
export const vSecretEnvelopeRow = v.object({
  ...secretEnvelopeFields,
  previous: v.optional(
    v.object({ ciphertext: v.string(), iv: v.string(), validUntil: v.number() }),
  ),
});

export type SecretEnvelopeRow = typeof vSecretEnvelopeRow.type;

/** The stored envelope with no time in it. */
export function currentEnvelopeOf(
  row: Doc<"orgSecrets">,
): SecretEnvelopeCurrent {
  return {
    ciphertext: row.ciphertext,
    iv: row.iv,
    status: row.status,
    last4: row.last4,
  };
}

export function envelopeOf(
  row: Doc<"orgSecrets">,
  at: number,
): SecretEnvelopeRow {
  const overlapOpen =
    row.previousCiphertext !== undefined &&
    row.previousIv !== undefined &&
    row.previousValidUntil !== undefined &&
    row.previousValidUntil > at;
  return {
    ...currentEnvelopeOf(row),
    ...(overlapOpen
      ? {
          previous: {
            ciphertext: row.previousCiphertext as string,
            iv: row.previousIv as string,
            validUntil: row.previousValidUntil as number,
          },
        }
      : {}),
  };
}

/**
 * Defence in depth on the envelope reader.
 *
 * Nothing in Convex lets a browser call an internal function, so today the
 * only callers are our own actions and every one of them guards first. That
 * is a property of the current call sites, not of this function, and a reader
 * that hands out ciphertext should not depend on every future caller
 * remembering.
 *
 * So: a call that carries NO identity is a scheduled internal action — the
 * backfill step, an outreach tick — and is allowed, because there is no user
 * for it to be acting outside of. A call that DOES carry one must be acting
 * for a member of that org, which is the same question `requireOrgMember`
 * asks: the token's active organization, and the issuer that signs real
 * accounts. A caller that skipped its own check is refused here, and it is
 * refused as `NOT_FOUND`, so nothing learns that another org's row exists.
 */
async function assertEnvelopeReadable(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return;
  }
  const org = await ctx.db.get("orgs", orgId);
  if (
    org === null ||
    identity.issuer !== expectedUsersIssuer() ||
    activeHexclaveOrgId(identity) !== org.hexclaveOrgId
  ) {
    throw domainError("NOT_FOUND", "organization not found");
  }
}

/**
 * Read one stored envelope. Callers are internal actions only, and the guard
 * above holds whichever of them calls it.
 *
 * It answers with the CURRENT secret and never the rotation overlap, which is
 * what keeps a query out of the wall clock: whether an overlap is still open
 * is a question about `Date.now()`, and a query that reads the clock returns a
 * different answer for the same arguments without anything having changed
 * (`convex_rules.txt`). The one caller that needs both halves is the inbound
 * webhook route, which reads the row and calls `envelopeOf` from its HTTP
 * action — where the clock is legal and the answer is used immediately.
 */
export const getEnvelope = internalQuery({
  args: {
    orgId: v.id("orgs"),
    provider: vSecretProvider,
  },
  returns: v.union(vSecretEnvelopeCurrent, v.null()),
  handler: async (ctx, args) => {
    await assertEnvelopeReadable(ctx, args.orgId);
    const row = await readOrgSecret(ctx, args.orgId, args.provider);
    return row === null ? null : currentEnvelopeOf(row);
  },
});

/**
 * Insert or replace one org secret.
 *
 * `keepPreviousFor` opens the rotation overlap: the secret being replaced
 * stays acceptable for that many milliseconds. Storing a secret with no
 * overlap CLEARS any open one — a fresh connect must not inherit the previous
 * owner's window.
 */
export async function putOrgSecret(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    provider: SecretProvider;
    ciphertext: string;
    iv: string;
    last4: string;
    status: SecretStatus;
    keepPreviousFor?: number;
  },
): Promise<Doc<"orgSecrets">> {
  const ciphertext = boundedString(args.ciphertext, "ciphertext", {
    min: 1,
    max: SECRET_FIELD_MAX_LENGTH,
  });
  const iv = boundedString(args.iv, "iv", { min: 1, max: 128 });
  const last4 = boundedString(args.last4, "last4", { min: 1, max: 8 });
  const now = Date.now();
  const existing = await readOrgSecret(
    ctx,
    args.orgId,
    args.provider,
  );
  const overlap =
    args.keepPreviousFor !== undefined && existing !== null
      ? {
          previousCiphertext: existing.ciphertext,
          previousIv: existing.iv,
          previousValidUntil: now + args.keepPreviousFor,
        }
      : {
          previousCiphertext: undefined,
          previousIv: undefined,
          previousValidUntil: undefined,
        };
  if (existing !== null) {
    await ctx.db.patch("orgSecrets", existing._id, {
      ciphertext,
      iv,
      last4,
      status: args.status,
      updatedAt: now,
      checkedAt: now,
      ...overlap,
    });
    const patched = await ctx.db.get("orgSecrets", existing._id);
    if (patched === null) {
      throw domainError("NOT_FOUND", "organization secret not found after write");
    }
    return patched;
  }
  const id = await ctx.db.insert("orgSecrets", {
    orgId: args.orgId,
    provider: args.provider,
    ciphertext,
    iv,
    last4,
    status: args.status,
    createdAt: now,
    updatedAt: now,
    checkedAt: now,
  });
  const inserted = await ctx.db.get("orgSecrets", id);
  if (inserted === null) {
    throw domainError("NOT_FOUND", "organization secret not found after insert");
  }
  return inserted;
}

/** Store one secret. Internal: the plaintext was encrypted by the caller. */
export const putSecret = internalMutation({
  args: {
    orgId: v.id("orgs"),
    provider: vSecretProvider,
    ciphertext: v.string(),
    iv: v.string(),
    last4: v.string(),
    status: vSecretStatus,
    keepPreviousFor: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await putOrgSecret(ctx, args);
    return null;
  },
});

/**
 * Wipe every AgentMail secret an org holds — the disconnect path
 * (PLAN §4 step 7). Deleting the rows rather than blanking them means a
 * later read cannot mistake an empty envelope for a usable one.
 */
export async function clearOrgSecrets(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
): Promise<void> {
  for (const provider of AGENTMAIL_SECRET_PROVIDERS) {
    const row = await readOrgSecret(ctx, orgId, provider);
    if (row !== null) {
      await ctx.db.delete("orgSecrets", row._id);
    }
  }
}

/**
 * Close an open rotation overlap early. Called once the new webhook secret has
 * been proven by a verified event, and by the overlap sweep for the case where
 * no event arrived.
 */
export const closeRotationOverlap = internalMutation({
  args: {
    orgId: v.id("orgs"),
    provider: vSecretProvider,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await readOrgSecret(ctx, args.orgId, args.provider);
    if (row === null || row.previousCiphertext === undefined) {
      return null;
    }
    await ctx.db.patch("orgSecrets", row._id, {
      previousCiphertext: undefined,
      previousIv: undefined,
      previousValidUntil: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});
