// Box-side live-gate probe (P03). Runs INSIDE the disposable ASCII Box under
// plain Node 24 — no npm dependencies (the compiled bundle imports only node
// builtins; generated codex protocol types are type-only).
//
// Phases (selected with --phase):
//   precheck    — presence-only credential hygiene + codex --version.
//   gate        — envcheck → spawn `codex app-server --stdio` → initialize →
//                 account/read → managed device-code login loop (re-issues the
//                 challenge when a code expires, until --login-budget-ms) →
//                 verified account/read → rateLimits → thread/start → ONE
//                 bounded structured-output turn → persists thread/turn state.
//   post-resume — envcheck → initialize → account/read (managed login must
//                 have survived stop/resume) → thread/resume → second tiny
//                 bounded turn on the resumed thread.
//
// Every state change is written to <gateDir>/gate-status.json (mode 0600) and
// echoed as one sanitized JSON line on stdout. The host driver polls the
// status file through the ASCII file API — stdout is a fallback channel.
//
// Sanitization contract: account emails/IDs never leave this process
// (methods.ts already redacts them); the ONLY secret-class values emitted are
// the device-code `verificationUrl`/`userCode`, which are the owner handoff
// channel the gate exists to deliver. No auth files are opened; credential
// hygiene is presence-only via envcheck.ts.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { CodexAppServer } from "./codex/appserver.js";
import {
  accountLoginStartDeviceCode,
  accountRateLimitsRead,
  accountRead,
  decliningServerRequestHandler,
  initialize,
  sendInitialized,
  threadResume,
  threadStart,
  turnInterrupt,
  turnStart,
  waitForLoginCompleted,
  waitForTurn,
  WORKER_PROTOCOL_VERSION,
  type AccountState,
  type DeviceCodeChallenge,
} from "./codex/methods.js";
import { checkInheritedCredentials } from "./envcheck.js";
import type { JsonValue } from "./generated/codex/serde_json/JsonValue";

type Phase = "precheck" | "gate" | "post-resume";

