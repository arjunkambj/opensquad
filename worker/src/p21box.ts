// Host-side P21 runtime driver. Runs on the BUILDER machine — never inside
// the Box — and puts the PRODUCTION worker daemon (`dist/main.js`) into one
// disposable ASCII Box bound to a real deployment bridge, mirroring
// p04gate.ts (P04) and livegate.ts (P03). This is diagnostic machinery: the
// employee image ships none of it, and worker delivery is the manual half of
// provisioning until a named worker snapshot exists (`listNamedSnapshots`
// returns none today — recorded in plan/evidence/P21.md).
//
// Two provisioning shapes:
//
//   up      — the driver creates the Box itself. The four OPENSQUAD_* values
//             (bridge URL, runtime connection id, generation, worker token)
//             come from `worker/.p21box/worker.env` — populated from a
//             `workerOperations:devSeedSalesMission` run — and are written
//             into the Box as worker.env AFTER create, so no credential ever
//             rides inside a provider request body or a fingerprinted
//             config.
//
//   adopt   — record a Box `runtimeConnections.connect` already provisioned:
//             the backend minted + sealed + injected the credential itself
//             and wrote /etc/opensquad/worker.env. The driver reconstructs
//             the env file INSIDE the Box from `printenv` (falling back to
//             reading that file) — token values never leave the Box or
//             appear on a command line.
//
// Subcommands:
//   up         create box (persisted idempotency key), wait ready
//   adopt ID   adopt an existing connect-provisioned box
//   bootstrap  presence/toolchain check → Node 24.21.0 + @openai/codex
//              0.154.0 → upload the dependency-free dist bundle → worker.env
//   start      launch `node bundle/main.js` detached, record the processId
//   status     box state + daemon stdout tail (sanitized: env VALUES never)
//   bridge     host-side reachability probe — POST /worker/claim with no
//              token must answer 401, not a network error
//   stop       archive the box (pause; billing for the box stops)
//   down       delete the box (confirm-header path), verify GET /boxes empty
//
// Local state: worker/.p21box/ (untracked). Env values: worker/.p21box/
// worker.env (untracked, never committed, never echoed to stdout).

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
const STATE_DIR = join(WORKER_ROOT, ".p21box");
const STATE_PATH = join(STATE_DIR, "state.json");
const OPS_PATH = join(STATE_DIR, "operations.json");
const ENV_IN = join(STATE_DIR, "worker.env");

const NODE_VERSION = "24.21.0";
const CODEX_VERSION = "0.154.0";
// Trial accounts cap a Box at two hours (plan/integrations.md); the driver
// default honours that ceiling. Paid accounts can pass --ttl.
const BOX_TTL_SECONDS = Number(process.env.P21BOX_TTL_SECONDS ?? 7200);

// The daemon's own module set — every file `dist/main.js` reaches by static
// import. The production worker has ZERO runtime npm dependencies (verified:
// only node:* and relative imports), so no node_modules is shipped.
const BUNDLE_FILES = [
  "main.js",
  "daemon.js",
  "bridge.js",
  "contracts.js",
  "config.js",
  "envcheck.js",
  "ids.js",
  "codex/appserver.js",
  "codex/methods.js",
  "codex/toolRouter.js",
] as const;

// In-Box workspace, adopted from the box's real $HOME after first contact
// (P03 verified /tmp does not survive archiving).
let GATE_DIR = "/home/user/opensquad-runtime";
let BUNDLE_DIR = `${GATE_DIR}/worker`;

function line(kind: string, data: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ kind, ...data })}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function argOf(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

/** Read one name from process.env or an untracked env file — values are
 *  used, never printed. */
function readEnvFileKey(name: string): string | undefined {
  const fromEnv = process.env[name];
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  for (const path of [ENV_IN, join(REPO_ROOT, ".env.local")]) {
    if (!existsSync(path)) continue;
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
      if (value.length > 0) return value;
    }
  }
  return undefined;
}

