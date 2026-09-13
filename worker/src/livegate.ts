// Live G1 gate driver (P03). Runs on the BUILDER machine — never inside the
// Box — and drives the disposable Boxes through the real ASCII API using the
// committed adapter/client. The in-Box protocol work is delegated to
// `boxprobe.js` (uploaded into the Box and started as a detached command).
//
// Probe order (integrations.md §G1 acceptance):
//   1. discovery: me/limits/environments/named-snapshots (sanitized)
//   2. create Box A with a persisted idempotency key + request fingerprint,
//      repeat the identical create, confirm ONE box ID
//   3. wait ready → presence-only credential checks inside the Box
//   4. bootstrap Node 24.21.0 + @openai/codex@0.154.0; verify codex --version
//      and that `generate-ts` output matches the committed generated types
//   5. upload the compiled worker probe bundle; start the gate probe detached;
//      relay the device-code challenge to LIVE_GATE_STATUS.json the moment it
//      appears (owner completes URL+code out of band)
//   6. on login: rateLimits → thread/start → ONE bounded structured turn
//   7. marker file → pause (stop→archived) → resume → marker + managed-login +
//      thread/resume verification (post-resume probe phase)
//   8. second disposable Box B → no shared filesystem/credential state
//   9. cleanup: delete both boxes (X-Ascii-Confirm-Delete); confirm gone
//
// Local state lives under worker/.livegate/ (untracked) so the driver can be
// restarted safely: persisted idempotency keys replay the same create.
// The owner challenge is written to worker/LIVE_GATE_STATUS.json (untracked)
// and printed to stdout the moment it is issued — device codes expire.

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AsciiBoxClient } from "./ascii/client.js";
import {
  BoxLifecycleAdapter,
  type BoxOperationStore,
} from "./ascii/adapter.js";
import type {
  BoxCreateConfig,
  BoxFacts,
  BoxOperationRecord,
} from "./ascii/types.js";

const DIST_DIR = dirname(fileURLToPath(import.meta.url));
const WORKER_ROOT = join(DIST_DIR, "..");
const REPO_ROOT = join(WORKER_ROOT, "..");
const STATE_DIR = join(WORKER_ROOT, ".livegate");
const STATE_PATH = join(STATE_DIR, "state.json");
const OPS_PATH = join(STATE_DIR, "operations.json");
const GATE_STATUS_OUT = join(WORKER_ROOT, "LIVE_GATE_STATUS.json");
const RESULT_OUT = join(STATE_DIR, "gate-result.json");

const NODE_VERSION = "24.21.0";
const CODEX_VERSION = "0.154.0";
const BOX_TTL_SECONDS = 7200;
const FALLBACK_TTL_SECONDS = 3600;
const LOGIN_WAIT_BUDGET_MS = 50 * 60_000;
const STATUS_POLL_MS = 5_000;
// In-Box gate workspace. Set from the discovered box $HOME after the first
// presence check — MUST live under $HOME: /tmp is NOT preserved across
// stop/resume (verified live 2026-09-13: marker written to /tmp vanished).
let GATE_DIR = "/home/user/opensquad-gate";
let BUNDLE_DIR = `${GATE_DIR}/bundle`;

