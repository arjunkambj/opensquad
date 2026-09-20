/**
 * The revealed contact, in our own words.
 *
 * A reveal is the one call that buys personal data, so the mapping gets its
 * own file and its own rules: every value is trimmed and bounded, an address
 * is accepted only if it normalises to something we could actually send to,
 * and anything else is absent rather than empty. An address we cannot store
 * is treated exactly like no address — the lead's `emailStatus` becomes
 * `not_found`, never an invented or half-parsed one (PLAN §7).
 *
 * Storing any of this on the lead is the caller's job (T31); nothing here
 * writes to `prospects`.
 */
import {
  normalizeCanonicalDomain,
  normalizeEmailAddress,
} from "../../lib/validators";
import { v } from "convex/values";

const CONTACT_NAME_MAX_LENGTH = 200;

const CONTACT_TITLE_MAX_LENGTH = 500;

const CONTACT_URL_MAX_LENGTH = 500;

const EMAIL_MAX_LENGTH = 320;

const DOMAIN_MAX_LENGTH = 300;

export const vRevealedContact = v.object({
  sourceLeadId: v.string(),
  email: v.string(),
  firstName: v.optional(v.string()),
  /** The full last name, which a preview row only masks. */
  lastName: v.optional(v.string()),
  jobTitle: v.optional(v.string()),
  companyName: v.optional(v.string()),
  linkedinUrl: v.optional(v.string()),
  canonicalDomain: v.optional(v.string()),
});

export type RevealedContact = {
  sourceLeadId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  companyName?: string;
  linkedinUrl?: string;
  canonicalDomain?: string;
};

/** The one revealed contact a single-lead job returns, or `null`. */
export function firstRevealedContact(revealed: unknown): RevealedContact | null {
  if (!Array.isArray(revealed) || revealed.length === 0) {
    return null;
  }
  const raw = revealed[0];
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const sourceLeadId = bounded(row["id"], CONTACT_NAME_MAX_LENGTH);
  const address = bounded(row["emailAddress"], EMAIL_MAX_LENGTH);
  if (sourceLeadId === undefined || address === undefined) {
    return null;
  }
  let email: string;
  try {
    email = normalizeEmailAddress(address);
  } catch {
    return null;
  }
  return {
    sourceLeadId,
    email,
    ...optional("firstName", bounded(row["firstName"], CONTACT_NAME_MAX_LENGTH)),
    ...optional("lastName", bounded(row["lastName"], CONTACT_NAME_MAX_LENGTH)),
    ...optional("jobTitle", bounded(row["jobTitle"], CONTACT_TITLE_MAX_LENGTH)),
    ...optional(
      "companyName",
      bounded(row["companyName"], CONTACT_NAME_MAX_LENGTH),
    ),
    ...optional(
      "linkedinUrl",
      bounded(row["linkedinUrl"], CONTACT_URL_MAX_LENGTH),
    ),
    ...optional("canonicalDomain", canonicalDomain(row["domain"])),
  };
}

function canonicalDomain(value: unknown): string | undefined {
  const raw = bounded(value, DOMAIN_MAX_LENGTH);
  if (raw === undefined) {
    return undefined;
  }
  try {
    return normalizeCanonicalDomain(raw);
  } catch {
    return undefined;
  }
}

function bounded(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed.slice(0, max);
}

function optional<K extends string>(
  key: K,
  value: string | undefined,
): Record<K, string> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}
