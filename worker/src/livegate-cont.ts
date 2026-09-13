// Live-gate continuation driver (P03): finishes the G1 probes on an EXISTING
// box whose gate probe is already running (used when the first driver run
// ended early or a debug box was promoted to the gate box).
//
//   node dist/livegate-cont.js --box <boxId> [--gate-dir <dir>]
//                               [--codex-bin <path>] [--node-bin <dir>]
//
// Steps: poll the in-Box gate-status.json until the gate probe is done
// (relaying every fresh device-code challenge to LIVE_GATE_STATUS.json +
// stdout immediately) → marker write → pause (stop→archived) → resume →
// marker verify → upload current bundle → post-resume probe (managed-login
// survival + thread/resume + bounded turn) → second-box isolation → delete
// both boxes → confirm none billable remain.

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
import type { BoxOperationRecord } from "./ascii/types.js";

const DIST_DIR = dirname(fileURLToPath(import.meta.url));
const WORKER_ROOT = join(DIST_DIR, "..");
const REPO_ROOT = join(WORKER_ROOT, "..");
const STATE_DIR = join(WORKER_ROOT, ".livegate");
const OPS_PATH = join(STATE_DIR, "operations-cont.json");
const GATE_STATUS_OUT = join(WORKER_ROOT, "LIVE_GATE_STATUS.json");
const RESULT_OUT = join(STATE_DIR, "gate-result-cont.json");
const STATUS_POLL_MS = 5_000;

function line(kind: string, data: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ kind, ...data })}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
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
        // start empty
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

const PRESENCE_SCRIPT = [
  'for n in OPENAI_API_KEY OPENAI_KEY CODEX_API_KEY CODEX_AUTH_TOKEN CHATGPT_ACCESS_TOKEN ASCII_API_KEY AGENTMAIL_API_KEY AGENTMAIL_WEBHOOK_SECRET FIRECRAWL_API_KEY FIRECRAWL_WEBHOOK_SECRET CONVEX_DEPLOY_KEY HEXCLAVE_SECRET_SERVER_KEY GITHUB_TOKEN GH_TOKEN; do if printenv "$n" >/dev/null 2>&1; then echo "env:$n:present"; else echo "env:$n:absent"; fi; done',
  'for p in "$HOME/.codex/auth.json" "$HOME/.codex/credentials" "$HOME/.ssh/id_rsa" "$HOME/.ssh/id_ed25519" "$HOME/.git-credentials" "$HOME/.config/gh/hosts.yml" "$HOME/.agentmail/credentials"; do if [ -e "$p" ]; then echo "path:${p#$HOME/}:present"; else echo "path:${p#$HOME/}:absent"; fi; done',
  'echo "home:$HOME"; echo "user:$(id -un)"',
].join("\n");

async function runShell(
  client: AsciiBoxClient,
  boxId: string,
  command: string,
  timeoutSeconds = 120,
): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  const res = await client.runCommand(boxId, { command, timeoutSeconds });
  if (!res.ok) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      error: `${res.error.code ?? res.error.kind}: ${res.error.message}`,
    };
  }
  const v: unknown = res.value;
  if (isRecord(v) && v["type"] === "command.finished") {
    return {
      ok: v["exitCode"] === 0,
      stdout: typeof v["stdout"] === "string" ? v["stdout"] : "",
      stderr: typeof v["stderr"] === "string" ? v["stderr"] : "",
    };
  }
  return { ok: false, stdout: "", stderr: "", error: "not finished" };
}

