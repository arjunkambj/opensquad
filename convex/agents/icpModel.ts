/**
 * Checking one ICP, whoever produced it (PLAN §3 step 2, §7).
 *
 * Nothing else in this domain may write `agents.icp`: `normalizeIcp` is the
 * one door, and the closed groups it enforces are the whole reason the product
 * does not silently search for nobody. The values it checks against live in
 * `icpVocabulary.ts`.
 *
 * `strict` is the difference between a user's edit and a model's answer. An
 * edit naming a value the catalogue does not have is a bug or an attempt, and
 * is REFUSED — the screens only ever offer catalogue values. A model's answer
 * is merely filtered: a paid generation must not be thrown away because one
 * of six industries came back misspelled.
 */
import type { Id } from "../_generated/dataModel";
import {
  boundedString,
  boundedStringList,
  COMPANY_PAIN_POINTS_MAX_LENGTH,
  computeResultDigest,
  ICP_LIST_MAX_ITEMS,
  ICP_VALUE_MAX_LENGTH,
  invalid,
} from "../lib/validators";
import type { AgentIcp } from "../lib/validators";
import { ICP_GROUP_MAX_ITEMS } from "./icpVocabulary";
import type { IcpOptionLists } from "./icpVocabulary";

/** Trim, drop blanks, drop case-insensitive duplicates, keep the order. */
function tidy(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const lower = trimmed.toLocaleLowerCase();
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    kept.push(trimmed);
  }
  return kept;
}

function freeTextGroup(
  values: readonly string[],
  field: keyof AgentIcp,
): string[] {
  return boundedStringList(tidy(values), field, {
    maxItems: Math.min(ICP_GROUP_MAX_ITEMS[field], ICP_LIST_MAX_ITEMS),
    itemMax: ICP_VALUE_MAX_LENGTH,
  });
}

/**
 * A closed group, checked against the values it may carry.
 *
 * `strict` is the difference between a user's edit and a model's answer. An
 * edit that names a value the catalogue does not have is a bug or an attempt,
 * and is REFUSED — the screens only ever offer catalogue values, so nothing
 * legitimate reaches this with a value that is not one. A model's answer is
 * merely filtered: a paid generation must not be thrown away because one of
 * six industries came back misspelled.
 */
function closedGroup(
  values: readonly string[],
  field: keyof AgentIcp,
  allowed: readonly string[],
  strict: boolean,
): string[] {
  const tidied = tidy(values);
  const permitted = new Set(allowed);
  const kept: string[] = [];
  for (const value of tidied) {
    if (!permitted.has(value)) {
      if (strict) {
        throw invalid(`${field} does not allow one of the values it was given`);
      }
      continue;
    }
    kept.push(value);
  }
  return kept.slice(0, ICP_GROUP_MAX_ITEMS[field]);
}

export type NormalizeIcpArgs = {
  icp: AgentIcp;
  options: IcpOptionLists;
  /** `true` for a user edit, `false` for a generated answer. */
  strict: boolean;
};

/**
 * The one door an ICP goes through before it is written, whoever produced it.
 *
 * Nothing else in this domain may write `agents.icp`: the closed groups are
 * the whole reason the product does not silently search for nobody.
 */
export function normalizeIcp(args: NormalizeIcpArgs): AgentIcp {
  const { icp, options, strict } = args;
  return {
    jobTitles: freeTextGroup(icp.jobTitles, "jobTitles"),
    industries: closedGroup(
      icp.industries,
      "industries",
      options.industries,
      strict,
    ),
    locations: closedGroup(icp.locations, "locations", options.locations, strict),
    companyTypes: closedGroup(
      icp.companyTypes,
      "companyTypes",
      options.companyTypes,
      strict,
    ),
    companySizes: closedGroup(
      icp.companySizes,
      "companySizes",
      options.companySizes.map((band) => band.value),
      strict,
    ),
    excludeProfiles: closedGroup(
      icp.excludeProfiles,
      "excludeProfiles",
      options.excludeProfiles.map((option) => option.value),
      strict,
    ),
    excludeKeywords: freeTextGroup(icp.excludeKeywords, "excludeKeywords"),
  };
}

/**
 * Turn the labels a generation answered with back into stored values.
 *
 * Company sizes and profile exclusions are OUR vocabulary, and the model is
 * shown their labels — "11–50 employees" reads like a choice, `11-50` reads
 * like a bug. It stores the value, so the two are reconciled here, once,
 * before anything is checked. A value the model happened to answer with
 * already passes through, and anything else is left alone for `normalizeIcp`
 * to drop.
 */
export function resolveGeneratedLabels(
  icp: AgentIcp,
  options: IcpOptionLists,
): AgentIcp {
  const resolve = (
    values: readonly string[],
    list: readonly { value: string; label: string }[],
  ): string[] =>
    values.map((entry) => {
      const lower = entry.trim().toLocaleLowerCase();
      const match = list.find(
        (option) =>
          option.value.toLocaleLowerCase() === lower ||
          option.label.toLocaleLowerCase() === lower,
      );
      return match?.value ?? entry;
    });
  return {
    ...icp,
    companySizes: resolve(icp.companySizes, options.companySizes),
    excludeProfiles: resolve(icp.excludeProfiles, options.excludeProfiles),
  };
}

/** The pain points a generation produced, bounded for the profile. */
export function boundedPainPoints(value: string): string {
  return boundedString(value, "painPoints", {
    max: COMPANY_PAIN_POINTS_MAX_LENGTH,
  });
}

const ICP_GROUPS = [
  "jobTitles",
  "industries",
  "locations",
  "companyTypes",
  "companySizes",
  "excludeProfiles",
  "excludeKeywords",
] as const satisfies readonly (keyof AgentIcp)[];

/** True when every list is empty — the state a draft agent starts in, and the
 *  condition for generating one automatically. */
export function icpIsEmpty(icp: AgentIcp): boolean {
  return ICP_GROUPS.every((group) => icp[group].length === 0);
}

/** True when nothing about the ICP changed, so `revision` must not move. */
export function sameIcp(a: AgentIcp, b: AgentIcp): boolean {
  return ICP_GROUPS.every(
    (group) =>
      a[group].length === b[group].length &&
      a[group].every((value, index) => value === b[group][index]),
  );
}

/**
 * The key one run spends under. It always carries `startedAt`, so Retry and
 * Regenerate really re-ask the model: a replayed AI operation carries no
 * object at all (`ai/run.ts`), so reusing a key would make every retry fail
 * identically and for free.
 */
export async function icpOperationKey(args: {
  orgId: Id<"orgs">;
  startedAt: number;
}): Promise<string> {
  // Hashed rather than concatenated so the key cannot grow past
  // `OPERATION_KEY_MAX` once the action prefix is added.
  const digest = await computeResultDigest({
    orgId: args.orgId,
    startedAt: args.startedAt,
  });
  return `${args.orgId}:${digest.slice("sha256:".length, "sha256:".length + 16)}`;
}

/**
 * How long a `generating` status may sit before a new run may replace it.
 *
 * The internal action always reports back, so this only covers a deployment
 * that lost the scheduled call. Without it the user would face a screen that
 * never stops loading and a Retry that is refused forever.
 */
export const ICP_GENERATION_STALE_AFTER_MS = 5 * 60_000;
