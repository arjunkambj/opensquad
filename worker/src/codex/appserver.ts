// Codex App Server stdio client.
//
// Spawns `codex app-server --stdio` as a child process and speaks
// newline-delimited JSON-RPC: client requests carry `{id, method, params}`;
// server messages arrive as responses (matched by `id`), notifications
// (`{method, params}`), and server-initiated requests (`{id, method, params}`)
// such as approval prompts — which this worker declines by policy.
//
// Protocol types are generated from the installed binary into
// `src/generated/codex/` (`codex app-server generate-ts`); this file performs
// runtime validation at the boundary and never casts raw JSON to trusted types.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

// Generated files are imported without extensions: `import type` is fully
// erased at emit, and the generated sources use extensionless specifiers.
import type { ClientRequest } from "../generated/codex/ClientRequest";
import type { RequestId } from "../generated/codex/RequestId";
import type { ServerNotificationEnvelope } from "../generated/codex/ServerNotificationEnvelope";

export type JsonRpcErrorObject = {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
};

export class AppServerError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(error: JsonRpcErrorObject) {
    super(error.message);
    this.name = "AppServerError";
    this.code = error.code;
    if (error.data !== undefined) this.data = error.data;
  }
}

export class AppServerClosedError extends Error {
  constructor(detail: string) {
    super(`app-server closed: ${detail}`);
    this.name = "AppServerClosedError";
  }
}

/** Handler for server-initiated requests. Return the result payload to send
 * back, or throw/return an `error` marker to send a JSON-RPC error. */
export type ServerRequestHandler = (
  method: string,
  params: unknown,
) => Promise<{ ok: true; result: unknown } | { ok: false; error: JsonRpcErrorObject }>;

export type NotificationHandler = (
  notification: ServerNotificationEnvelope,
) => void;