async function main(): Promise<void> {
  const boxId = arg("box");
  if (boxId === undefined) {
    line("fatal", { error: "--box <boxId> required" });
    process.exitCode = 64;
    return;
  }
  const gateDir = arg("gate-dir") ?? "/home/user/opensquad-gate";
  const bundleDir = `${gateDir}/bundle`;
  const codexBin = arg("codex-bin") ?? "codex";
  const nodeBin = arg("node-bin") ?? "";
  const startedAt = Date.now();
  mkdirSync(STATE_DIR, { recursive: true });

  const apiKey = readEnvFileKey("ASCII_API_KEY");
  if (apiKey === undefined) {
    line("fatal", { error: "ASCII_API_KEY missing" });
    process.exitCode = 78;
    return;
  }
  const client = new AsciiBoxClient(apiKey);
  const adapter = new BoxLifecycleAdapter(
    client,
    new JsonFileBoxOperationStore(OPS_PATH),
  );
  const result: Record<string, unknown> = { boxAId: boxId };

  // ---------- wait for the gate probe to finish (login + bounded turn) ----
  line("cont.waitGate", { boxId });
  const deadline = Date.now() + 55 * 60_000;
  let lastChallengeKey: string | undefined;
  let gateStatus: Record<string, unknown> | undefined;
  while (Date.now() < deadline) {
    const status = await readStatusFile(
      client,
      boxId,
      `${gateDir}/gate-status.json`,
    );
    if (status !== undefined) {
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
            note: "Device code expires ~15 min after issue.",
          };
          writeLiveGateStatus(relay);
          line("LOGIN_CHALLENGE", relay);
        }
      }
      if (status["done"] === true) {
        gateStatus = status;
        break;
      }
    }
    await sleep(STATUS_POLL_MS);
  }
  result["gateStatus"] = gateStatus ?? null;
  line("cont.gateDone", {
    done: gateStatus?.["done"] === true,
    stage: gateStatus?.["stage"] ?? "timeout",
    account: gateStatus?.["account"] ?? null,
    turn: gateStatus?.["turn"] ?? null,
    error: gateStatus?.["error"] ?? null,
  });
  writeLiveGateStatus({
    phase: "gate-probe-finished",
    boxId,
    stage: gateStatus?.["stage"] ?? "timeout",
    account: gateStatus?.["account"] ?? null,
    turn: gateStatus?.["turn"] ?? null,
  });

  // ---------- marker + pause + resume ----------
  const markerContent = `opensquad-p03-marker-${randomUUID()}`;
  const markerPath = `${gateDir}/marker.txt`;
  await client.writeFile(boxId, markerPath, markerContent, "utf8");
  line("marker.written", { path: markerPath });

  const paused = await adapter.pauseBox({
    operationKey: "p03-live-stop-a-pause",
    boxId,
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
    boxId,
    ttlSeconds: 7200,
    wait: { timeoutMs: 8 * 60_000 },
  });
  line("boxA.resumed", {
    ok: resumed.ok,
    state: resumed.ok ? resumed.value.state : null,
    error: resumed.ok ? null : resumed.error.message,
  });
  result["resumed"] = resumed.ok;

  if (resumed.ok) {
    const marker = await client.readFile(boxId, markerPath);
    const markerOk = marker.ok && marker.value["content"] === markerContent;
    line("boxA.markerVerify", { ok: markerOk });
    result["markerPersisted"] = markerOk;

    // Upload the CURRENT bundle so the post-resume probe writes the
    // phase-specific status file.
    await runShell(client, boxId, `mkdir -p "${bundleDir}/codex"`);
    for (const [local, remote] of [
      ["boxprobe.js", "boxprobe.js"],
      ["envcheck.js", "envcheck.js"],
      ["codex/appserver.js", "codex/appserver.js"],
      ["codex/methods.js", "codex/methods.js"],
    ] as const) {
      const content = readFileSync(join(DIST_DIR, local), "utf8");
      const w = await client.writeFile(
        boxId,
        `${bundleDir}/${remote}`,
        content,
        "utf8",
      );
      if (!w.ok) line("uploadFailed", { remote, error: w.error.message });
    }
    await client.writeFile(
      boxId,
      `${bundleDir}/package.json`,
      JSON.stringify({ type: "module" }),
      "utf8",
    );

    const envPrefix =
      nodeBin.length > 0 ? `PATH="${nodeBin}:$PATH" ` : "";
    const post = await client.runCommand(boxId, {
      command:
        `${envPrefix}CODEX_HOME="${gateDir}/codex-home" node ` +
        `"${bundleDir}/boxprobe.js" --phase post-resume ` +
        `--gate-dir "${gateDir}" --codex-bin "${codexBin}"`,
      detached: true,
    });
    if (post.ok) {
      const postDeadline = Date.now() + 15 * 60_000;
      let postStatus: Record<string, unknown> | undefined;
      while (Date.now() < postDeadline) {
        const s = await readStatusFile(
          client,
          boxId,
          `${gateDir}/gate-status-post-resume.json`,
        );
        if (s !== undefined && s["done"] === true) {
          postStatus = s;
          break;
        }
        await sleep(STATUS_POLL_MS);
      }
      result["postResumeStatus"] = postStatus ?? null;
      line("boxA.postResume", {
        account: postStatus?.["account"] ?? null,
        turn: postStatus?.["turn"] ?? null,
        error: postStatus?.["error"] ?? null,
      });
      const acc = postStatus?.["account"];
      result["loginSurvivedResume"] =
        isRecord(acc) && acc["state"] === "chatgpt";
    } else {
      result["postResumeStatus"] = { error: post.error.message };
    }
  }

  // ---------- second box isolation ----------
  const createdB = await adapter.createBox({
    operationKey: "p03-live-create-b",
    idempotencyKey: randomUUID(),
    config: { noEnv: true, ttlSeconds: 3600, type: "small" },
  });
  let boxBId: string | undefined;
  if (createdB.ok) {
    boxBId = createdB.value.boxId;
    line("boxB.created", { boxId: boxBId });
    const readyB = await adapter.waitForReady(boxBId, {
      timeoutMs: 8 * 60_000,
    });
    if (readyB.readiness === "usable") {
      const isoScript = [
        PRESENCE_SCRIPT,
        `if [ -e "${markerPath}" ]; then echo "marker:present"; else echo "marker:absent"; fi`,
        `if [ -d "${gateDir}" ]; then echo "gatedir:present"; else echo "gatedir:absent"; fi`,
      ].join("\n");
      const iso = await runShell(client, boxBId, isoScript);
      const leaks = iso.stdout
        .split("\n")
        .filter(
          (l) => l.endsWith(":present") && /^(env|path|marker|gatedir):/.test(l),
        );
      line("boxB.isolation", { isolated: leaks.length === 0, leaks });
      result["boxB"] = {
        boxId: boxBId,
        ready: true,
        isolated: leaks.length === 0,
        leaks,
      };
    } else {
      result["boxB"] = { boxId: boxBId, ready: false };
    }
  } else {
    result["boxB"] = {
      created: false,
      error: `${createdB.error.code ?? createdB.error.kind}: ${createdB.error.message}`,
    };
  }

  // ---------- cleanup ----------
  writeLiveGateStatus({ phase: "cleanup" });
  if (boxBId !== undefined) {
    const delB = await adapter.deleteBox({
      operationKey: "p03-live-delete-b",
      boxId: boxBId,
      waitMs: 5 * 60_000,
    });
    line("boxB.deleted", { ok: delB.ok, error: delB.ok ? null : delB.error.message });
  }
  const delA = await adapter.deleteBox({
    operationKey: "p03-live-delete-a",
    boxId,
    waitMs: 5 * 60_000,
  });
  line("boxA.deleted", { ok: delA.ok, error: delA.ok ? null : delA.error.message });
  result["boxADeleted"] = delA.ok;

  const remaining = await client.listBoxes({ limit: 50 });
  if (remaining.ok) {
    const active = remaining.value.boxes.filter(
      (b) => !["archived", "error"].includes(String(b.state)),
    ).length;
    line("cleanup.remainingBoxes", {
      total: remaining.value.boxes.length,
      active,
    });
    result["remainingActiveBoxes"] = active;
  }

  result["durationMs"] = Date.now() - startedAt;
  writeFileSync(RESULT_OUT, JSON.stringify(result, null, 2));
  writeLiveGateStatus({ phase: "finished" });
  line("cont.end", { durationMs: result["durationMs"] });
}

await main();
