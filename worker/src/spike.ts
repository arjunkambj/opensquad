// Local protocol spike: exercises the stdio handshake against the installed
// codex binary and prints a SANITISED transcript (one JSON object per line).
//
// Safe to run on the builder machine:
//   - initialize + account/read are read-only.
//   - account/login/start(chatgptDeviceCode) is only attempted when no account
//     is present, and the pending login is cancelled immediately afterwards;
//     verificationUrl/userCode values are redacted from output.
//   - No turn is ever started locally: a model turn would consume the
//     builder's Codex account, which is prohibited for this task. The bounded
//     turn path is exercised inside the allocated ASCII Box only.

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { CodexAppServer } from "./codex/appserver.js";
import {
  accountLoginCancel,
  accountLoginStartDeviceCode,
  accountRead,
  decliningServerRequestHandler,
  initialize,
  sendInitialized,
} from "./codex/methods.js";
import { checkInheritedCredentials, codexHomeEntryCount } from "./envcheck.js";

const execFileAsync = promisify(execFile);

function line(kind: string, data: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ kind, ...data })}\n`);
}

async function codexVersion(bin: string): Promise<string> {
  const { stdout } = await execFileAsync(bin, ["--version"], {
    timeout: 15_000,
  });
  return stdout.trim();
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  line("spike.start", {
    node: process.version,
    workerVersion: "0.1.0",
    at: new Date(startedAt).toISOString(),
  });

  const codexBin = process.env["OPENSQUAD_CODEX_BIN"] ?? "codex";
  // `--isolated-home`: point the spawned app-server at a fresh temporary
  // CODEX_HOME so it observes a logged-out account WITHOUT touching the
  // builder's real ~/.codex. This safely exercises login/start + login/cancel.
  const isolatedHome = process.argv.includes("--isolated-home");
  const codexHome = isolatedHome
    ? mkdtempSync(join(tmpdir(), "opensquad-codex-home-"))
    : undefined;
  try {
    const version = await codexVersion(codexBin);
    line("codex.version", { version });
  } catch (err) {
    line("codex.version", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
    return;
  }

  // Presence-only credential hygiene on THIS machine. On the builder host
  // these may be present (that is the developer's own login — expected). The
  // same check runs inside the fresh Box where they must be absent.
  const presence = await checkInheritedCredentials(
    codexHome !== undefined ? { codexHome } : undefined,
  );
  line("env.presence", {
    clean: presence.clean,
    isolatedHome,
    codexHome: presence.codexHome,
    entries: presence.checks.map((c) => ({
      kind: c.kind,
      name: c.name,
      present: c.present,
    })),
  });
  line("env.codexHomeEntries", {
    count: await codexHomeEntryCount(presence.codexHome),
  });

  const server = new CodexAppServer({
    requestTimeoutMs: 30_000,
    onStderr: (l) => line("codex.stderr", { line: l.slice(0, 300) }),
  });
  server.setServerRequestHandler(decliningServerRequestHandler());
  const unsubscribe = server.onNotification((n) => {
    // Record method + param key names only — param values can carry personal
    // data (account email, tokens, challenge codes).
    const params =
      typeof n.params === "object" && n.params !== null
        ? Object.keys(n.params as Record<string, unknown>)
        : [];
    line("codex.notification", { method: n.method, paramKeys: params });
  });

  try {
    await server.start({
      codexBin,
      ...(codexHome !== undefined
        ? { env: { ...process.env, CODEX_HOME: codexHome } }
        : {}),
    });
    line("codex.spawned", {
      args: ["app-server", "--stdio"],
      isolatedCodexHome: isolatedHome,
    });

    const identity = await initialize(server, "0.1.0");
    line("codex.initialize", {
      userAgent: identity.userAgent,
      platformFamily: identity.platformFamily,
      platformOs: identity.platformOs,
      // codexHome is a local path — record presence only.
      codexHomeSet: identity.codexHome.length > 0,
    });
    sendInitialized(server);

    const account = await accountRead(server, { refreshToken: false });
    line("codex.accountRead", {
      requiresOpenaiAuth: account.requiresOpenaiAuth,
      account: account.account,
    });

    if (account.account.state === "none") {
      // Logged out: probing the device-code start is safe and proves the
      // managed login surface; the challenge values are redacted, then the
      // pending login is cancelled.
      try {
        const started = await accountLoginStartDeviceCode(server);
        if (started.kind === "deviceCode") {
          line("codex.loginStart", {
            type: started.challenge.type,
            loginIdPresent: started.challenge.loginId.length > 0,
            verificationUrlPresent:
              started.challenge.verificationUrl.length > 0,
            userCodePresent: started.challenge.userCode.length > 0,
          });
          const cancel = await accountLoginCancel(
            server,
            started.challenge.loginId,
          );
          line("codex.loginCancel", { status: cancel });
        } else {
          line("codex.loginStart", { type: started.type });
        }
      } catch (err) {
        line("codex.loginStart", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      // Builder machine is already signed in — do NOT start a login flow or a
      // turn against the builder's account. In the isolated Box (no account)
      // the login probe above runs instead.
      line("codex.loginStart", {
        skipped: true,
        reason: "account already present on this host",
      });
    }

    // Rate-limit read is account-scoped metadata; allowed even when logged out
    // (expected to return nulls) — it never starts billable work.
    try {
      const { accountRateLimitsRead } = await import("./codex/methods.js");
      const limits = await accountRateLimitsRead(server);
      line("codex.rateLimits", {
        ordinaryUsageAllowed: limits.ordinaryUsageAllowed,
        limitIds: limits.limitIds,
        resetCreditsAvailable: limits.resetCreditsAvailable,
      });
    } catch (err) {
      line("codex.rateLimits", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (err) {
    line("spike.error", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  } finally {
    unsubscribe();
    await server.close();
    if (codexHome !== undefined) {
      rmSync(codexHome, { recursive: true, force: true });
    }
    line("spike.end", { durationMs: Date.now() - startedAt });
  }
}

await main();