const WORKER_ENV_NAMES = [
  "OPENSQUAD_BRIDGE_URL",
  "OPENSQUAD_RUNTIME_ID",
  "OPENSQUAD_RUNTIME_GENERATION",
  "OPENSQUAD_WORKER_TOKEN",
] as const;

/** Optional pass-throughs written into worker.env when present locally. */
const OPTIONAL_ENV_NAMES = [
  "OPENSQUAD_CODEX_BIN",
  "OPENSQUAD_CODEX_SANDBOX",
  "OPENSQUAD_WORK_DIR",
] as const;

/** Collect the worker env for a driver-created box. Missing names abort —
 *  a box without its credential can never claim. */
function collectWorkerEnv(): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of WORKER_ENV_NAMES) {
    const value = readEnvFileKey(name);
    if (value === undefined) missing.push(name);
    else env[name] = value;
  }
  for (const name of OPTIONAL_ENV_NAMES) {
    const value = readEnvFileKey(name);
    if (value !== undefined) env[name] = value;
  }
  if (missing.length > 0) {
    line("env.missing", {
      missing,
      hint: `write them to ${ENV_IN} (one NAME=value per line)`,
    });
    return undefined;
  }
  return env;
}

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

type DriverState = {
  idem?: string;
  boxId?: string;
  adopted?: boolean;
  codexBinInBox?: string;
  nodeBinDir?: string;
  gateDir?: string;
  daemonProcessId?: number;
  boxDeleted?: boolean;
};

/** GATE_DIR is discovered at bootstrap time and persisted — later driver
 *  invocations are separate processes and must not guess the box's $HOME. */
function gateDir(state: DriverState): string {
  return state.gateDir ?? "/home/user/opensquad-runtime";
}
function bundleDir(state: DriverState): string {
  return `${gateDir(state)}/worker`;
}

function loadState(): DriverState {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as DriverState;
  } catch {
    return {};
  }
}

