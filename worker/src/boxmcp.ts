// Box-side Apollo MCP diagnostic probe (P04). Runs INSIDE the disposable
// ASCII Box under plain Node 24 — no npm dependencies (compiled bundle
// imports only node builtins; generated codex protocol types are type-only).
//
// This configures a RAW diagnostic MCP connection
// (`[mcp_servers.apollo] url = "https://mcp.apollo.io/mcp"`) in the probe's
// throwaway CODEX_HOME — it is the trusted-operator diagnostic surface the
// P04 card asks for, NOT the customer employee tool configuration. The
// employee image (worker/deploy/, RUNTIME.md) ships no MCP servers; the
// production gateway is P07's filtered connection.
//
// Phases (selected with --phase):
//   auth          — write diagnostic config.toml, spawn app-server,
//                   `mcpServerStatus/list` pre-auth, `mcpServer/oauth/login`
//                   (fallback: `codex mcp login apollo` child process),
//                   publish the authorization URL the moment it exists,
//                   poll <gateDir>/callback-url.txt and curl the pasted
//                   redirect URL against codex's in-Box loopback listener
//                   (the owner's browser cannot reach a Box's 127.0.0.1 —
//                   relaying the GET inside the Box IS the callback),
//                   wait for `mcpServer/oauthLogin/completed`, then dump the
//                   real `tools` catalog (names + inputSchema) to
//                   apollo-tools.json and a token-presence report.
//   call          — ONE bounded `mcpServer/tool/call` (or a direct
//                   MCP-over-HTTP tools/call fallback using the stored OAuth
//                   token when no Codex thread can be started), writing the
//                   sanitized provider response to <gateDir>/call-<label>.json.
//   token-inspect — presence-only report on $CODEX_HOME/.credentials.json
//                   (which fields exist, expiry timestamp — never values).
//   list          — direct MCP-over-HTTP tools/list (ground truth vs the
//                   codex gateway view) using the stored token.
//
// Sanitization contract: OAuth tokens, codes and credential file contents
// never leave this process — only the bare authorization URL (which the
// owner must visit) and presence booleans are emitted. Tool call results are
// written to files for the host to sanitize; this process never logs them.
//
// The callback relay exists because codex's OAuth listener binds
// 127.0.0.1:<ephemeral> INSIDE the Box (verified in codex
// rust-v0.154.0 rmcp-client perform_oauth_login.rs: bind 127.0.0.1:0,
// redirect http://{ip}:{port}/callback). The owner's browser resolves
// 127.0.0.1 to their own machine, so the redirect page fails to load — but
// the address bar holds the full ?code=&state= URL, which we GET from inside
// the Box to deliver it to the listener.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

import { CodexAppServer } from "./codex/appserver.js";
import {
  decliningServerRequestHandler,
  initialize,
  sendInitialized,
  threadStart,
} from "./codex/methods.js";
import { checkInheritedCredentials } from "./envcheck.js";

type Phase = "auth" | "call" | "token-inspect" | "list";

const APOLLO_MCP_URL = "https://mcp.apollo.io/mcp";
const APOLLO_SERVER_NAME = "apollo";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const PHASE = (arg("phase") ?? "auth") as Phase;
const GATE_DIR =
  arg("gate-dir") ?? join(process.env["HOME"] ?? "/tmp", "opensquad-p04");
const CODEX_BIN = arg("codex-bin") ?? "codex";
const CODEX_HOME = join(GATE_DIR, "codex-home");
const STATUS_PATH = join(GATE_DIR, `mcp-status-${PHASE}.json`);
const CALLBACK_PATH = join(GATE_DIR, "callback-url.txt");
const TOOLS_PATH = join(GATE_DIR, "apollo-tools.json");
const AUTH_BUDGET_MS = Number(arg("auth-budget-ms") ?? 55 * 60_000);
const OAUTH_TIMEOUT_SECS = Number(arg("oauth-timeout-secs") ?? 2400);
const WORKER_VERSION = "0.1.0";

mkdirSync(GATE_DIR, { recursive: true });

type McpStatus = {
  phase: Phase;
  stage: string;
  updatedAt: string;
  authUrl?: string;
  authUrlIssuedAt?: string;
  callbackRelayed?: { at: string; httpStatus: number | null };
  authCompleted?: boolean;
  authError?: string;
  apolloStatus?: Record<string, unknown>;
  toolsWritten?: boolean;
  toolCount?: number;
  done: boolean;
  error?: string;
};

