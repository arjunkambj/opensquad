// Host-side P04 gate driver. Runs on the BUILDER machine — never inside the
// Box — and drives ONE disposable diagnostic Box through the real ASCII API
// using the committed adapter/client, mirroring livegate.ts (P03).
//
// Subcommands:
//   up      — create the diagnostic Box (persisted idempotency key), wait
//             ready, presence+toolchain check, bootstrap Node 24.21.0 +
//             @openai/codex@0.154.0, upload the compiled bundle.
//   auth    — start `boxmcp --phase auth` detached; relay the Apollo OAuth
//             authorization URL to worker/P04_AUTH_STATUS.json + stdout THE
//             MOMENT it appears; while waiting, poll local
//             worker/P04_CALLBACK_URL.txt (the owner's pasted post-redirect
//             URL) and push it into the Box as callback-url.txt for the
//             in-Box loopback relay; finish by pulling apollo-tools.json.
//   call    — `node p04gate.js call --tool <name> --args '<json>' --label L`
//             runs ONE bounded tool call in the Box and pulls call-L.json.
//   list    — direct MCP tools/list fallback capture (apollo-tools-direct.json)
//   token   — presence-only .credentials.json inspection (token-inspect.json)
//   status  — print current in-Box probe status file
//   down    — delete the Box (confirm-header path), verify GET /boxes empty.
//
// Local state lives under worker/.p04gate/ (untracked) so the driver can be
// restarted safely: persisted idempotency keys replay the same create.

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
const STATE_DIR = join(WORKER_ROOT, ".p04gate");
const STATE_PATH = join(STATE_DIR, "state.json");
const OPS_PATH = join(STATE_DIR, "operations.json");
const AUTH_STATUS_OUT = join(WORKER_ROOT, "P04_AUTH_STATUS.json");
const CALLBACK_IN = join(WORKER_ROOT, "P04_CALLBACK_URL.txt");
const RESULTS_DIR = STATE_DIR;

const NODE_VERSION = "24.21.0";
const CODEX_VERSION = "0.154.0";
const BOX_TTL_SECONDS = 7200;
const STATUS_POLL_MS = 4_000;
// In-Box gate workspace, adopted from the box's real $HOME after the first
// presence check (P03 verified /tmp does not survive archiving).
let GATE_DIR = "/home/user/opensquad-p04";
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
  idem?: string;
  boxId?: string;
  codexBinInBox?: string;
  nodeBinDir?: string;
  boxDeleted?: boolean;
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

async function readBoxFile(
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
    { local: "boxmcp.js", remote: `${BUNDLE_DIR}/boxmcp.js` },
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
  line("bundle.uploaded", { files: files.length + 1 });
}

async function startProbe(
  client: AsciiBoxClient,
  boxId: string,
  args: string,
): Promise<{ ok: boolean; processId?: number; error?: string }> {
  const state = loadState();
  const nodeBinDir = state.nodeBinDir ?? "$HOME/.local/node-v24.21.0/bin";
  const codexBin = state.codexBinInBox ?? `${nodeBinDir}/codex`;
  const command =
    `PATH="${nodeBinDir}:$PATH" ` +
    `node "${BUNDLE_DIR}/boxmcp.js" --gate-dir "${GATE_DIR}" ` +
    `--codex-bin "${codexBin}" ${args}`;
  const res = await client.runCommand(boxId, { command, detached: true });
  if (!res.ok) {
    return {
      ok: false,
      error: `${res.error.code ?? res.error.kind}: ${res.error.message}`,
    };
  }
  const v: unknown = res.value;
  if (
    isRecord(v) &&
    v["type"] === "command.started" &&
    typeof v["processId"] === "number"
  ) {
    return { ok: true, processId: v["processId"] };
  }
  return { ok: false, error: "unexpected detached response" };
}