function saveState(state: DriverState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

type ShellResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

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

// Presence-only hygiene probe — names only, never values (same contract as
// envcheck.ts inside the worker).
const PRESENCE_SCRIPT = [
  'for n in OPENAI_API_KEY OPENAI_KEY CODEX_API_KEY CODEX_AUTH_TOKEN CHATGPT_ACCESS_TOKEN ASCII_API_KEY AGENTMAIL_API_KEY AGENTMAIL_WEBHOOK_SECRET FIRECRAWL_API_KEY FIRECRAWL_WEBHOOK_SECRET CONVEX_DEPLOY_KEY HEXCLAVE_SECRET_SERVER_KEY GITHUB_TOKEN GH_TOKEN; do if printenv "$n" >/dev/null 2>&1; then echo "env:$n:present"; else echo "env:$n:absent"; fi; done',
  'for p in "$HOME/.codex/auth.json" "$HOME/.codex/credentials" "$HOME/.ssh/id_rsa" "$HOME/.ssh/id_ed25519" "$HOME/.git-credentials" "$HOME/.config/gh/hosts.yml" "$HOME/.agentmail/credentials"; do if [ -e "$p" ]; then echo "path:${p#$HOME/}:present"; else echo "path:${p#$HOME/}:absent"; fi; done',
  'echo "home:$HOME"; echo "user:$(id -un)"; echo "arch:$(uname -m)"',
].join("\n");

const TOOLCHAIN_SCRIPT = [
  'echo "os:$(head -1 /etc/os-release 2>/dev/null)"',
  "for c in node npm npx codex git curl wget tar xz sha256sum shasum bash; do if command -v $c >/dev/null 2>&1; then echo \"have:$c\"; else echo \"missing:$c\"; fi; done",
  "node --version 2>/dev/null || echo no-node",
  "codex --version 2>/dev/null || echo no-codex",
].join("\n");

async function uploadBundle(
  client: AsciiBoxClient,
  boxId: string,
): Promise<void> {
  await runShell(client, boxId, `mkdir -p "${BUNDLE_DIR}/codex" "${GATE_DIR}"`);
  for (const f of BUNDLE_FILES) {
    const content = readFileSync(join(DIST_DIR, f), "utf8");
    const res = await client.writeFile(boxId, `${BUNDLE_DIR}/${f}`, content, "utf8");
    if (!res.ok) {
      throw new Error(
        `upload ${f} failed: ${res.error.code ?? res.error.kind}: ${res.error.message}`,
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
  line("bundle.uploaded", { files: BUNDLE_FILES.length + 1 });
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function cmdUp(adapter: BoxLifecycleAdapter) {
  const state = loadState();
  // Fail before spending: a box without a complete staged env can never
  // start a worker that claims.
  const env = collectWorkerEnv();
  if (env === undefined) {
    process.exitCode = 1;
    return;
  }
  const config: BoxCreateConfig = {
    noEnv: true,
    ttlSeconds: BOX_TTL_SECONDS,
    type: "small",
  };
  let box: BoxFacts | undefined;
  if (state.boxId !== undefined && state.boxDeleted !== true) {
    const inspected = await adapter.inspectBox({
      operationKey: `p21-inspect-${Date.now()}`,
      boxId: state.boxId,
    });
    if (inspected.ok) {
      box = inspected.value;
      line("box.reused", { boxId: box.boxId, state: box.state });
    }
  }
  if (box === undefined) {
    if (state.idem === undefined) {
      state.idem = randomUUID();
      saveState(state);
    }
    const created = await adapter.createBox({
      operationKey: "p21-create-a",
      idempotencyKey: state.idem,
      config,
    });
    if (!created.ok) {
      line("box.createFailed", {
        error: `${created.error.code ?? created.error.kind}: ${created.error.message}`,
        uncertain: created.uncertain,
      });
      process.exitCode = 1;
      return;
    }
    box = created.value;
    state.boxId = box.boxId;
    state.adopted = false;
    saveState(state);
    line("box.created", { boxId: box.boxId, state: box.state });
  }

  const ready = await adapter.waitForReady(box.boxId, { timeoutMs: 8 * 60_000 });
  if (ready.readiness !== "usable") {
    line("box.notReady", { readiness: ready.readiness, detail: ready.detail });
    process.exitCode = 1;
    return;
  }
  line("up.done", { boxId: box.boxId });
}

/** Adopt a Box the backend's own `connect` provisioned — the sealed
 *  credential and env injection are already its work. */
async function cmdAdopt(adapter: BoxLifecycleAdapter) {
  const boxId = process.argv[3] ?? argOf("box");
  if (boxId === undefined) {
    line("adopt.usage", { usage: "node dist/p21box.js adopt <boxId>" });
    process.exitCode = 1;
    return;
  }
  const inspected = await adapter.inspectBox({
    operationKey: `p21-adopt-inspect-${Date.now()}`,
    boxId,
  });
  if (!inspected.ok) {
    line("adopt.inspectFailed", {
      error: `${inspected.error.code ?? inspected.error.kind}: ${inspected.error.message}`,
    });
    process.exitCode = 1;
    return;
  }
  const state = loadState();
  state.boxId = boxId;
  state.adopted = true;
  state.boxDeleted = false;
  saveState(state);
  line("adopt.done", { boxId, state: inspected.value.state });
}

/** Host-side reachability probe: POST /worker/claim with no credential must
 *  answer 401 UNAUTHENTICATED — proving the site endpoint serves the bridge
 *  before a box is ever asked to reach it. */
async function cmdBridge() {
  const bridgeUrl = readEnvFileKey("OPENSQUAD_BRIDGE_URL");
  if (bridgeUrl === undefined) {
    line("bridge.noUrl", { hint: `set OPENSQUAD_BRIDGE_URL in ${ENV_IN}` });
    process.exitCode = 1;
    return;
  }
  try {
    const res = await fetch(`${bridgeUrl.replace(/\/+$/, "")}/worker/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    line("bridge.probe", { status: res.status, expect: 401 });
  } catch (error) {
    line("bridge.unreachable", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}

async function cmdBootstrap(client: AsciiBoxClient, adapter: BoxLifecycleAdapter) {
  const state = loadState();
  if (state.boxId === undefined) {
    line("bootstrap.noBox", { hint: "run `up` or `adopt` first" });
    process.exitCode = 1;
    return;
  }
  const boxId = state.boxId;

  const presence = await runShell(client, boxId, PRESENCE_SCRIPT);
  const entries = presence.stdout
    .split("\n")
    .filter((l) => l.includes(":present") || l.includes(":absent"));
  line("box.presence", {
    clean: entries.filter((l) => l.endsWith(":present")).length === 0,
    present: entries.filter((l) => l.endsWith(":present")),
  });
  const homeLine = presence.stdout
    .split("\n")
    .find((l) => l.startsWith("home:"));
  const boxHome = homeLine?.slice("home:".length).trim();
  if (typeof boxHome === "string" && boxHome.startsWith("/")) {
    GATE_DIR = `${boxHome}/opensquad-runtime`;
    BUNDLE_DIR = `${GATE_DIR}/worker`;
    state.gateDir = GATE_DIR;
    saveState(state);
    line("box.gateDir", { gateDir: GATE_DIR });
  }

  const toolchain = await runShell(client, boxId, TOOLCHAIN_SCRIPT);
  line("box.toolchain", {
    lines: toolchain.stdout.split("\n").filter((l) => l.length > 0).slice(0, 30),
  });

  // Toolchain: Node 24.21.0 + pinned codex, user-local under $HOME/.local.
  const nodeDir = `$HOME/.local/node-v${NODE_VERSION}`;
  const nodeBinDir = `${nodeDir}/bin`;
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
    `if ! codex --version 2>/dev/null | grep -q "${CODEX_VERSION}"; then`,
    `  npm install -g @openai/codex@${CODEX_VERSION}`,
    "fi",
    "codex --version",
    'echo "codexpath:$(command -v codex)"',
  ].join("\n");

  const bootstrap = await adapter.bootstrap({
    operationKey: "p21-bootstrap-a",
    boxId,
    spec: { command: bootstrapScript, timeoutSeconds: 600 },
    timeoutMs: 10 * 60_000,
    pollIntervalMs: 5_000,
  });
  if (!bootstrap.ok) {
    line("box.bootstrapFailed", { error: bootstrap.error.message });
    process.exitCode = 1;
    return;
  }
  const bootOut = bootstrap.value.stdoutTail ?? "";
  const codexPathLine = bootOut
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("codexpath:"))
    .at(-1);
  state.codexBinInBox =
    codexPathLine !== undefined
      ? codexPathLine.slice("codexpath:".length).trim()
      : `${nodeBinDir}/codex`;
  state.nodeBinDir = nodeBinDir;
  saveState(state);
  line("box.bootstrap", {
    codexBin: state.codexBinInBox,
    tail: bootOut.split("\n").filter((l) => l.trim().length > 0).slice(-5),
  });

  await uploadBundle(client, boxId);

  // worker.env — two sources, one outcome: the file the daemon's start
  // command sources. For a driver-created box we upload the env file the
  // operator staged; for an adopted (connect-provisioned) box the values
  // were injected by the backend itself, so they are reconstructed INSIDE
  // the box — never printed, never transported to the host.
  if (state.adopted === true) {
    // Rebuild inside the box: printenv of the injected env first, then the
    // backend-written /etc/opensquad/worker.env as fallback. `missing:` lines
    // go to stderr so they can never land in a file `set -a` later sources.
    const rebuild = await runShell(
      client,
      boxId,
      [
        `mkdir -p "${GATE_DIR}"`,
        `{ for n in ${WORKER_ENV_NAMES.join(" ")}; do`,
        '  v="$(printenv "$n" 2>/dev/null || true)";',
        '  if [ -z "$v" ] && [ -f /etc/opensquad/worker.env ]; then',
        '    v="$(grep -E "^$n=" /etc/opensquad/worker.env 2>/dev/null | head -1 | cut -d= -f2- || true)";',
        "  fi;",
        '  if [ -z "$v" ]; then echo "missing:$n" >&2; else echo "$n=$v"; fi;',
        `done > "${GATE_DIR}/worker.env"`,
        `chmod 600 "${GATE_DIR}/worker.env"`,
        // Presence report only — the name column, never a value.
        `grep -oE '^OPENSQUAD_[A-Z_]+=' "${GATE_DIR}/worker.env" || true`,
      ].join("\n"),
    );
    const namesFound = rebuild.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^OPENSQUAD_[A-Z_]+=$/.test(l));
    const missing = rebuild.stderr
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^missing:/.test(l));
    line("env.rebuilt", { namesFound, missing });
    if (namesFound.length < WORKER_ENV_NAMES.length) {
      line("env.rebuildIncomplete", {
        note: "adopted box exposed neither the injected env nor /etc/opensquad/worker.env to commands — the worker cannot start without its credential",
      });
      process.exitCode = 1;
      return;
    }
  } else {
    const env = collectWorkerEnv();
    if (env === undefined) {
      process.exitCode = 1;
      return;
    }
    // CODEX_BIN resolves to the just-installed pin unless overridden.
    if (env["OPENSQUAD_CODEX_BIN"] === undefined) {
      env["OPENSQUAD_CODEX_BIN"] = state.codexBinInBox ?? "codex";
    }
    if (env["OPENSQUAD_WORK_DIR"] === undefined) {
      env["OPENSQUAD_WORK_DIR"] = `${GATE_DIR}/work`;
    }
    const content =
      Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n";
    const written = await client.writeFile(
      boxId,
      `${GATE_DIR}/worker.env`,
      content,
      "utf8",
    );
    if (!written.ok) {
      line("env.writeFailed", { error: written.error.message });
      process.exitCode = 1;
      return;
    }
    await runShell(client, boxId, `chmod 600 "${GATE_DIR}/worker.env"`);
    line("env.written", {
      names: Object.keys(env),
    });
  }
  line("bootstrap.done", { boxId, gateDir: GATE_DIR });
}

async function cmdStart(client: AsciiBoxClient) {
  const state = loadState();
  if (state.boxId === undefined) {
    line("start.noBox", { hint: "run `up`/`adopt` then `bootstrap` first" });
    process.exitCode = 1;
    return;
  }
  const gate = gateDir(state);
  const bundle = bundleDir(state);
  const boxHome = gate.replace(/\/opensquad-runtime.*$/, "");
  const nodeBinDir =
    state.nodeBinDir ?? `${boxHome}/.local/node-v${NODE_VERSION}/bin`;
  // A start script keeps the token off every command line and the daemon's
  // stdout in a file `status` can read back — a detached command's buffer is
  // not the place for a long-lived service's log.
  const script = [
    "#!/bin/sh",
    "set -a",
    `. "${gate}/worker.env"`,
    "set +a",
    `export PATH="${nodeBinDir}:$PATH"`,
    `cd "${bundle}"`,
    `exec node "${bundle}/main.js" >> "${gate}/daemon.log" 2>&1`,
    "",
  ].join("\n");
  const uploaded = await client.writeFile(
    state.boxId,
    `${gate}/start-worker.sh`,
    script,
    "utf8",
  );
  if (!uploaded.ok) {
    line("start.scriptUploadFailed", { error: uploaded.error.message });
    process.exitCode = 1;
    return;
  }
  const res = await client.runCommand(state.boxId, {
    command: `sh "${gate}/start-worker.sh"`,
    detached: true,
  });
  if (!res.ok) {
    line("start.failed", {
      error: `${res.error.code ?? res.error.kind}: ${res.error.message}`,
    });
    process.exitCode = 1;
    return;
  }
  const v: unknown = res.value;
  if (
    isRecord(v) &&
    v["type"] === "command.started" &&
    typeof v["processId"] === "number"
  ) {
    state.daemonProcessId = v["processId"];
    saveState(state);
    line("start.daemon", { processId: state.daemonProcessId });
    return;
  }
  line("start.unexpected", { response: v });
  process.exitCode = 1;
}

/** Daemon log tail + box state. The daemon's own log lines carry event
 *  names and ids only — no env values — so the tail is safe to print. */
async function cmdStatus(client: AsciiBoxClient) {
  const state = loadState();
  if (state.boxId === undefined) {
    line("status.noBox", {});
    process.exitCode = 1;
    return;
  }
  const inspected = await client.inspectBox(state.boxId);
  if (inspected.ok) {
    line("box.state", {
      boxId: state.boxId,
      state: inspected.value.box.state,
    });
  }
  const log = await client.readFile(
    state.boxId,
    `${gateDir(state)}/daemon.log`,
  );
  if (log.ok && typeof log.value["content"] === "string") {
    line("daemon.logTail", { tail: log.value["content"].slice(-4000) });
  } else {
    line("daemon.logUnread", {
      error: log.ok ? "no content" : log.error.message,
    });
  }
  if (state.daemonProcessId !== undefined) {
    const status = await client.commandStatus(
      state.boxId,
      state.daemonProcessId,
      1024,
    );
    if (status.ok) {
      line("daemon.status", {
        type: status.value.type,
        status: status.value.status,
        exitCode: status.value.exitCode,
      });
    }
  }
}

async function cmdStop(adapter: BoxLifecycleAdapter) {
  const state = loadState();
  if (state.boxId === undefined) {
    line("stop.noBox", {});
    process.exitCode = 1;
    return;
  }
  const stopped = await adapter.pauseBox({
    operationKey: `p21-stop-${Date.now()}`,
    boxId: state.boxId,
  });
  line("box.stop", {
    ok: stopped.ok,
    ...(stopped.ok ? {} : { error: stopped.error.message }),
  });
}

async function cmdDown(client: AsciiBoxClient, adapter: BoxLifecycleAdapter) {
  const state = loadState();
  if (state.boxId === undefined || state.boxDeleted === true) {
    line("down.nothing", {});
    return;
  }
  const deleted = await adapter.deleteBox({
    operationKey: `p21-delete-${Date.now()}`,
    boxId: state.boxId,
  });
  if (!deleted.ok) {
    line("box.deleteFailed", { error: deleted.error.message });
    process.exitCode = 1;
    return;
  }
  state.boxDeleted = true;
  saveState(state);
  const remaining = await client.listBoxes({ limit: 20 });
  line("down.done", {
    boxId: state.boxId,
    boxesRemaining: remaining.ok
      ? (remaining.value as { boxes?: unknown[] }).boxes?.length ?? "unknown"
      : "list-failed",
  });
}

async function main(): Promise<void> {
  const apiKey = readEnvFileKey("ASCII_API_KEY");
  if (apiKey === undefined) {
    line("noApiKey", { hint: "ASCII_API_KEY in env or .env.local" });
    process.exit(1);
  }
  const client = new AsciiBoxClient(apiKey);
  const adapter = new BoxLifecycleAdapter(
    client,
    new JsonFileBoxOperationStore(OPS_PATH),
  );
  const cmd = process.argv[2];
  switch (cmd) {
    case "up":
      await cmdUp(adapter);
      return;
    case "adopt":
      await cmdAdopt(adapter);
      return;
    case "bridge":
      await cmdBridge();
      return;
    case "bootstrap":
      await cmdBootstrap(client, adapter);
      return;
    case "start":
      await cmdStart(client);
      return;
    case "status":
      await cmdStatus(client);
      return;
    case "stop":
      await cmdStop(adapter);
      return;
    case "down":
      await cmdDown(client, adapter);
      return;
    default:
      line("usage", {
        commands: [
          "up",
          "adopt <boxId>",
          "bridge",
          "bootstrap",
          "start",
          "status",
          "stop",
          "down",
        ],
        envFile: ENV_IN,
      });
      process.exitCode = cmd === undefined ? 0 : 1;
  }
}

await main();
