// Presence-only checks that inherited builder/provider credentials are absent
// inside the Box. NEVER reads file contents or environment values — it reports
// only whether a path exists or a variable name is set, per G1 acceptance:
// "confirm inherited builder credentials are absent using presence checks
// only, without printing file contents or environment values".

import { access, constants, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Env var names whose presence inside a Box means credentials leaked in.
 * Provider secrets (AGENTMAIL_*, FIRECRAWL_*, OPENAI/CODEX keys) must never be
 * injected; `noEnv: true` at create time is the control under test. */
export const FORBIDDEN_ENV_NAMES: readonly string[] = [
  "OPENAI_API_KEY",
  "OPENAI_KEY",
  "CODEX_API_KEY",
  "CODEX_AUTH_TOKEN",
  "CHATGPT_ACCESS_TOKEN",
  "ASCII_API_KEY",
  "AGENTMAIL_API_KEY",
  "AGENTMAIL_WEBHOOK_SECRET",
  "FIRECRAWL_API_KEY",
  "FIRECRAWL_WEBHOOK_SECRET",
  "CONVEX_DEPLOY_KEY",
  "HEXCLAVE_SECRET_SERVER_KEY",
  // GitHub creds would let a customer Box act as the builder.
  "GITHUB_TOKEN",
  "GH_TOKEN",
];

/** Credential files that must not exist inside a fresh customer Box. Codex's
 * own managed login may legitimately create `~/.codex/auth.json` AFTER the
 * workspace owner signs in — the check is meaningful at Box birth, before
 * the managed login flow runs. */
export const FORBIDDEN_PATHS: readonly string[] = [
  ".codex/auth.json",
  ".codex/credentials",
  ".ssh/id_rsa",
  ".ssh/id_ed25519",
  ".git-credentials",
  ".config/gh/hosts.yml",
  ".agentmail/credentials",
];

export type PresenceCheck = {
  readonly kind: "env" | "path";
  /** Name only — never the value. */
  readonly name: string;
  readonly present: boolean;
};

export type PresenceReport = {
  readonly clean: boolean;
  readonly checks: readonly PresenceCheck[];
  readonly codexHome: string;
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function checkInheritedCredentials(options?: {
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
  readonly codexHome?: string;
  /** Runtime restarts reuse the owner's login cache. Provisioning probes must
   * leave this false so inherited Codex credentials are rejected at Box birth. */
  readonly allowManagedLoginCache?: boolean;
}): Promise<PresenceReport> {
  const env = options?.env ?? process.env;
  const home = options?.home ?? homedir();
  const codexHome =
    options?.codexHome ?? env["CODEX_HOME"] ?? join(home, ".codex");

  const checks: PresenceCheck[] = [];

  for (const name of FORBIDDEN_ENV_NAMES) {
    // Presence only: `name in env`, never env[name].
    checks.push({ kind: "env", name, present: name in env });
  }

  for (const rel of FORBIDDEN_PATHS) {
    if (options?.allowManagedLoginCache && rel.startsWith(".codex/")) continue;
    const absolute = rel.startsWith(".codex/")
      ? join(codexHome, rel.slice(".codex/".length))
      : join(home, rel);
    checks.push({
      kind: "path",
      name: rel,
      present: await pathExists(absolute),
    });
  }

  // The worker's own env names are expected to be present (injected by the
  // provisioning flow); their ABSENCE inside the Box is a provisioning bug.
  for (const name of [
    "OPENSQUAD_BRIDGE_URL",
    "OPENSQUAD_RUNTIME_ID",
    "OPENSQUAD_RUNTIME_GENERATION",
    "OPENSQUAD_WORKER_TOKEN",
  ]) {
    checks.push({ kind: "env", name, present: name in env });
  }

  return {
    clean: checks
      .filter(
        (c) =>
          FORBIDDEN_ENV_NAMES.includes(c.name) ||
          FORBIDDEN_PATHS.includes(c.name),
      )
      .every((c) => !c.present),
    checks,
    codexHome,
  };
}

/** Directory listing count for `codexHome` — presence metadata only, used to
 * report "login cache exists" without opening any file. */
export async function codexHomeEntryCount(codexHome: string): Promise<number> {
  try {
    const info = await stat(codexHome);
    if (!info.isDirectory()) return 0;
    const { readdir } = await import("node:fs/promises");
    return (await readdir(codexHome)).length;
  } catch {
    return 0;
  }
}