type PendingRequest = {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (err: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === "string" || typeof value === "number";
}

function asErrorObject(value: unknown): JsonRpcErrorObject {
  if (isRecord(value)) {
    return {
      code: typeof value["code"] === "number" ? value["code"] : -32000,
      message:
        typeof value["message"] === "string"
          ? value["message"]
          : "unknown error",
      ...(value["data"] !== undefined ? { data: value["data"] } : {}),
    };
  }
  return { code: -32000, message: "malformed error object" };
}

const REQUEST_TIMEOUT_MS = 60_000;

export type SpawnOptions = {
  /** Codex binary name or absolute path. */
  readonly codexBin?: string;
  /** Extra CLI args before `--stdio`; e.g. `-c key=value` config overrides. */
  readonly extraArgs?: readonly string[];
  /** Environment for the child. Defaults to a scrubbed minimal env. */
  readonly env?: NodeJS.ProcessEnv;
  /** Working directory for the app-server (per-workspace job dir). */
  readonly cwd?: string;
  /** Per-request timeout (ms). */
  readonly requestTimeoutMs?: number;
  /** Sink for child stderr diagnostics — must redact before persisting. */
  readonly onStderr?: (line: string) => void;
};

export class CodexAppServer {
  #child: ChildProcessWithoutNullStreams | null = null;
  #nextId = 1;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #notificationHandlers: NotificationHandler[] = [];
  #serverRequestHandler: ServerRequestHandler | null = null;
  #closed = false;
  #closeReason = "not started";
  readonly #requestTimeoutMs: number;
  #onStderr?: (line: string) => void;
  #onClose?: (reason: string) => void;

  constructor(options?: {
    requestTimeoutMs?: number;
    onStderr?: (line: string) => void;
    /** Fires once when the server transitions to closed (exit, stdout close,
     * spawn error or an explicit `close()`). Lets the supervisor treat an
     * unexpected child death as a restartable failure instead of a clean
     * exit — systemd `Restart=on-failure` never fires on exit code 0. */
    onClose?: (reason: string) => void;
  }) {
    this.#requestTimeoutMs = options?.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    if (options?.onStderr !== undefined) this.#onStderr = options.onStderr;
    if (options?.onClose !== undefined) this.#onClose = options.onClose;
  }

  get closed(): boolean {
    return this.#closed;
  }

  onNotification(handler: NotificationHandler): () => void {
    this.#notificationHandlers.push(handler);
    return () => {
      const i = this.#notificationHandlers.indexOf(handler);
      if (i >= 0) this.#notificationHandlers.splice(i, 1);
    };
  }

  setServerRequestHandler(handler: ServerRequestHandler | null): void {
    this.#serverRequestHandler = handler;
  }

  /** Spawn `codex app-server --stdio`. Resolves when the process is alive;
   * the caller must still complete `initialize`/`initialized` before use. */
  async start(options: SpawnOptions = {}): Promise<void> {
    if (this.#child !== null) {
      throw new Error("app-server already started");
    }
    const bin = options.codexBin ?? "codex";
    const args = ["app-server", ...(options.extraArgs ?? []), "--stdio"];
    if (options.onStderr !== undefined) this.#onStderr = options.onStderr;
    const child = spawn(bin, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env ?? process.env,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    });
    this.#child = child;

    const reader = createInterface({ input: child.stdout });
    reader.on("line", (line) => {
      this.#handleLine(line);
    });
    reader.on("close", () => {
      this.#terminate(new AppServerClosedError("stdout closed"));
    });
    const stderrReader = createInterface({ input: child.stderr });
    stderrReader.on("line", (line) => {
      this.#onStderr?.(line);
    });
    child.on("error", (err) => {
      this.#terminate(new AppServerClosedError(`spawn error: ${err.message}`));
    });
    child.on("exit", (code, signal) => {
      this.#terminate(
        new AppServerClosedError(
          `exited code=${String(code)} signal=${String(signal)}`,
        ),
      );
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        child.off("spawn", onSpawn);
        reject(err);
      };
      const onSpawn = () => {
        child.off("error", onError);
        resolve();
      };
      child.once("error", onError);
      child.once("spawn", onSpawn);
    });
    this.#closed = false;
  }

  #handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.#onStderr?.(`non-JSON line on app-server stdout (dropped)`);
      return;
    }
    if (!isRecord(parsed)) return;

    // Response: has `id` and `result` or `error`, no `method`.
    if ("id" in parsed && !("method" in parsed)) {
      this.#handleResponse(parsed);
      return;
    }
    // Server-initiated request: has both `id` and `method`.
    if ("id" in parsed && typeof parsed["method"] === "string") {
      void this.#handleServerRequest(parsed);
      return;
    }
    // Notification: has `method`, no `id`.
    if (typeof parsed["method"] === "string") {
      const method = parsed["method"];
      const params = "params" in parsed ? parsed["params"] : undefined;
      const emittedAtMs =
        typeof parsed["emittedAtMs"] === "number"
          ? parsed["emittedAtMs"]
          : typeof parsed["emitted_at_ms"] === "number"
            ? parsed["emitted_at_ms"]
            : undefined;
      const envelope = {
        method,
        params,
        ...(emittedAtMs !== undefined ? { emittedAtMs } : {}),
      } as ServerNotificationEnvelope;
      for (const handler of this.#notificationHandlers) {
        try {
          handler(envelope);
        } catch {
          // A broken notification handler must not kill the read loop.
        }
      }
    }
  }

  #handleResponse(message: Record<string, unknown>): void {
    const id = message["id"];
    if (!isRequestId(id)) return;
    const key = String(id);
    const pending = this.#pending.get(key);
    if (pending === undefined) return; // stale/unknown response id
    this.#pending.delete(key);
    clearTimeout(pending.timer);
    if (message["error"] !== undefined && message["error"] !== null) {
      pending.reject(new AppServerError(asErrorObject(message["error"])));
      return;
    }
    pending.resolve(message["result"]);
  }

  async #handleServerRequest(message: Record<string, unknown>): Promise<void> {
    const id = message["id"];
    const method = message["method"] as string;
    const params = message["params"];
    let reply: Record<string, unknown>;
    if (!isRequestId(id) || this.#serverRequestHandler === null) {
      reply = {
        id: id ?? null,
        error: {
          code: -32601,
          message: `worker cannot service server request ${method}`,
        },
      };
    } else {
      try {
        const outcome = await this.#serverRequestHandler(method, params);
        reply = outcome.ok
          ? { id, result: outcome.result }
          : { id, error: outcome.error };
      } catch (err) {
        reply = {
          id,
          error: {
            code: -32000,
            message: `handler failure: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }
    }
    this.#write(reply);
  }

  #write(message: Record<string, unknown>): void {
    const child = this.#child;
    if (child === null || this.#closed) {
      throw new AppServerClosedError(this.#closeReason);
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** Send a client request and await its response, routed by id. */
  request(method: string, params: unknown): Promise<unknown> {
    if (this.#child === null || this.#closed) {
      return Promise.reject(new AppServerClosedError(this.#closeReason));
    }
    const id = this.#nextId;
    this.#nextId += 1;
    const key = String(id);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(key);
        reject(new Error(`request ${method} timed out`));
      }, this.#requestTimeoutMs);
      this.#pending.set(key, { method, resolve, reject, timer });
      try {
        this.#write({ id, method, params });
      } catch (err) {
        this.#pending.delete(key);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Send a typed client request (compile-time checked against the generated
   * `ClientRequest` union when built via the `codex/methods.ts` wrappers).
   * The response is still `unknown` — wrappers validate before trusting it. */
  requestTyped(request: ClientRequest): Promise<unknown> {
    const { method, params } = request;
    return this.request(method, params);
  }

  /** Send a client notification (no id, no response expected). */
  notify(method: string, params?: unknown): void {
    this.#write(
      params === undefined ? { method } : { method, params },
    );
  }

  #terminate(err: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeReason = err.message;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.#pending.clear();
    try {
      this.#onClose?.(err.message);
    } catch {
      // A broken close hook must not interrupt cleanup.
    }
  }

  /** Ask the child to exit; force-kill after a short grace period. */
  async close(): Promise<void> {
    const child = this.#child;
    if (child === null) return;
    this.#terminate(new AppServerClosedError("closed by worker"));
    if (child.exitCode !== null || child.killed) return;
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    child.stdin.end();
    const killer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 3_000);
    await exited;
    clearTimeout(killer);
    this.#child = null;
  }
}