const status: McpStatus = {
  phase: PHASE,
  stage: "starting",
  updatedAt: new Date().toISOString(),
  done: false,
};

function line(kind: string, data: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ kind, ...data })}\n`);
}

function publish(stage: string, extra?: Partial<McpStatus>): void {
  status.stage = stage;
  status.updatedAt = new Date().toISOString();
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
  line("mcp.stage", { stage });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Write the diagnostic MCP config into the throwaway CODEX_HOME. This is
 * the raw connection — only ever present in this diagnostic Box. */
function writeDiagnosticConfig(): string {
  mkdirSync(CODEX_HOME, { recursive: true });
  const configPath = join(CODEX_HOME, "config.toml");
  const existing = existsSync(configPath)
    ? readFileSync(configPath, "utf8")
    : "";
  const block = [
    "",
    "# P04 diagnostic raw MCP connection — NOT the employee image config.",
    "[mcp_servers.apollo]",
    `url = "${APOLLO_MCP_URL}"`,
    "",
  ].join("\n");
  if (!existing.includes("[mcp_servers.apollo]")) {
    writeFileSync(configPath, existing + block, { mode: 0o600 });
  }
  return configPath;
}

async function spawnServer(): Promise<CodexAppServer> {
  const server = new CodexAppServer({
    requestTimeoutMs: 90_000,
    onStderr: (l) => line("codex.stderr", { line: l.slice(0, 200) }),
  });
  server.setServerRequestHandler(decliningServerRequestHandler());
  server.onNotification((n) => {
    const params = isRecord(n.params) ? Object.keys(n.params) : [];
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
    codexHomeSet: identity.codexHome.length > 0,
  });
  return server;
}

/** `mcpServerStatus/list` → the apollo entry, sanitized: tools kept (names +
 * schemas are the evidence this probe exists to capture), server info kept,
 * nothing credential-bearing exists in this response shape. */
async function listMcpStatus(
  server: CodexAppServer,
): Promise<Record<string, unknown> | null> {
  const result = await server.request("mcpServerStatus/list", {
    detail: "full",
  });
  if (!isRecord(result) || !Array.isArray(result["data"])) {
    line("mcp.statusList.unexpected", { shape: typeof result });
    return null;
  }
  const entries = result["data"] as unknown[];
  const apollo = entries.find(
    (e) => isRecord(e) && e["name"] === APOLLO_SERVER_NAME,
  );
  if (!isRecord(apollo)) return null;
  return apollo;
}

function summarizeApolloStatus(apollo: Record<string, unknown>): {
  runtimeStatus: unknown;
  authStatus: unknown;
  toolNames: string[];
  toolsError: unknown;
} {
  const tools = isRecord(apollo["tools"]) ? apollo["tools"] : {};
  return {
    runtimeStatus: apollo["runtimeStatus"] ?? null,
    authStatus: apollo["authStatus"] ?? null,
    toolNames: Object.keys(tools),
    toolsError: apollo["toolsError"] ?? null,
  };
}

/** Relay a pasted redirect URL to codex's in-Box loopback listener. The URL
 * is passed as an argv to curl — never through a shell. */
function relayCallbackUrl(callbackUrl: string): {
  httpStatus: number | null;
  error?: string;
} {
  try {
    const out = execFileSync(
      "curl",
      [
        "-sS",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "--max-time",
        "20",
        callbackUrl,
      ],
      { timeout: 30_000 },
    )
      .toString()
      .trim();
    const code = Number(out);
    return { httpStatus: Number.isFinite(code) ? code : null };
  } catch (err) {
    return {
      httpStatus: null,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}

/** Watch for the host-pasted callback file and relay it. Returns true when
 * a relay was attempted. */
async function relayLoop(stop: () => boolean): Promise<void> {
  while (!stop()) {
    if (existsSync(CALLBACK_PATH)) {
      const url = readFileSync(CALLBACK_PATH, "utf8").trim();
      if (url.length > 0 && /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)) {
        const outcome = relayCallbackUrl(url);
        status.callbackRelayed = {
          at: new Date().toISOString(),
          httpStatus: outcome.httpStatus,
        };
        publish(status.stage);
        line("oauth.callbackRelayed", {
          httpStatus: outcome.httpStatus,
          error: outcome.error ?? null,
        });
        try {
          writeFileSync(CALLBACK_PATH, "", { mode: 0o600 });
        } catch {
          // best-effort clear
        }
      } else if (url.length > 0) {
        line("oauth.callbackRejected", {
          reason: "not a loopback redirect URL — refusing to fetch",
        });
      }
    }
    await sleep(3_000);
  }
}

/** Fallback OAuth driver: `codex mcp login apollo` as a child process. The
 * CLI prints the authorization URL on stdout ("Authorize `apollo` by opening
 * this URL in your browser:\n<url>") and binds the same in-Box loopback
 * listener. Default timeout is 300 s per attempt — we respawn with a fresh
 * challenge until the overall budget is spent. */
async function cliOAuthLoop(): Promise<boolean> {
  const deadline = Date.now() + AUTH_BUDGET_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const child: ChildProcess = spawn(CODEX_BIN, ["mcp", "login", APOLLO_SERVER_NAME], {
      env: { ...process.env, CODEX_HOME },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutBuf = "";
    let urlEmitted = false;
    const done = new Promise<{ code: number | null }>((resolve) => {
      child.on("exit", (code) => resolve({ code }));
      child.on("error", () => resolve({ code: null }));
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      // Emit the first https URL that follows the "Authorize" prompt.
      if (!urlEmitted) {
        const m = /Authorize[^\n]*\n(https:\/\/\S+)/.exec(stdoutBuf);
        const urlMatch =
          m ?? /(https:\/\/mcp\.apollo\.io\/\S+)/.exec(stdoutBuf);
        if (urlMatch !== null && urlMatch[1] !== undefined) {
          urlEmitted = true;
          const authUrl: string = urlMatch[1];
          status.authUrl = authUrl;
          status.authUrlIssuedAt = new Date().toISOString();
          publish("awaiting_oauth", { authUrl });
          line("oauth.authUrl", {
            source: "cli",
            attempt,
            url: urlMatch[1],
          });
        }
      }
      if (/Successfully logged in/i.test(stdoutBuf)) {
        // handled after exit
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      line("mcpLogin.stderr", { line: chunk.toString().slice(0, 300) });
    });
    // Run the callback relay while this attempt is alive.
    let childDone = false;
    void done.then(() => {
      childDone = true;
    });
    await relayLoop(() => childDone || Date.now() > deadline);
    const { code } = await done;
    const succeeded = /Successfully logged in/i.test(stdoutBuf) || code === 0;
    line("mcpLogin.exited", {
      attempt,
      code,
      succeeded,
      tail: stdoutBuf.slice(-300),
    });
    if (succeeded) return true;
    if (Date.now() > deadline) break;
    line("mcpLogin.retry", { attempt, reason: "attempt ended without login" });
    await sleep(2_000);
  }
  return false;
}

async function phaseAuth(): Promise<void> {
  publish("precheck");
  const presence = await checkInheritedCredentials({ codexHome: CODEX_HOME });
  line("env.presence", {
    clean: presence.clean,
    entries: presence.checks.map((c) => ({
      kind: c.kind,
      name: c.name,
      present: c.present,
    })),
  });
  const configPath = writeDiagnosticConfig();
  line("mcp.configWritten", { path: configPath });

  const server = await spawnServer();
  let authOk = false;
  try {
    // Pre-auth status snapshot.
    let apollo = await listMcpStatus(server);
    if (apollo === null) {
      line("mcp.statusList.noApollo", { note: "trying config/mcpServer/reload" });
      await server
        .request("config/mcpServer/reload", {})
        .catch((e) => line("mcp.reloadErr", { error: String(e).slice(0, 200) }));
      apollo = await listMcpStatus(server);
    }
    if (apollo !== null) {
      status.apolloStatus = summarizeApolloStatus(apollo);
    }
    publish("pre_auth_status");

    // Primary path: app-server OAuth request with a long timeout so the
    // owner has time to complete the grant.
    const deadline = Date.now() + AUTH_BUDGET_MS;
    let usedCli = false;
    try {
      const loginPromise = server.request("mcpServer/oauth/login", {
        name: APOLLO_SERVER_NAME,
        timeoutSecs: OAUTH_TIMEOUT_SECS,
      }) as Promise<unknown>;
      // Whenever the response DOES resolve, capture the URL — even if the
      // initial race below already timed out.
      loginPromise
        .then((late) => {
          if (
            isRecord(late) &&
            typeof late["authorizationUrl"] === "string" &&
            status.authUrl === undefined
          ) {
            status.authUrl = late["authorizationUrl"];
            status.authUrlIssuedAt = new Date().toISOString();
            publish("awaiting_oauth", { authUrl: status.authUrl });
            line("oauth.authUrl", {
              source: "app-server-late",
              url: status.authUrl,
            });
          }
        })
        .catch(() => {});
      // The response may arrive quickly with the URL, or block until
      // completion depending on the server implementation — race it against
      // a short timer so we can also watch for the completed notification.
      const response = await Promise.race([
        loginPromise,
        sleep(30_000).then(() => "pending" as const),
      ]);
      if (response !== "pending") {
        if (isRecord(response) && typeof response["authorizationUrl"] === "string") {
          status.authUrl = response["authorizationUrl"];
          status.authUrlIssuedAt = new Date().toISOString();
          publish("awaiting_oauth", { authUrl: status.authUrl });
          line("oauth.authUrl", {
            source: "app-server",
            url: status.authUrl,
          });
        } else {
          line("oauth.login.unexpected", {
            shape: isRecord(response) ? Object.keys(response) : typeof response,
          });
        }
      } else {
        line("oauth.login.pending", {
          note: "mcpServer/oauth/login still in flight; watching notifications + status",
        });
      }

      // Wait for completion via notification, polling status meanwhile.
      let stopRelay = false;
      const relayDone = relayLoop(() => stopRelay);
      const completed = new Promise<boolean>((resolve) => {
        const off = server.onNotification((n) => {
          if (n.method !== "mcpServer/oauthLogin/completed") return;
          const p: Record<string, unknown> = isRecord(n.params) ? n.params : {};
          if (p["name"] !== APOLLO_SERVER_NAME) return;
          off();
          resolve(p["success"] === true);
          if (p["success"] !== true) {
            status.authError =
              typeof p["error"] === "string" ? p["error"].slice(0, 300) : "failed";
          }
        });
        setTimeout(() => resolve(false), Math.max(5_000, deadline - Date.now()));
      });
      while (Date.now() < deadline) {
        const doneFlag = await Promise.race([
          completed,
          sleep(15_000).then(() => "tick" as const),
        ]);
        if (doneFlag === true) {
          authOk = true;
          break;
        }
        if (doneFlag === false) break;
        // tick: re-check authStatus — the server may not emit the
        // notification in all flows.
        const cur = await listMcpStatus(server).catch(() => null);
        if (cur !== null) {
          const s = summarizeApolloStatus(cur);
          if (s.authStatus === "oAuth" || s.authStatus === "bearerToken") {
            authOk = true;
            break;
          }
        }
      }
      stopRelay = true;
      await relayDone;
    } catch (err) {
      line("oauth.appServerFailed", {
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
      });
      usedCli = true;
    }

    if (!authOk && (usedCli || status.authUrl === undefined)) {
      // Fallback: CLI `codex mcp login apollo` (emits its own URL).
      line("oauth.cliFallback", { reason: "app-server path did not produce a login" });
      authOk = await cliOAuthLoop();
    }
    status.authCompleted = authOk;
    publish(authOk ? "oauth_completed" : "oauth_failed");

    // Post-auth: capture the REAL tools catalog via the gateway view.
    apollo = await listMcpStatus(server);
    if (apollo !== null) {
      status.apolloStatus = summarizeApolloStatus(apollo);
      const tools = isRecord(apollo["tools"]) ? apollo["tools"] : {};
      writeFileSync(
        TOOLS_PATH,
        JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            source: "codex app-server mcpServerStatus/list (detail=full)",
            serverName: APOLLO_SERVER_NAME,
            authStatus: apollo["authStatus"] ?? null,
            runtimeStatus: apollo["runtimeStatus"] ?? null,
            serverInfo: apollo["serverInfo"] ?? null,
            tools,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      status.toolsWritten = true;
      status.toolCount = Object.keys(tools).length;
    }
    publish("done", { done: true });
  } finally {
    await server.close();
  }
}

/** Minimal MCP-over-HTTP client for the direct-connection fallback and the
 * ground-truth tools/list. Uses the OAuth access token codex stored in
 * $CODEX_HOME/.credentials.json — read inside the Box, never printed. */
function readStoredAccessToken(): string | null {
  const credPath = join(CODEX_HOME, ".credentials.json");
  if (!existsSync(credPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(credPath, "utf8")) as unknown;
    // Store shape: map of credential-name → StoredOAuthTokens; find the
    // entry whose url matches the Apollo MCP endpoint.
    const entries = isRecord(parsed) ? Object.values(parsed) : [];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const url =
        typeof entry["url"] === "string"
          ? entry["url"]
          : isRecord(entry["tokens"]) && typeof entry["tokens"]["url"] === "string"
            ? (entry["tokens"]["url"] as string)
            : null;
      if (url !== APOLLO_MCP_URL) continue;
      const tokenResponse = isRecord(entry["token_response"])
        ? entry["token_response"]
        : isRecord(entry["tokenResponse"])
          ? entry["tokenResponse"]
          : null;
      const accessToken =
        tokenResponse !== null && typeof tokenResponse["access_token"] === "string"
          ? (tokenResponse["access_token"] as string)
          : typeof entry["access_token"] === "string"
            ? (entry["access_token"] as string)
            : null;
      if (accessToken !== null && accessToken.length > 0) return accessToken;
    }
  } catch (err) {
    line("token.readFailed", {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }
  return null;
}

/** Parse a streamable-HTTP MCP response: plain JSON or SSE `data:` frames. */
function parseMcpResponse(contentType: string, body: string): unknown {
  if (contentType.includes("text/event-stream")) {
    const out: unknown[] = [];
    for (const block of body.split(/\r?\n\r?\n/)) {
      const dataLines = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;
      const payload = dataLines.join("\n");
      try {
        out.push(JSON.parse(payload));
      } catch {
        out.push(payload);
      }
    }
    return out.length === 1 ? out[0] : out;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function directMcpRequest(
  token: string,
  method: string,
  params: unknown,
  sessionId: string | null,
  id: number,
): Promise<{ result: unknown; sessionId: string | null; httpStatus: number }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId !== null) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(APOLLO_MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  const parsed = parseMcpResponse(
    res.headers.get("content-type") ?? "",
    text,
  );
  const sid = res.headers.get("mcp-session-id") ?? sessionId;
  return { result: parsed, sessionId: sid, httpStatus: res.status };
}

async function directMcpCall(
  method: string,
  params: unknown,
): Promise<unknown> {
  const token = readStoredAccessToken();
  if (token === null) {
    throw new Error("no stored Apollo OAuth token in .credentials.json");
  }
  // initialize → notifications/initialized → actual call.
  const init = await directMcpRequest(
    token,
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "opensquad-p04-direct-probe", version: "0.1.0" },
    },
    null,
    1,
  );
  if (init.httpStatus === 401 || init.httpStatus === 403) {
    throw new Error(`direct MCP initialize rejected: HTTP ${init.httpStatus}`);
  }
  const sessionId = init.sessionId;
  // Fire the initialized notification (no id) — best effort.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId !== null) headers["Mcp-Session-Id"] = sessionId;
  await fetch(APOLLO_MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }).catch(() => {});
  const callRes = await directMcpRequest(token, method, params, sessionId, 2);
  return callRes.result;
}

async function phaseCall(): Promise<void> {
  const tool = arg("tool");
  const label = arg("label") ?? "call";
  const argsJson = arg("args-json") ?? "{}";
  if (tool === undefined) {
    publish("done", { done: true, error: "missing --tool" });
    process.exitCode = 2;
    return;
  }
  const outPath = join(GATE_DIR, `call-${label}.json`);
  publish("call_start");

  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(argsJson);
  } catch {
    publish("done", { done: true, error: "--args-json is not valid JSON" });
    process.exitCode = 2;
    return;
  }

  const record: Record<string, unknown> = {
    label,
    tool,
    arguments: parsedArgs,
    attemptedAt: new Date().toISOString(),
  };

  // Preferred path: codex app-server `mcpServer/tool/call` (the gateway
  // surface). Requires a thread; thread/start may need a Codex account.
  const server = await spawnServer();
  try {
    let threadId: string | null = null;
    try {
      const thread = await threadStart(server, {
        cwd: GATE_DIR,
        serviceName: "opensquad-p04-probe",
      });
      threadId = thread.threadId;
      line("codex.threadStarted", { threadId });
    } catch (err) {
      record["threadStartError"] =
        err instanceof Error ? err.message.slice(0, 300) : String(err);
      line("codex.threadStartFailed", { error: record["threadStartError"] });
    }

    if (threadId !== null) {
      try {
        const response = await server.request("mcpServer/tool/call", {
          threadId,
          server: APOLLO_SERVER_NAME,
          tool,
          arguments: parsedArgs,
        });
        record["via"] = "codex-app-server mcpServer/tool/call";
        record["response"] = response;
        publish("done", { done: true });
        writeFileSync(outPath, JSON.stringify(record, null, 2), { mode: 0o600 });
        return;
      } catch (err) {
        record["toolCallError"] =
          err instanceof Error ? err.message.slice(0, 400) : String(err);
        line("mcp.toolCallFailed", { error: record["toolCallError"] });
      }
    }
  } finally {
    await server.close();
  }

  // Fallback: direct MCP-over-HTTP with the stored OAuth token. This is the
  // "raw diagnostic connection" — used to prove the grant works even where
  // the codex gateway can't drive it (e.g. no Codex account in this Box).
  try {
    const result = await directMcpCall("tools/call", {
      name: tool,
      arguments: parsedArgs,
    });
    record["via"] = "direct MCP-over-HTTP tools/call";
    record["response"] = result;
    publish("done", { done: true });
  } catch (err) {
    record["directError"] =
      err instanceof Error ? err.message.slice(0, 400) : String(err);
    publish("done", {
      done: true,
      error: `all call paths failed: ${record["directError"]}`,
    });
  }
  writeFileSync(outPath, JSON.stringify(record, null, 2), { mode: 0o600 });
}

async function phaseTokenInspect(): Promise<void> {
  const credPath = join(CODEX_HOME, ".credentials.json");
  const report: Record<string, unknown> = {
    credPath,
    exists: existsSync(credPath),
    inspectedAt: new Date().toISOString(),
  };
  if (existsSync(credPath)) {
    try {
      const parsed = JSON.parse(readFileSync(credPath, "utf8")) as unknown;
      const entries = isRecord(parsed)
        ? Object.entries(parsed)
        : [];
      report["entryCount"] = entries.length;
      report["entries"] = entries.map(([key, value]) => {
        const rec = isRecord(value) ? value : {};
        const tokenResponse = isRecord(rec["token_response"])
          ? rec["token_response"]
          : isRecord(rec["tokenResponse"])
            ? rec["tokenResponse"]
            : {};
        return {
          // Credential name is an identifier, not a secret.
          key,
          url: rec["url"] ?? null,
          issuer: rec["issuer"] ?? null,
          hasClientId: typeof rec["client_id"] === "string" || typeof rec["clientId"] === "string",
          hasAccessToken:
            typeof tokenResponse["access_token"] === "string" ||
            typeof rec["access_token"] === "string",
          hasRefreshToken:
            typeof tokenResponse["refresh_token"] === "string" ||
            typeof rec["refresh_token"] === "string",
          expiresAt: rec["expires_at"] ?? rec["expiresAt"] ?? null,
          scopes: tokenResponse["scope"] ?? rec["scope"] ?? null,
        };
      });
      // Keyring store check: on headless Linux codex falls back to the file
      // store; note any keyring-looking files too (presence only).
      report["codexHomeFiles"] = readdirSync(CODEX_HOME).filter(
        (f) => !f.startsWith("sessions") && !f.startsWith("log"),
      );
    } catch (err) {
      report["parseError"] =
        err instanceof Error ? err.message.slice(0, 200) : String(err);
    }
  }
  const outPath = join(GATE_DIR, "token-inspect.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  publish("done", { done: true });
  line("token.inspect", { outPath, exists: report["exists"] });
}

async function phaseList(): Promise<void> {
  publish("direct_tools_list");
  try {
    const result = await directMcpCall("tools/list", {});
    writeFileSync(
      join(GATE_DIR, "apollo-tools-direct.json"),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          source: "direct MCP-over-HTTP tools/list (stored OAuth token)",
          result,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    publish("done", { done: true });
  } catch (err) {
    publish("done", {
      done: true,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err),
    });
    process.exitCode = 1;
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
    if (PHASE === "auth") await phaseAuth();
    else if (PHASE === "call") await phaseCall();
    else if (PHASE === "token-inspect") await phaseTokenInspect();
    else if (PHASE === "list") await phaseList();
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