function writeAuthStatus(patch: Record<string, unknown>): void {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(
      readFileSync(AUTH_STATUS_OUT, "utf8"),
    ) as Record<string, unknown>;
  } catch {
    // first write
  }
  writeFileSync(
    AUTH_STATUS_OUT,
    JSON.stringify(
      { ...current, ...patch, updatedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function cmdUp(client: AsciiBoxClient, adapter: BoxLifecycleAdapter) {
  const state = loadState();
  const config: BoxCreateConfig = {
    noEnv: true,
    ttlSeconds: BOX_TTL_SECONDS,
    type: "small",
  };
  let box: BoxFacts | undefined;
  if (state.boxId !== undefined) {
    const inspected = await adapter.inspectBox({
      operationKey: `p04-inspect-${Date.now()}`,
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
      operationKey: "p04-create-a",
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
    saveState(state);
    line("box.created", { boxId: box.boxId, state: box.state });
  }

  const ready = await adapter.waitForReady(box.boxId, { timeoutMs: 8 * 60_000 });
  if (ready.readiness !== "usable") {
    line("box.notReady", { readiness: ready.readiness, detail: ready.detail });
    process.exitCode = 1;
    return;
  }
  line("box.ready", { boxId: box.boxId });

  const presence = await runShell(client, box.boxId, PRESENCE_SCRIPT);
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
    GATE_DIR = `${boxHome}/opensquad-p04`;
    BUNDLE_DIR = `${GATE_DIR}/bundle`;
    line("box.gateDir", { gateDir: GATE_DIR });
  }

  const toolchain = await runShell(client, box.boxId, TOOLCHAIN_SCRIPT);
  line("box.toolchain", {
    lines: toolchain.stdout.split("\n").filter((l) => l.length > 0).slice(0, 30),
  });

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
    operationKey: "p04-bootstrap-a",
    boxId: box.boxId,
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

  await uploadBundle(client, box.boxId);
  line("up.done", { boxId: box.boxId, gateDir: GATE_DIR });
}

/** Watch the auth phase: relay the OAuth URL out IMMEDIATELY, ferry the
 * owner's pasted callback URL into the Box, until done. */
async function cmdAuth(client: AsciiBoxClient) {
  const state = loadState();
  if (state.boxId === undefined) throw new Error("no box — run `up` first");
  const boxId = state.boxId;

  const started = await startProbe(client, boxId, "--phase auth");
  if (!started.ok) {
    line("auth.startFailed", { error: started.error });
    process.exitCode = 1;
    return;
  }
  line("auth.started", { processId: started.processId });

  // The host watch must outlive the in-box budget it relays for — a wider
  // --auth-budget-ms / --oauth-timeout-secs is pointless if this ferry stops
  // watching at its own 60-minute deadline first. The in-box default is 40
  // minutes; 20 minutes of margin covers the status write and callback leg.
  const oauthTimeoutSecs = Number(argOf("oauth-timeout-secs"));
  const authBudgetMs = Number(argOf("auth-budget-ms"));
  const inBoxBudgetMs =
    Number.isFinite(authBudgetMs) && authBudgetMs > 0
      ? authBudgetMs
      : Number.isFinite(oauthTimeoutSecs) && oauthTimeoutSecs > 0
        ? oauthTimeoutSecs * 1000
        : 40 * 60_000;
  const deadline = Date.now() + inBoxBudgetMs + 20 * 60_000;
  let lastUrl: string | undefined;
  let lastStage: string | undefined;
  let callbackForwarded = false;
  while (Date.now() < deadline) {
    const st = await readBoxFile(client, boxId, `${GATE_DIR}/mcp-status-auth.json`);
    if (st !== undefined) {
      const stage = typeof st["stage"] === "string" ? st["stage"] : "?";
      if (stage !== lastStage) {
        lastStage = stage;
        line("auth.stage", { stage });
      }
      if (typeof st["authUrl"] === "string" && st["authUrl"] !== lastUrl) {
        lastUrl = st["authUrl"];
        writeAuthStatus({
          phase: "awaiting-owner-oauth",
          boxId,
          authorizationUrl: lastUrl,
          issuedAt: st["authUrlIssuedAt"] ?? null,
          note:
            "Owner: open authorizationUrl, complete Apollo sign-in. The " +
            "browser will redirect to a 127.0.0.1 URL that cannot load — " +
            "copy the FULL address-bar URL into worker/P04_CALLBACK_URL.txt " +
            "on the builder machine; the driver relays it into the Box.",
        });
        // Emit to stdout immediately — this must reach the owner fast.
        line("APOLLO_AUTH_URL", { url: lastUrl });
      }
      if (st["done"] === true) {
        line("auth.done", {
          authCompleted: st["authCompleted"] ?? null,
          toolCount: st["toolCount"] ?? null,
          error: st["error"] ?? null,
          apolloStatus: st["apolloStatus"] ?? null,
        });
        writeAuthStatus({
          phase: "finished",
          authCompleted: st["authCompleted"] ?? null,
          toolCount: st["toolCount"] ?? null,
          apolloStatus: st["apolloStatus"] ?? null,
          error: st["error"] ?? null,
        });
        break;
      }
    }
    // Ferry the owner's pasted callback URL into the Box (once).
    if (!callbackForwarded && existsSync(CALLBACK_IN)) {
      const pasted = readFileSync(CALLBACK_IN, "utf8").trim();
      if (pasted.length > 0) {
        const w = await client.writeFile(
          boxId,
          `${GATE_DIR}/callback-url.txt`,
          pasted,
          "utf8",
        );
        callbackForwarded = w.ok;
        line("callback.forwarded", {
          ok: w.ok,
          // The URL carries the OAuth code — record presence only.
          looksLoopback: /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(pasted),
        });
      }
    }
    await sleep(STATUS_POLL_MS);
  }

  // Pull the tools catalog + final status for the evidence record.
  const tools = await client.readFile(boxId, `${GATE_DIR}/apollo-tools.json`);
  if (tools.ok && typeof tools.value["content"] === "string") {
    writeFileSync(
      join(RESULTS_DIR, "apollo-tools.json"),
      tools.value["content"],
    );
    line("auth.toolsPulled", {
      bytes: tools.value["content"].length,
    });
  }
  const finalStatus = await readBoxFile(
    client,
    boxId,
    `${GATE_DIR}/mcp-status-auth.json`,
  );
  writeFileSync(
    join(RESULTS_DIR, "mcp-status-auth.json"),
    JSON.stringify(finalStatus ?? {}, null, 2),
  );
}

async function cmdCall(client: AsciiBoxClient) {
  const state = loadState();
  if (state.boxId === undefined) throw new Error("no box — run `up` first");
  const tool = argOf("tool");
  const argsJson = argOf("args") ?? "{}";
  const label = argOf("label") ?? "call";
  if (tool === undefined) {
    throw new Error("usage: call --tool <name> --args '<json>' --label L");
  }
  const started = await startProbe(
    client,
    state.boxId,
    `--phase call --tool "${tool}" --args-json '${argsJson.replaceAll("'", "'\\''")}' --label ${label}`,
  );
  if (!started.ok) throw new Error(`call start failed: ${started.error}`);
  line("call.started", { processId: started.processId, tool, label });

  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const st = await readBoxFile(
      client,
      state.boxId,
      `${GATE_DIR}/mcp-status-call.json`,
    );
    if (st !== undefined && st["done"] === true) break;
    if (Date.now() > deadline) {
      line("call.timeout", { label });
      break;
    }
    await sleep(STATUS_POLL_MS);
  }
  const res = await client.readFile(
    state.boxId,
    `${GATE_DIR}/call-${label}.json`,
  );
  if (res.ok && typeof res.value["content"] === "string") {
    writeFileSync(
      join(RESULTS_DIR, `call-${label}.json`),
      res.value["content"],
    );
    line("call.pulled", {
      label,
      bytes: res.value["content"].length,
    });
  } else {
    line("call.noResult", { label });
  }
}

async function cmdPull(client: AsciiBoxClient, phase: string, remote: string) {
  const state = loadState();
  if (state.boxId === undefined) throw new Error("no box — run `up` first");
  const started = await startProbe(client, state.boxId, `--phase ${phase}`);
  if (!started.ok) throw new Error(`probe start failed: ${started.error}`);
  const deadline = Date.now() + 3 * 60_000;
  for (;;) {
    const st = await readBoxFile(
      client,
      state.boxId,
      `${GATE_DIR}/mcp-status-${phase}.json`,
    );
    if (st !== undefined && st["done"] === true) break;
    if (Date.now() > deadline) break;
    await sleep(STATUS_POLL_MS);
  }
  const res = await client.readFile(state.boxId, `${GATE_DIR}/${remote}`);
  if (res.ok && typeof res.value["content"] === "string") {
    writeFileSync(join(RESULTS_DIR, remote), res.value["content"]);
    line("pulled", { remote, bytes: res.value["content"].length });
  } else {
    line("pullFailed", { remote });
  }
}

async function cmdStatus(client: AsciiBoxClient) {
  const state = loadState();
  if (state.boxId === undefined) throw new Error("no box");
  for (const phase of ["auth", "call", "token-inspect", "list"]) {
    const st = await readBoxFile(
      client,
      state.boxId,
      `${GATE_DIR}/mcp-status-${phase}.json`,
    );
    if (st !== undefined) {
      line(`status.${phase}`, {
        stage: st["stage"],
        done: st["done"],
        authCompleted: st["authCompleted"] ?? null,
        toolCount: st["toolCount"] ?? null,
        error: st["error"] ?? null,
      });
    }
  }
}

async function cmdDown(client: AsciiBoxClient, adapter: BoxLifecycleAdapter) {
  const state = loadState();
  if (state.boxId !== undefined && state.boxDeleted !== true) {
    const del = await adapter.deleteBox({
      operationKey: "p04-delete-a",
      boxId: state.boxId,
      waitMs: 4 * 60_000,
    });
    line("box.deleted", {
      ok: del.ok,
      error: del.ok ? null : `${del.error.code ?? del.error.kind}: ${del.error.message}`,
    });
    if (del.ok) {
      state.boxDeleted = true;
      saveState(state);
    }
  }
  const remaining = await client.listBoxes({ limit: 50 });
  if (remaining.ok) {
    const boxes = remaining.value.boxes;
    const active = boxes.filter(
      (b) => !["archived", "error"].includes(String(b.state)),
    ).length;
    line("cleanup.remainingBoxes", { total: boxes.length, active });
  }
}

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const apiKey = readEnvFileKey("ASCII_API_KEY");
  if (apiKey === undefined) {
    line("fatal", { error: "ASCII_API_KEY not found in env or .env.local" });
    process.exitCode = 78;
    return;
  }
  const client = new AsciiBoxClient(apiKey);
  const store = new JsonFileBoxOperationStore(OPS_PATH);
  const adapter = new BoxLifecycleAdapter(client, store);
  mkdirSync(STATE_DIR, { recursive: true });

  switch (cmd) {
    case "up":
      await cmdUp(client, adapter);
      break;
    case "auth":
      await cmdAuth(client);
      break;
    case "call":
      await cmdCall(client);
      break;
    case "list":
      await cmdPull(client, "list", "apollo-tools-direct.json");
      break;
    case "token":
      await cmdPull(client, "token-inspect", "token-inspect.json");
      break;
    case "status":
      await cmdStatus(client);
      break;
    case "down":
      await cmdDown(client, adapter);
      break;
    default:
      process.stderr.write(
        "usage: p04gate.js <up|auth|call|list|token|status|down>\n",
      );
      process.exitCode = 2;
  }
}

await main();