function line(kind: string, data: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ kind, ...data })}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEnvFileKey(name: string): string | undefined {
  const fromEnv = process.env[name];
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  const path = join(REPO_ROOT, ".env.local");
  if (!existsSync(path)) return undefined;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    if (trimmed.slice(0, eq).trim() !== name) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/** File-backed operation store — the persisted idempotency-key record G1
 * requires. P07 replaces this with Convex `runtimeLifecycleOperations`. */
class JsonFileBoxOperationStore implements BoxOperationStore {
  readonly #records = new Map<string, BoxOperationRecord>();
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
          string,
          BoxOperationRecord
        >;
        for (const [k, v] of Object.entries(parsed)) this.#records.set(k, v);
      } catch {
        // Corrupt store — start empty; never fabricate operation history.
      }
    }
  }

  get(operationKey: string): Promise<BoxOperationRecord | undefined> {
    return Promise.resolve(this.#records.get(operationKey));
  }

  save(record: BoxOperationRecord): Promise<void> {
    this.#records.set(record.operationKey, { ...record });
    mkdirSync(dirname(this.#path), { recursive: true });
    const out: Record<string, BoxOperationRecord> = {};
    for (const [k, v] of this.#records) out[k] = v;
    writeFileSync(this.#path, JSON.stringify(out, null, 2));
    return Promise.resolve();
  }
}

type GateState = {
  idemA?: string;
  idemB?: string;
  candidateA?: string;
  boxAId?: string;
  boxBId?: string;
  boxACleaned?: boolean;
  boxBCleaned?: boolean;
  codexBinInBox?: string;
  nodeBinDir?: string;
  markerPath?: string;
  markerContent?: string;
};

function loadState(): GateState {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as GateState;
  } catch {
    return {};
  }
}

function saveState(state: GateState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function writeLiveGateStatus(patch: Record<string, unknown>): void {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(
      readFileSync(GATE_STATUS_OUT, "utf8"),
    ) as Record<string, unknown>;
  } catch {
    // first write
  }
  writeFileSync(
    GATE_STATUS_OUT,
    JSON.stringify(
      { ...current, ...patch, updatedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
}

type ShellResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

/** Run a synchronous shell command inside the Box (provider cap ≤600 s). */
async function runShell(
  client: AsciiBoxClient,
  boxId: string,
  command: string,
  opts?: { cwd?: string; timeoutSeconds?: number },
): Promise<ShellResult> {
  const result = await client.runCommand(boxId, {
    command,
    ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}),
    timeoutSeconds: opts?.timeoutSeconds ?? 120,
  });
  if (!result.ok) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      error: `${result.error.code ?? result.error.kind}: ${result.error.message}`,
    };
  }
  const v: unknown = result.value;
  if (isRecord(v) && v["type"] === "command.finished") {
    return {
      ok: v["exitCode"] === 0,
      exitCode: typeof v["exitCode"] === "number" ? (v["exitCode"] as number) : null,
      stdout: typeof v["stdout"] === "string" ? v["stdout"] : "",
      stderr: typeof v["stderr"] === "string" ? v["stderr"] : "",
    };
  }
  return {
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: "",
    error: "command did not finish synchronously",
  };
}

/** Presence-only credential hygiene inside the Box: reports present/absent
 * for each forbidden env name / credential path. Never prints values. */
const PRESENCE_SCRIPT = [
  'for n in OPENAI_API_KEY OPENAI_KEY CODEX_API_KEY CODEX_AUTH_TOKEN CHATGPT_ACCESS_TOKEN ASCII_API_KEY AGENTMAIL_API_KEY AGENTMAIL_WEBHOOK_SECRET FIRECRAWL_API_KEY FIRECRAWL_WEBHOOK_SECRET CONVEX_DEPLOY_KEY HEXCLAVE_SECRET_SERVER_KEY GITHUB_TOKEN GH_TOKEN; do if printenv "$n" >/dev/null 2>&1; then echo "env:$n:present"; else echo "env:$n:absent"; fi; done',
  'for p in "$HOME/.codex/auth.json" "$HOME/.codex/credentials" "$HOME/.ssh/id_rsa" "$HOME/.ssh/id_ed25519" "$HOME/.git-credentials" "$HOME/.config/gh/hosts.yml" "$HOME/.agentmail/credentials"; do if [ -e "$p" ]; then echo "path:${p#$HOME/}:present"; else echo "path:${p#$HOME/}:absent"; fi; done',
  'echo "home:$HOME"; echo "user:$(id -un)"; echo "arch:$(uname -m)"',
].join("\n");

const TOOLCHAIN_SCRIPT = [
  'echo "os:$(head -1 /etc/os-release 2>/dev/null)"',
  "for c in node npm npx codex git curl wget tar xz sha256sum shasum systemctl bash; do if command -v $c >/dev/null 2>&1; then echo \"have:$c\"; else echo \"missing:$c\"; fi; done",
  "node --version 2>/dev/null || echo no-node",
  "codex --version 2>/dev/null || echo no-codex",
].join("\n");

async function readStatusFile(
  client: AsciiBoxClient,
  boxId: string,
  path: string,
): Promise<Record<string, unknown> | undefined> {
  const res = await client.readFile(boxId, path);
  if (!res.ok) return undefined;
  const content = res.value["content"];
  if (typeof content !== "string") return undefined;
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function uploadBundle(
  client: AsciiBoxClient,
  boxId: string,
): Promise<void> {
  const files: { local: string; remote: string }[] = [
    { local: "boxprobe.js", remote: `${BUNDLE_DIR}/boxprobe.js` },
    { local: "envcheck.js", remote: `${BUNDLE_DIR}/envcheck.js` },
    { local: "codex/appserver.js", remote: `${BUNDLE_DIR}/codex/appserver.js` },
    { local: "codex/methods.js", remote: `${BUNDLE_DIR}/codex/methods.js` },
  ];
  await runShell(client, boxId, `mkdir -p "${BUNDLE_DIR}/codex" "${GATE_DIR}"`);
  for (const f of files) {
    const content = readFileSync(join(DIST_DIR, f.local), "utf8");
    const res = await client.writeFile(boxId, f.remote, content, "utf8");
    if (!res.ok) {
      throw new Error(
        `upload ${f.remote} failed: ${res.error.code ?? res.error.kind}: ${res.error.message}`,
      );
    }
  }
  const pkg = await client.writeFile(
    boxId,
    `${BUNDLE_DIR}/package.json`,
    JSON.stringify({ type: "module" }),
    "utf8",
  );
  if (!pkg.ok) {
    throw new Error(`upload package.json failed: ${pkg.error.message}`);
  }
  line("boxA.bundleUploaded", { files: files.length + 1 });
}

async function startProbe(
  client: AsciiBoxClient,
  boxId: string,
  phase: string,
  env: { nodeBinDir: string; codexBin: string },
): Promise<{ ok: boolean; processId?: number; error?: string }> {
  const command =
    `PATH="${env.nodeBinDir}:$PATH" CODEX_HOME="${GATE_DIR}/codex-home" ` +
    `node "${BUNDLE_DIR}/boxprobe.js" --phase ${phase} ` +
    `--gate-dir "${GATE_DIR}" --codex-bin "${env.codexBin}" ` +
    `--login-budget-ms ${LOGIN_WAIT_BUDGET_MS}`;
  const res = await client.runCommand(boxId, {
    command,
    detached: true,
  });
  if (!res.ok) {
    return {
      ok: false,
      error: `${res.error.code ?? res.error.kind}: ${res.error.message}`,
    };
  }
  const v: unknown = res.value;
  if (isRecord(v) && v["type"] === "command.started" && typeof v["processId"] === "number") {
    return { ok: true, processId: v["processId"] };
  }
  return { ok: false, error: "unexpected detached response" };
}

/** Poll the in-Box rolling status file (`gate-status-<phase>.json`) until
 * `done` or the deadline. Every new device-code challenge is relayed to
 * LIVE_GATE_STATUS.json + stdout immediately — the owner needs the URL+code
 * while it is fresh. */
async function watchGateStatus(
  client: AsciiBoxClient,
  boxId: string,
  opts: { deadlineMs: number; label: string; phase: string },
): Promise<{ status?: Record<string, unknown>; timedOut: boolean }> {
  const deadline = Date.now() + opts.deadlineMs;
  let lastChallengeKey: string | undefined;
  let lastStage: string | undefined;
  while (Date.now() < deadline) {
    const status = await readStatusFile(
      client,
      boxId,
      `${GATE_DIR}/gate-status-${opts.phase}.json`,
    );
    if (status !== undefined) {
      const stage = typeof status["stage"] === "string" ? status["stage"] : "?";
      if (stage !== lastStage) {
        lastStage = stage;
        line(`${opts.label}.stage`, { stage });
      }
      const challenge = status["challenge"];
      if (isRecord(challenge)) {
        const key = `${challenge["loginId"]}:${challenge["sequence"]}`;
        if (key !== lastChallengeKey) {
          lastChallengeKey = key;
          const relay = {
            phase: "awaiting-owner-login",
            boxId,
            loginId: challenge["loginId"],
            verificationUrl: challenge["verificationUrl"],
            userCode: challenge["userCode"],
            issuedAt: challenge["issuedAt"],
            sequence: challenge["sequence"],
            note: "Device code expires in ~15 min. Owner: open verificationUrl and enter userCode.",
          };
          writeLiveGateStatus(relay);
          line("LOGIN_CHALLENGE", relay);
        }
      }
      if (status["done"] === true) {
        return { status, timedOut: false };
      }
    }
    await sleep(STATUS_POLL_MS);
  }
  return { timedOut: true };
}

async function cleanupBox(
  adapter: BoxLifecycleAdapter,
  state: GateState,
  which: "A" | "B",
): Promise<void> {
  const boxId = which === "A" ? state.boxAId : state.boxBId;
  const cleanedKey = which === "A" ? "boxACleaned" : "boxBCleaned";
  if (boxId === undefined || state[cleanedKey] === true) return;
  const del = await adapter.deleteBox({
    operationKey: `p03-live-delete-${which.toLowerCase()}`,
    boxId,
    waitMs: 4 * 60_000,
  });
  if (del.ok) {
    state[cleanedKey] = true;
    saveState(state);
    line(`box${which}.deleted`, { boxId });
    return;
  }
  line(`box${which}.deleteFailed`, {
    boxId,
    error: `${del.error.code ?? del.error.kind}: ${del.error.message}`,
  });
  // Fall back to pause so nothing billable keeps running.
  const stop = await adapter.pauseBox({
    operationKey: `p03-live-stop-${which.toLowerCase()}`,
    boxId,
    waitForArchivedMs: 4 * 60_000,
  });
  line(`box${which}.stopFallback`, {
    ok: stop.ok,
    error: stop.ok ? null : stop.error.message,
  });
  if (stop.ok) {
    state[cleanedKey] = true;
    saveState(state);
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  mkdirSync(STATE_DIR, { recursive: true });
  line("gate.start", { at: new Date(startedAt).toISOString() });

  const apiKey = readEnvFileKey("ASCII_API_KEY");
  if (apiKey === undefined) {
    line("gate.fatal", {
      error: "ASCII_API_KEY not found in env or .env.local",
    });
    process.exitCode = 78;
    return;
  }

  const client = new AsciiBoxClient(apiKey);
  const store = new JsonFileBoxOperationStore(OPS_PATH);
  const adapter = new BoxLifecycleAdapter(client, store);
  const state = loadState();
  const result: Record<string, unknown> = {};

  // ---------- 1. discovery ----------
  const me = await client.me();
  line(
    "ascii.me",
    me.ok
      ? {
          ok: true,
          hasLogin: typeof me.value.user?.login === "string",
          hasEmail: typeof me.value.user?.email === "string",
          zeroDataRetention: me.value.user?.zeroDataRetention ?? null,
        }
      : {
          ok: false,
          error: `${me.error.code ?? me.error.kind}: ${me.error.message}`,
        },
  );

  const limits = await client.limits();
  if (limits.ok) {
    const l = limits.value;
    line("ascii.limits", {
      ok: true,
      accessTier: l.accessTier ?? null,
      blockedReason: l.blockedReason ?? null,
      canStart: l.canStart ?? null,
      activeBoxes: l.activeBoxes ?? null,
      maxActiveBoxes: l.maxActiveBoxes ?? null,
      startBlockedReason: l.startBlockedReason ?? null,
    });
  } else {
    line("ascii.limits", {
      ok: false,
      error: `${limits.error.code ?? limits.error.kind}: ${limits.error.message}`,
    });
  }

  const environments = await client.listEnvironments();
  line(
    "ascii.environments",
    environments.ok
      ? {
          ok: true,
          count: environments.value.environments.length,
          entries: environments.value.environments.map((e) => ({
            name: e.name,
            isDefault: e.isDefault,
            safeForThirdParties: e.safeForThirdParties,
          })),
        }
      : {
          ok: false,
          error: `${environments.error.code ?? environments.error.kind}: ${environments.error.message}`,
        },
  );

  const snapshots = await client.listNamedSnapshots();
  line(
    "ascii.namedSnapshots",
    snapshots.ok
      ? {
          ok: true,
          count: snapshots.value.snapshots.length,
          entries: snapshots.value.snapshots.map((s) => ({
            name: s.name,
            status: s.status,
          })),
        }
      : {
          ok: false,
          error: `${snapshots.error.code ?? snapshots.error.kind}: ${snapshots.error.message}`,
        },
  );

  // ---------- 2. create Box A with persisted idempotency ----------
  const createCandidates: { label: string; config: BoxCreateConfig }[] = [
    {
      label: "ttl7200-small",
      config: { noEnv: true, ttlSeconds: BOX_TTL_SECONDS, type: "small" },
    },
    {
      label: "ttl3600-small",
      config: {
        noEnv: true,
        ttlSeconds: FALLBACK_TTL_SECONDS,
        type: "small",
      },
    },
    {
      label: "ttl3600-default",
      config: { noEnv: true, ttlSeconds: FALLBACK_TTL_SECONDS },
    },
  ];

  let boxA: BoxFacts | undefined;
  if (state.boxAId !== undefined && state.candidateA !== undefined) {
    const inspected = await adapter.inspectBox({
      operationKey: `p03-live-inspect-a-${Date.now()}`,
      boxId: state.boxAId,
    });
    if (inspected.ok) {
      boxA = inspected.value;
      line("boxA.reused", {
        boxId: boxA.boxId,
        state: boxA.state,
        readiness: boxA.readiness,
      });
    }
  }
  if (boxA === undefined) {
    for (const candidate of createCandidates) {
      const opKey = `p03-live-create-a-${candidate.label}`;
      if (state.idemA === undefined || state.candidateA !== candidate.label) {
        // A different body under the same key is refused by both the adapter
        // and the provider — mint a fresh key per distinct request body.
        state.idemA = randomUUID();
        state.candidateA = candidate.label;
        saveState(state);
      }
      const created = await adapter.createBox({
        operationKey: opKey,
        idempotencyKey: state.idemA,
        config: candidate.config,
      });
      if (!created.ok) {
        line("boxA.createFailed", {
          candidate: candidate.label,
          error: `${created.error.code ?? created.error.kind}: ${created.error.message}`,
          httpStatus: created.error.status ?? null,
          uncertain: created.uncertain,
        });
        if (created.uncertain) {
          line("gate.fatal", {
            error:
              "create outcome uncertain — manual reconcile required; not retrying blindly",
          });
          process.exitCode = 1;
          return;
        }
        continue;
      }
      boxA = created.value;
      state.boxAId = boxA.boxId;
      saveState(state);
      line("boxA.created", {
        candidate: candidate.label,
        boxId: boxA.boxId,
        state: boxA.state,
        environment: boxA.environment ?? null,
      });
      break;
    }
  }
  if (boxA === undefined || state.candidateA === undefined) {
    line("gate.fatal", { error: "all create candidates failed" });
    process.exitCode = 1;
    return;
  }
  result["boxAId"] = boxA.boxId;

  // Repeat the IDENTICAL create (same opKey → same persisted key + body):
  // the provider must return the same Box, not a second billable one.
  const winningCandidate = createCandidates.find(
    (c) => c.label === state.candidateA,
  );
  if (winningCandidate !== undefined && state.idemA !== undefined) {
    const replay = await adapter.createBox({
      operationKey: `p03-live-create-a-${winningCandidate.label}`,
      idempotencyKey: state.idemA,
      config: winningCandidate.config,
    });
    line("boxA.idempotentReplay", {
      ok: replay.ok,
      sameBoxId: replay.ok ? replay.value.boxId === boxA.boxId : null,
      originalBoxId: boxA.boxId,
      replayedBoxId: replay.ok ? replay.value.boxId : null,
    });
    result["idempotentCreateSameBox"] = replay.ok
      ? replay.value.boxId === boxA.boxId
      : false;
    if (replay.ok && replay.value.boxId !== boxA.boxId) {
      // A second box leaked through — record and clean it up immediately.
      await adapter.deleteBox({
        operationKey: `p03-live-delete-stray-${Date.now()}`,
        boxId: replay.value.boxId,
        waitMs: 3 * 60_000,
      });
    }
  }

  // ---------- 3. readiness + inherited-credential absence ----------
  const ready = await adapter.waitForReady(boxA.boxId, {
    timeoutMs: 8 * 60_000,
  });
  if (ready.readiness !== "usable") {
    line("gate.fatal", {
      error: `box A not usable: ${ready.readiness}`,
      detail: ready.detail ?? null,
    });
    process.exitCode = 1;
    return;
  }
  boxA = ready.box;
  line("boxA.ready", {
    boxId: boxA.boxId,
    state: boxA.state,
    ms: Date.now() - startedAt,
  });

  const presence = await runShell(client, boxA.boxId, PRESENCE_SCRIPT);
  const presenceEntries = presence.stdout
    .split("\n")
    .filter((l) => l.includes(":present") || l.includes(":absent"));
  const anyPresent = presenceEntries.filter((l) => l.endsWith(":present"));
  line("boxA.presence", {
    ok: presence.ok,
    clean: anyPresent.length === 0,
    presentEntries: anyPresent,
    meta: presence.stdout
      .split("\n")
      .filter((l) => /^(home|user|arch):/.test(l)),
    error: presence.error ?? null,
  });
  result["presenceCleanAtBirth"] = anyPresent.length === 0;

  // Adopt the real box $HOME for the gate workspace — everything that must
  // survive pause/resume lives there (/tmp is wiped by archiving).
  const homeLine = presence.stdout
    .split("\n")
    .find((l) => l.startsWith("home:"));
  const boxHome = homeLine?.slice("home:".length).trim();
  if (typeof boxHome === "string" && boxHome.startsWith("/")) {
    GATE_DIR = `${boxHome}/opensquad-gate`;
    BUNDLE_DIR = `${GATE_DIR}/bundle`;
    line("boxA.gateDir", { gateDir: GATE_DIR });
  }

  const toolchain = await runShell(client, boxA.boxId, TOOLCHAIN_SCRIPT);
  line("boxA.toolchain", {
    ok: toolchain.ok,
    lines: toolchain.stdout
      .split("\n")
      .filter((l) => l.length > 0)
      .slice(0, 30),
  });

  // ---------- 4. bootstrap Node 24.21.0 + codex 0.154.0 ----------
  const nodeDir = `$HOME/.local/node-v${NODE_VERSION}`;
  const nodeBinDir = `${nodeDir}/bin`;
  const codexBin = `${nodeBinDir}/codex`;
  const bootstrapScript = [
    "set -u",
    `mkdir -p "$HOME/.local" "${GATE_DIR}"`,
    `if [ ! -x "${nodeDir}/bin/node" ]; then`,
    '  ARCH="$(uname -m)"',
    '  case "$ARCH" in x86_64|amd64) NA=x64;; aarch64|arm64) NA=arm64;; *) echo "unsupported arch: $ARCH" >&2; exit 1;; esac',
    "  cd /tmp",
    `  URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-$NA.tar.gz"`,
    '  if command -v curl >/dev/null 2>&1; then curl -fsSL "$URL" -o node.tgz;',
    '  elif command -v wget >/dev/null 2>&1; then wget -q "$URL" -O node.tgz;',
    '  else echo "no curl/wget available" >&2; exit 1; fi',
    `  rm -rf "${nodeDir}"; mkdir -p "${nodeDir}"`,
    `  tar -xzf node.tgz -C "${nodeDir}" --strip-components=1`,
    "fi",
    `export PATH="${nodeBinDir}:$PATH"`,
    "node --version",
    "npm --version",
    // Use the preinstalled codex when it already matches the pin; otherwise
    // install the pinned wrapper into the node prefix.
    `if ! codex --version 2>/dev/null | grep -q "${CODEX_VERSION}"; then`,
    `  npm install -g @openai/codex@${CODEX_VERSION}`,
    "fi",
    "codex --version",
    'echo "codexpath:$(command -v codex)"',
  ].join("\n");

  const bootstrap = await adapter.bootstrap({
    operationKey: "p03-live-bootstrap-a",
    boxId: boxA.boxId,
    spec: { command: bootstrapScript, timeoutSeconds: 600 },
    timeoutMs: 10 * 60_000,
    pollIntervalMs: 5_000,
  });
  if (!bootstrap.ok) {
    line("gate.fatal", {
      error: `bootstrap failed: ${bootstrap.error.message}`,
      record: bootstrap.record.lastError ?? null,
    });
    process.exitCode = 1;
    return;
  }
  const bootOut = bootstrap.value.stdoutTail ?? "";
  const codexVersionLine = bootOut
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("codex-cli"))
    .at(-1);
  const codexPathLine = bootOut
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("codexpath:"))
    .at(-1);
  const nodeVersionLine = bootOut
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("v"))
    .at(0);
  line("boxA.bootstrap", {
    exitCode: bootstrap.value.exitCode,
    nodeVersion: nodeVersionLine ?? null,
    codexVersion: codexVersionLine ?? null,
    stderrTail: (bootstrap.value.stderrTail ?? "").slice(-400),
  });
  result["nodeVersionInBox"] = nodeVersionLine ?? null;
  result["codexVersionInBox"] = codexVersionLine ?? null;
  const resolvedCodexBin =
    codexPathLine !== undefined
      ? codexPathLine.slice("codexpath:".length).trim()
      : codexBin;
  state.codexBinInBox = resolvedCodexBin;
  state.nodeBinDir = nodeBinDir;
  saveState(state);
  line("boxA.codexBin", { codexBin: resolvedCodexBin });

  // generate-ts inside the Box must match the committed generated types.
  // NOTE: `find | sort` order differs between GNU and BSD `sort` locales —
  // sort the "hash path" lines canonically (LC_ALL=C, by filename) so the
  // combined hash compares content, not collation. Verified live: in-box
  // codex 0.154.0 (Linux) emits byte-identical types to the committed set.
  const genHashCmd =
    `export PATH="${nodeBinDir}:$PATH" && cd "${GATE_DIR}" && ` +
    `rm -rf gen-check && codex app-server generate-ts --out gen-check >/dev/null 2>&1 && ` +
    `cd gen-check && find . -type f -name '*.ts' -exec sha256sum {} + | LC_ALL=C sort -k2 | sha256sum | cut -d' ' -f1 && ` +
    `find . -type f -name '*.ts' | wc -l`;
  const genHash = await runShell(client, boxA.boxId, genHashCmd, {
    timeoutSeconds: 120,
  });
  const genLines = genHash.stdout.split("\n").filter((l) => l.length > 0);
  const remoteHash = genLines[0] ?? null;
  const remoteCount = genLines[1] ?? null;
  let localHash: string | null = null;
  try {
    const { execFileSync } = await import("node:child_process");
    localHash = execFileSync(
      "sh",
      [
        "-c",
        `cd "${join(WORKER_ROOT, "src/generated/codex")}" && find . -type f -name '*.ts' -exec shasum -a 256 {} + | LC_ALL=C sort -k2 | shasum -a 256 | cut -d' ' -f1`,
      ],
      { encoding: "utf8" },
    ).trim();
  } catch (err) {
    line("gate.warn", {
      error: `local generate-ts hash failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  line("boxA.generateTsMatch", {
    remoteHash,
    localHash,
    match: remoteHash !== null && remoteHash === localHash,
    remoteFileCount: remoteCount,
  });
  result["generateTsMatch"] = remoteHash !== null && remoteHash === localHash;

  // ---------- 5. upload bundle + start gate probe ----------
  await uploadBundle(client, boxA.boxId);

  const probe = await startProbe(client, boxA.boxId, "gate", {
    nodeBinDir,
    codexBin: resolvedCodexBin,
  });
  if (!probe.ok) {
    line("gate.fatal", { error: `probe start failed: ${probe.error}` });
    process.exitCode = 1;
    return;
  }
  line("boxA.probeStarted", { processId: probe.processId });

  let watched = await watchGateStatus(client, boxA.boxId, {
    deadlineMs: LOGIN_WAIT_BUDGET_MS + 10 * 60_000,
    label: "gate",
    phase: "gate",
  });
  // One retry if the app-server child died immediately after spawn
  // (observed once as a transient "stdout closed" right after box birth).
  const earlyDeathError =
    watched.status !== undefined &&
    watched.status["done"] === true &&
    watched.status["account"] === undefined &&
    typeof watched.status["error"] === "string" &&
    watched.status["error"].includes("app-server closed")
      ? watched.status["error"]
      : undefined;
  if (earlyDeathError !== undefined) {
    line("boxA.probeRetry", { reason: earlyDeathError });
    const retry = await startProbe(client, boxA.boxId, "gate", {
      nodeBinDir,
      codexBin: resolvedCodexBin,
    });
    if (retry.ok) {
      watched = await watchGateStatus(client, boxA.boxId, {
        deadlineMs: LOGIN_WAIT_BUDGET_MS + 10 * 60_000,
        label: "gateRetry",
        phase: "gate",
      });
    }
  }
  const gateStatus = watched.status;
  result["gateStatus"] = gateStatus ?? null;
  if (gateStatus !== undefined) {
    const turn = gateStatus["turn"];
    if (isRecord(turn)) {
      result["turn"] = {
        threadId: turn["threadId"],
        turnId: turn["turnId"],
        model: turn["model"],
        status: turn["status"],
        agentMessages: turn["agentMessages"],
      };
    }
  }
  writeLiveGateStatus({
    phase: "gate-probe-finished",
    boxId: boxA.boxId,
    done: gateStatus?.["done"] === true,
    stage: gateStatus?.["stage"] ?? "timeout",
    account: gateStatus?.["account"] ?? null,
    turn: result["turn"] ?? null,
  });

  // ---------- 7. marker + pause/resume ----------
  const markerContent = `opensquad-p03-marker-${randomUUID()}`;
  const markerPath = `${GATE_DIR}/marker.txt`;
  const markerWrite = await client.writeFile(
    boxA.boxId,
    markerPath,
    markerContent,
    "utf8",
  );
  line("boxA.markerWrite", { ok: markerWrite.ok });
  state.markerPath = markerPath;
  state.markerContent = markerContent;
  saveState(state);

  const paused = await adapter.pauseBox({
    operationKey: "p03-live-stop-a-pause",
    boxId: boxA.boxId,
    waitForArchivedMs: 6 * 60_000,
  });
  line("boxA.paused", {
    ok: paused.ok,
    state: paused.ok ? paused.value.state : null,
    error: paused.ok ? null : paused.error.message,
  });
  result["pausedToArchived"] =
    paused.ok && paused.value.readiness === "archived";

  const resumed = await adapter.resumeBox({
    operationKey: "p03-live-resume-a",
    boxId: boxA.boxId,
    ttlSeconds: BOX_TTL_SECONDS,
    wait: { timeoutMs: 8 * 60_000 },
  });
  line("boxA.resumed", {
    ok: resumed.ok,
    state: resumed.ok ? resumed.value.state : null,
    error: resumed.ok ? null : resumed.error.message,
  });
  result["resumed"] = resumed.ok;
  if (resumed.ok) {
    const marker = await client.readFile(boxA.boxId, markerPath);
    const markerOk =
      marker.ok && marker.value["content"] === markerContent;
    line("boxA.markerVerify", { ok: markerOk });
    result["markerPersisted"] = markerOk;

    // Post-resume probe: managed-login survival + thread/resume + second
    // bounded turn on the resumed thread.
    const post = await startProbe(client, boxA.boxId, "post-resume", {
      nodeBinDir,
      codexBin: resolvedCodexBin,
    });
    if (post.ok) {
      const postWatch = await watchGateStatus(client, boxA.boxId, {
        deadlineMs: 15 * 60_000,
        label: "postResume",
        phase: "post-resume",
      });
      result["postResumeStatus"] = postWatch.status ?? null;
      const postTurn = postWatch.status?.["turn"];
      if (isRecord(postTurn)) {
        result["resumedTurn"] = {
          threadId: postTurn["threadId"],
          turnId: postTurn["turnId"],
          status: postTurn["status"],
        };
      }
      const postAccount = postWatch.status?.["account"];
      result["loginSurvivedResume"] =
        isRecord(postAccount) && postAccount["state"] === "chatgpt";
    } else {
      result["postResumeStatus"] = { error: post.error };
    }
  }

  // ---------- 8. second-box isolation ----------
  if (state.idemB === undefined) {
    state.idemB = randomUUID();
    saveState(state);
  }
  const createdB = await adapter.createBox({
    operationKey: "p03-live-create-b-ttl3600",
    idempotencyKey: state.idemB,
    config: { noEnv: true, ttlSeconds: FALLBACK_TTL_SECONDS, type: "small" },
  });
  if (!createdB.ok) {
    line("boxB.createFailed", {
      error: `${createdB.error.code ?? createdB.error.kind}: ${createdB.error.message}`,
    });
    result["boxB"] = { created: false };
  } else {
    state.boxBId = createdB.value.boxId;
    saveState(state);
    line("boxB.created", { boxId: createdB.value.boxId });
    const readyB = await adapter.waitForReady(createdB.value.boxId, {
      timeoutMs: 8 * 60_000,
    });
    if (readyB.readiness !== "usable") {
      line("boxB.notReady", { readiness: readyB.readiness });
      result["boxB"] = { created: true, ready: false };
    } else {
      const isolationScript = [
        PRESENCE_SCRIPT,
        `if [ -e "${markerPath}" ]; then echo "marker:present"; else echo "marker:absent"; fi`,
        `if [ -d "${GATE_DIR}" ]; then echo "gatedir:present"; else echo "gatedir:absent"; fi`,
        'if command -v codex >/dev/null 2>&1; then echo "codex:present"; else echo "codex:absent"; fi',
      ].join("\n");
      const iso = await runShell(client, createdB.value.boxId, isolationScript);
      const isoLines = iso.stdout.split("\n").filter((l) => l.length > 0);
      // A present `codex` binary is base-image parity, not shared state.
      // Real leaks = credential env/files, our marker, our gate directory.
      const leaks = isoLines.filter(
        (l) =>
          l.endsWith(":present") &&
          /^(env|path|marker|gatedir):/.test(l),
      );
      line("boxB.isolation", {
        ok: iso.ok,
        leaks,
        isolated: leaks.length === 0,
        meta: isoLines.filter((l) => /^(home|user|arch):/.test(l)),
      });
      result["boxB"] = {
        created: true,
        ready: true,
        isolated: leaks.length === 0,
        leaks,
      };
    }
  }

  // ---------- 9. cleanup ----------
  writeLiveGateStatus({ phase: "cleanup" });
  await cleanupBox(adapter, state, "B");
  await cleanupBox(adapter, state, "A");

  const remaining = await client.listBoxes({ limit: 50 });
  if (remaining.ok) {
    const boxes = remaining.value.boxes;
    const active = boxes.filter(
      (b) => !["archived", "error"].includes(String(b.state)),
    ).length;
    line("cleanup.remainingBoxes", {
      total: boxes.length,
      active,
    });
    result["remainingActiveBoxes"] = active;
  }

  result["durationMs"] = Date.now() - startedAt;
  writeFileSync(RESULT_OUT, JSON.stringify(result, null, 2));
  writeLiveGateStatus({ phase: "finished" });
  line("gate.end", {
    durationMs: Date.now() - startedAt,
    resultPath: RESULT_OUT,
  });
}

await main();
