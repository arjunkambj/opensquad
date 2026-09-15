// Worker service entrypoint — runs inside the ASCII Box under systemd.
//
// P07 production shape: env hygiene gate → app-server spawn → initialize →
// account posture read → poll-driven daemon. The daemon owns three outbound
// loops against the Convex bridge: control claim (owner commands incl.
// device-code login), work claim (bounded scoped turns), and runtime
// heartbeats. Exit codes:
//   0  clean shutdown (SIGTERM/SIGINT — systemd Stop or disconnect)
//   1  unexpected failure (incl. app-server death — restartable)
//   78 dead credential / config — provisioning replaces, no restart loop

import { mkdir } from "node:fs/promises";
import { CodexAppServer } from "./codex/appserver.js";
import { initialize, sendInitialized } from "./codex/methods.js";
import { loadWorkerConfig } from "./config.js";
import {
  checkInheritedCredentials,
  FORBIDDEN_ENV_NAMES,
  FORBIDDEN_PATHS,
} from "./envcheck.js";
import { WorkerDaemon } from "./daemon.js";

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
  const presence = await checkInheritedCredentials({
    allowManagedLoginCache: true,
  });
  if (!presence.clean) {
    const leaked = presence.checks
      .filter(
        (c) =>
          c.present &&
          (FORBIDDEN_ENV_NAMES.includes(c.name) ||
            FORBIDDEN_PATHS.includes(c.name)),
      )
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
  // The daemon owns the server-request policy: one stable handler, installed
  // before the child is spawned, that reads the daemon's current lease at
  // call time. It reproduces every refusal the declining backstop makes and
  // replaces only `item/tool/call` with the capability-filtered router.
  const daemon = new WorkerDaemon(config, server);
  server.setServerRequestHandler(daemon.serverRequestHandler());
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

  try {
    const identity = await initialize(server, config.workerVersion);
    sendInitialized(server);
    process.stdout.write(
      `${JSON.stringify({ kind: "daemon", event: "initialized", server: identity.userAgent })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `app-server initialize failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    daemon.requestStop();
    // Give in-flight bridge reports a moment, then close the child.
    setTimeout(() => void server.close(), 2_000).unref();
    setTimeout(() => process.exit(0), 8_000).unref();
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  const exitCode = await daemon.run();
  shuttingDown = true;
  await server.close();
  process.exit(exitCode);
}

await main();
