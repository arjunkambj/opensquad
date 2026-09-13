// Worker service entrypoint — runs inside the ASCII Box under systemd.
//
// P03 scope: env hygiene gate, app-server spawn, initialize, account read and
// heartbeat emission to a local sink. The HTTP bridge poll loop
// (/worker/claim, /worker/control/claim, /worker/result) is the P07 task —
// this service proves the Box-side protocol pieces those routes will drive.

import { mkdir } from "node:fs/promises";
import { CodexAppServer } from "./codex/appserver.js";
import { decliningServerRequestHandler } from "./codex/methods.js";
import { loadWorkerConfig } from "./config.js";
import { checkInheritedCredentials, FORBIDDEN_ENV_NAMES, FORBIDDEN_PATHS } from "./envcheck.js";
import {
  WorkerRunLoop,
  type BridgeReporter,
  type RuntimeHeartbeat,
} from "./runloop.js";

const HEARTBEAT_INTERVAL_MS = 15_000;

/** Local sink for the spike: heartbeats/status are written to stdout as JSON
 * lines so systemd journald captures them. P07 replaces this with HTTPS POSTs
 * to the deployment's .convex.site worker routes using OPENSQUAD_WORKER_TOKEN. */
const localReporter: BridgeReporter = {
  runtimeHeartbeat(h: RuntimeHeartbeat): Promise<void> {
    process.stdout.write(`${JSON.stringify({ kind: "heartbeat", ...h })}\n`);
    return Promise.resolve();
  },
  reportLoginChallenge(): Promise<void> {
    // Never log challenge material. P07 posts it to the owner-only challenge
    // endpoint over the authenticated bridge.
    process.stdout.write(
      `${JSON.stringify({ kind: "login_challenge_pending" })}\n`,
    );
    return Promise.resolve();
  },
  reportStatus(status: { state: string; detail?: string }): Promise<void> {
    process.stdout.write(`${JSON.stringify({ kind: "status", ...status })}\n`);
    return Promise.resolve();
  },
  reportResult(result: unknown): Promise<void> {
    process.stdout.write(`${JSON.stringify({ kind: "result", result })}\n`);
    return Promise.resolve();
  },
};

async function main(): Promise<void> {
  const loaded = loadWorkerConfig();
  if (!loaded.ok) {
    process.stderr.write(
      `missing worker env: ${loaded.error.missing.join(", ")}\n`,
    );
    process.exit(78); // EX_CONFIG — provisioning must fix this, not restart loops
  }
  const config = loaded.config;

  // Provisioning checks Codex credential absence at Box birth. Service restarts
  // must allow the workspace owner's managed cache while still rejecting all
  // other inherited builder/provider credentials.
  const presence = await checkInheritedCredentials({ allowManagedLoginCache: true });
  if (!presence.clean) {
    const leaked = presence.checks
      .filter((c) => c.present && (FORBIDDEN_ENV_NAMES.includes(c.name) || FORBIDDEN_PATHS.includes(c.name)))
      .map((c) => c.name);
    process.stderr.write(
      `inherited credential material present (names only): ${leaked.join(", ")}\n`,
    );
    process.exit(78);
  }

  await mkdir(config.workDir, { recursive: true, mode: 0o700 });

  let shuttingDown = false;
  const server = new CodexAppServer({
    onStderr: (l) =>
      process.stderr.write(`codex stderr: ${l.slice(0, 300)}\n`),
    onClose: (reason) => {
      if (shuttingDown) return;
      // Unexpected app-server death: exit non-zero so systemd's
      // `Restart=on-failure` actually restarts the worker — a clean exit(0)
      // would leave the Box silently unsupervised.
      process.stderr.write(`app-server closed unexpectedly: ${reason}\n`);
      process.exit(1);
    },
  });
  server.setServerRequestHandler(decliningServerRequestHandler());
  await server.start({
    codexBin: config.codexBin,
    cwd: config.workDir,
    env: {
      // Minimal, explicit environment for the app-server child.
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      HOME: process.env["HOME"] ?? "/",
      ...(process.env["CODEX_HOME"] !== undefined
        ? { CODEX_HOME: process.env["CODEX_HOME"] }
        : {}),
    },
  });

  const loop = new WorkerRunLoop({ config, reporter: localReporter });
  const heartbeat = setInterval(() => {
    void localReporter.runtimeHeartbeat(loop.heartbeatSnapshot());
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  const outcome = await loop.runOnce(server);
  process.stdout.write(
    `${JSON.stringify({ kind: "runOnce", outcome: summarize(outcome) })}\n`,
  );

  // Keep the process alive as a supervised idle worker: systemd restarts it on
  // failure; the P07 claim loop turns this into a poll-driven daemon.
  const shutdown = async () => {
    shuttingDown = true;
    clearInterval(heartbeat);
    await server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

function summarize(outcome: unknown): unknown {
  // Outcomes are already sanitized by the method wrappers; pass through.
  return outcome;
}

await main();