type GateStatus = {
  phase: Phase;
  stage: string;
  updatedAt: string;
  heartbeat: {
    workerVersion: string;
    protocolVersion: string;
    phase: string;
    heartbeatAt: number;
  };
  challenge?: {
    loginId: string;
    verificationUrl: string;
    userCode: string;
    issuedAt: string;
    sequence: number;
  };
  account?: AccountState["account"];
  threadId?: string;
  turn?: Record<string, unknown>;
  presenceClean?: boolean;
  done: boolean;
  error?: string;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const PHASE = (arg("phase") ?? "precheck") as Phase;
const GATE_DIR = arg("gate-dir") ?? join(process.env["HOME"] ?? "/tmp", "opensquad-gate");
const CODEX_BIN = arg("codex-bin") ?? "codex";
const CODEX_HOME = join(GATE_DIR, "codex-home");
// Phase-specific status file: the host polls gate-status-<phase>.json so a
// post-resume probe can never read back the stale pre-pause status.
const STATUS_PATH = join(GATE_DIR, `gate-status-${PHASE}.json`);
const STATE_PATH = join(GATE_DIR, "gate-state.json");
const LOGIN_BUDGET_MS = Number(arg("login-budget-ms") ?? 50 * 60_000);
const CHALLENGE_TTL_MS = Number(arg("challenge-ttl-ms") ?? 14 * 60_000);
const TURN_DEADLINE_MS = Number(arg("turn-deadline-ms") ?? 5 * 60_000);
const WORKER_VERSION = "0.1.0";

mkdirSync(GATE_DIR, { recursive: true });

const status: GateStatus = {
  phase: PHASE,
  stage: "starting",
  updatedAt: new Date().toISOString(),
  heartbeat: {
    workerVersion: WORKER_VERSION,
    protocolVersion: WORKER_PROTOCOL_VERSION,
    phase: "starting",
    heartbeatAt: Date.now(),
  },
  done: false,
};

function line(kind: string, data: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ kind, ...data })}\n`);
}

function publish(stage: string, extra?: Partial<GateStatus>): void {
  status.stage = stage;
  status.updatedAt = new Date().toISOString();
  status.heartbeat = {
    workerVersion: WORKER_VERSION,
    protocolVersion: WORKER_PROTOCOL_VERSION,
    phase: stage,
    heartbeatAt: Date.now(),
  };
  if (extra !== undefined) Object.assign(status, extra);
  try {
    writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2), {
      mode: 0o600,
    });
  } catch (err) {
    line("status.writeFailed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  line("gate.stage", { stage });
}

function summarizeAccount(account: AccountState): void {
  status.account = account.account;
  line("codex.accountRead", {
    requiresOpenaiAuth: account.requiresOpenaiAuth,
    account: account.account,
  });
}

const OUTPUT_SCHEMA: JsonValue = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

const BOUNDED_PROMPT =
  'This is a bounded protocol probe. Do not use any tools, files, or network. ' +
  'Respond with exactly this JSON object and nothing else: {"ok": true}';

async function presenceCheck(): Promise<void> {
  const presence = await checkInheritedCredentials({ codexHome: CODEX_HOME });
  status.presenceClean = presence.clean;
  line("env.presence", {
    clean: presence.clean,
    entries: presence.checks.map((c) => ({
      kind: c.kind,
      name: c.name,
      present: c.present,
    })),
  });
}

async function spawnServer(): Promise<CodexAppServer> {
  const server = new CodexAppServer({
    requestTimeoutMs: 60_000,
    onStderr: (l) => line("codex.stderr", { line: l.slice(0, 200) }),
  });
  server.setServerRequestHandler(decliningServerRequestHandler());
  server.onNotification((n) => {
    const params =
      typeof n.params === "object" && n.params !== null
        ? Object.keys(n.params as Record<string, unknown>)
        : [];
    line("codex.notification", { method: n.method, paramKeys: params });
  });
  await server.start({
    codexBin: CODEX_BIN,
    env: { ...process.env, CODEX_HOME },
    cwd: GATE_DIR,
  });
  const identity = await initialize(server, WORKER_VERSION);
  sendInitialized(server);
  line("codex.initialize", {
    userAgent: identity.userAgent,
    platformFamily: identity.platformFamily,
    platformOs: identity.platformOs,
    codexHomeSet: identity.codexHome.length > 0,
  });
  return server;
}

/** Managed device-code login loop: issues a challenge, waits for the owner to
 * complete it, and re-issues a fresh challenge when the code expires — until
 * the overall login budget is spent. Returns true once `account/read`
 * verifies a connected account. */
async function loginLoop(server: CodexAppServer): Promise<boolean> {
  const deadline = Date.now() + LOGIN_BUDGET_MS;
  let sequence = 0;
  while (Date.now() < deadline) {
    sequence += 1;
    let challenge: DeviceCodeChallenge;
    try {
      const started = await accountLoginStartDeviceCode(server);
      if (started.kind !== "deviceCode") {
        publish("login_unsupported", {
          done: true,
          error: `login/start returned type ${started.type}`,
        });
        return false;
      }
      challenge = started.challenge;
    } catch (err) {
      line("codex.loginStart.error", {
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((r) => setTimeout(r, 5_000));
      continue;
    }
    const issuedAt = new Date().toISOString();
    status.challenge = {
      loginId: challenge.loginId,
      verificationUrl: challenge.verificationUrl,
      userCode: challenge.userCode,
      issuedAt,
      sequence,
    };
    publish("login_pending");
    line("login.challenge", {
      loginId: challenge.loginId,
      verificationUrl: challenge.verificationUrl,
      userCode: challenge.userCode,
      issuedAt,
      sequence,
    });

    const remaining = Math.max(30_000, deadline - Date.now());
    const completion = await waitForLoginCompleted(server, {
      loginId: challenge.loginId,
      timeoutMs: Math.min(CHALLENGE_TTL_MS, remaining),
    });
    if (completion.success) {
      const verified = await accountRead(server, { refreshToken: false });
      summarizeAccount(verified);
      if (verified.account.state !== "none") {
        publish("login_completed");
        return true;
      }
      line("login.completedUnverified", { note: "account/read still none" });
      return false;
    }
    line("login.challengeEnded", {
      sequence,
      success: false,
      error: completion.error ?? "expired_or_failed",
    });
    // Loop: issue a fresh challenge while budget remains.
  }
  publish("login_expired", { done: true, error: "login budget exhausted" });
  return false;
}

async function boundedTurn(
  server: CodexAppServer,
  opts: { resumeThreadId?: string },
): Promise<Record<string, unknown>> {
  const limits = await accountRateLimitsRead(server).catch(() => undefined);
  line("codex.rateLimits", {
    ordinaryUsageAllowed: limits?.ordinaryUsageAllowed ?? null,
    limitIds: limits?.limitIds ?? [],
    resetCreditsAvailable: limits?.resetCreditsAvailable ?? false,
  });
  if (limits?.ordinaryUsageAllowed === false) {
    return { blocked: "rate limits disallow ordinary usage" };
  }

  const thread =
    opts.resumeThreadId !== undefined
      ? await threadResume(server, { threadId: opts.resumeThreadId })
      : await threadStart(server, {
          cwd: GATE_DIR,
          serviceName: "opensquad",
        });
  line("codex.thread", {
    resumed: opts.resumeThreadId !== undefined,
    threadId: thread.threadId,
    model: thread.model,
    modelProvider: thread.modelProvider,
  });

  // Collect the bounded agent message for this turn (sanitized, truncated).
  const agentMessages: string[] = [];
  const off = server.onNotification((n) => {
    if (n.method !== "item/completed") return;
    const p = n.params;
    if (typeof p !== "object" || p === null) return;
    const rec = p as Record<string, unknown>;
    const item = rec["item"];
    if (
      typeof item === "object" &&
      item !== null &&
      (item as Record<string, unknown>)["type"] === "agentMessage" &&
      typeof (item as Record<string, unknown>)["text"] === "string"
    ) {
      agentMessages.push(
        ((item as Record<string, unknown>)["text"] as string).slice(0, 400),
      );
    }
  });

  try {
    let started;
    try {
      started = await turnStart(server, {
        threadId: thread.threadId,
        prompt: BOUNDED_PROMPT,
        outputSchema: OUTPUT_SCHEMA,
      });
    } catch (err) {
      // Bubblewrap user namespaces may be unavailable inside a container Box
      // (configWarning at startup). Fall back once to `externalSandbox` — the
      // Box boundary itself is the sandbox; codex then skips bwrap.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/sandbox|bubblewrap|namespace/i.test(msg)) throw err;
      line("codex.turnStart.retryExternalSandbox", { firstError: msg.slice(0, 200) });
      started = await turnStart(server, {
        threadId: thread.threadId,
        prompt: BOUNDED_PROMPT,
        outputSchema: OUTPUT_SCHEMA,
        sandboxPolicy: { type: "externalSandbox", networkAccess: "restricted" },
      });
    }
    line("codex.turnStarted", {
      threadId: thread.threadId,
      turnId: started.turnId,
      status: started.status,
    });
    publish("running_turn");
    const terminal = await waitForTurn(server, {
      threadId: thread.threadId,
      turnId: started.turnId,
      timeoutMs: TURN_DEADLINE_MS,
    });
    if (terminal.status === "timeout") {
      await turnInterrupt(server, {
        threadId: thread.threadId,
        turnId: started.turnId,
      }).catch(() => {});
      const confirmed = await waitForTurn(server, {
        threadId: thread.threadId,
        turnId: started.turnId,
        timeoutMs: 30_000,
      });
      return {
        threadId: thread.threadId,
        turnId: started.turnId,
        model: thread.model,
        status: confirmed.status === "timeout" ? "timeout_unconfirmed" : confirmed.status,
        agentMessages,
      };
    }
    return {
      threadId: thread.threadId,
      turnId: started.turnId,
      model: thread.model,
      status: terminal.status,
      ...(terminal.error !== undefined ? { error: terminal.error.slice(0, 300) } : {}),
      agentMessages,
    };
  } finally {
    off();
  }
}

function codexVersionReport(): string | undefined {
  try {
    const version = execFileSync(CODEX_BIN, ["--version"], {
      timeout: 20_000,
      env: { ...process.env, CODEX_HOME },
    })
      .toString()
      .trim();
    line("codex.version", { version });
    return version;
  } catch (err) {
    line("codex.version", {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return undefined;
  }
}

async function phasePrecheck(): Promise<void> {
  publish("precheck");
  await presenceCheck();
  codexVersionReport();
  publish("done", { done: true });
}

async function phaseGate(): Promise<void> {
  publish("env_check");
  await presenceCheck();
  if (codexVersionReport() === undefined) {
    publish("done", { done: true, error: `codex binary missing: ${CODEX_BIN}` });
    return;
  }
  const server = await spawnServer();
  try {
    let account = await accountRead(server, { refreshToken: false });
    summarizeAccount(account);
    if (account.account.state === "none") {
      const ok = await loginLoop(server);
      if (!ok) {
        publish("done", {
          done: true,
          error: "owner login did not complete within the budget",
        });
        return;
      }
      account = await accountRead(server, { refreshToken: false });
      summarizeAccount(account);
    }
    const turn = await boundedTurn(server, {});
    status.turn = turn;
    if (typeof turn["threadId"] === "string") {
      writeFileSync(
        STATE_PATH,
        JSON.stringify({
          threadId: turn["threadId"],
          turnId: turn["turnId"],
          at: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );
    }
    publish("done", { done: true });
  } finally {
    await server.close();
  }
}

async function phasePostResume(): Promise<void> {
  publish("env_check");
  await presenceCheck();
  if (codexVersionReport() === undefined) {
    publish("done", { done: true, error: `codex binary missing: ${CODEX_BIN}` });
    return;
  }
  const server = await spawnServer();
  try {
    const account = await accountRead(server, { refreshToken: false });
    summarizeAccount(account);
    publish("account_read");
    let threadId: string | undefined;
    try {
      const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as {
        threadId?: string;
      };
      threadId = state.threadId;
    } catch {
      line("gate.stateMissing", { path: STATE_PATH });
    }
    if (threadId === undefined || account.account.state === "none") {
      publish("done", {
        done: true,
        error:
          threadId === undefined
            ? "no persisted thread id"
            : "managed login absent after resume",
      });
      return;
    }
    const turn = await boundedTurn(server, { resumeThreadId: threadId });
    status.turn = turn;
    publish("done", { done: true });
  } finally {
    await server.close();
  }
}

async function main(): Promise<void> {
  line("probe.start", {
    phase: PHASE,
    node: process.version,
    gateDir: GATE_DIR,
    at: new Date().toISOString(),
  });
  try {
    if (PHASE === "precheck") await phasePrecheck();
    else if (PHASE === "gate") await phaseGate();
    else if (PHASE === "post-resume") await phasePostResume();
    else {
      publish("done", { done: true, error: `unknown phase ${PHASE}` });
      process.exitCode = 2;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    line("probe.error", { error: message.slice(0, 500) });
    publish("done", { done: true, error: message.slice(0, 300) });
    process.exitCode = 1;
  }
  line("probe.end", { phase: PHASE, at: new Date().toISOString() });
}

await main();
