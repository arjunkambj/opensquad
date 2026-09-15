// Typed wrappers over the generated Codex App Server protocol (codex-cli
// 0.154.0). Each function builds a `ClientRequest` variant — compile-checked
// against `src/generated/codex` — and validates the `unknown` response into a
// narrow OpenSquad shape. Account details are summarised rather than passed
// through raw, so personal data never reaches worker logs/evidence.

import type { CodexAppServer, ServerRequestHandler } from "./appserver.js";
// Extensionless generated imports — erased at emit (import type only).
import type { ClientRequest } from "../generated/codex/ClientRequest";
import type { JsonValue } from "../generated/codex/serde_json/JsonValue";
import type { ServerNotificationEnvelope } from "../generated/codex/ServerNotificationEnvelope";

export const WORKER_CLIENT_NAME = "opensquad_worker";
export const WORKER_PROTOCOL_VERSION = "codex-app-server@0.154.0";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reqString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new Error(`protocol violation: missing string field "${key}"`);
  }
  return value;
}

function optString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" ? value : null;
}

export type ServerIdentity = {
  readonly userAgent: string;
  readonly codexHome: string;
  readonly platformFamily: string;
  readonly platformOs: string;
};

/** `initialize` — first request after spawn. */
export async function initialize(
  server: CodexAppServer,
  clientVersion: string,
): Promise<ServerIdentity> {
  const request: ClientRequest = {
    method: "initialize",
    id: 0, // overwritten by the transport's own id assignment
    params: {
      clientInfo: {
        name: WORKER_CLIENT_NAME,
        title: "OpenSquad Worker",
        version: clientVersion,
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    },
  };
  const result = await server.request(request.method, request.params);
  if (!isRecord(result)) {
    throw new Error("protocol violation: initialize result is not an object");
  }
  return {
    userAgent: reqString(result, "userAgent"),
    codexHome: reqString(result, "codexHome"),
    platformFamily: reqString(result, "platformFamily"),
    platformOs: reqString(result, "platformOs"),
  };
}

/** `initialized` — required notification after initialize completes. */
export function sendInitialized(server: CodexAppServer): void {
  server.notify("initialized");
}

/** Redacted account summary — email and account IDs never leave this layer. */
export type AccountSummary =
  | { readonly state: "none" }
  | { readonly state: "chatgpt"; readonly hasEmail: boolean; readonly planType: string | null }
  | { readonly state: "apiKey" }
  | { readonly state: "other"; readonly type: string };

export type AccountState = {
  readonly requiresOpenaiAuth: boolean;
  readonly account: AccountSummary;
};

/** `account/read` — inspect the managed-login account state. */
export async function accountRead(
  server: CodexAppServer,
  options?: { refreshToken?: boolean },
): Promise<AccountState> {
  const params = { refreshToken: options?.refreshToken ?? false };
  const request: ClientRequest = {
    method: "account/read",
    id: 0,
    params,
  };
  const result = await server.request(request.method, request.params);
  if (!isRecord(result)) {
    throw new Error("protocol violation: account/read result is not an object");
  }
  const requiresOpenaiAuth = result["requiresOpenaiAuth"] === true;
  const account = result["account"];
  let summary: AccountSummary;
  if (account === null || account === undefined) {
    summary = { state: "none" };
  } else if (isRecord(account) && account["type"] === "chatgpt") {
    summary = {
      state: "chatgpt",
      hasEmail: typeof account["email"] === "string",
      planType: optString(account, "planType"),
    };
  } else if (isRecord(account) && account["type"] === "apiKey") {
    summary = { state: "apiKey" };
  } else {
    summary = {
      state: "other",
      type:
        isRecord(account) && typeof account["type"] === "string"
          ? account["type"]
          : "unknown",
    };
  }
  return { requiresOpenaiAuth, account: summary };
}

/** Owner-only login challenge — `verificationUrl` and `userCode` are secrets:
 * they belong only in the short-lived owner challenge record, never in
 * activity feeds, logs or evidence. */
export type DeviceCodeChallenge = {
  readonly type: "chatgptDeviceCode";
  readonly loginId: string;
  readonly verificationUrl: string;
  readonly userCode: string;
};

export type LoginStartResult =
  | { readonly kind: "deviceCode"; readonly challenge: DeviceCodeChallenge }
  | { readonly kind: "other"; readonly type: string };

/** `account/login/start` with `chatgptDeviceCode` — the managed headless flow. */
export async function accountLoginStartDeviceCode(
  server: CodexAppServer,
): Promise<LoginStartResult> {
  const request: ClientRequest = {
    method: "account/login/start",
    id: 0,
    params: { type: "chatgptDeviceCode" },
  };
  const result = await server.request(request.method, request.params);
  if (!isRecord(result) || typeof result["type"] !== "string") {
    throw new Error("protocol violation: account/login/start result shape");
  }
  if (result["type"] === "chatgptDeviceCode") {
    return {
      kind: "deviceCode",
      challenge: {
        type: "chatgptDeviceCode",
        loginId: reqString(result, "loginId"),
        verificationUrl: reqString(result, "verificationUrl"),
        userCode: reqString(result, "userCode"),
      },
    };
  }
  return { kind: "other", type: result["type"] };
}

/** `account/login/cancel` — cancel a pending device-code/OAuth login. */
export async function accountLoginCancel(
  server: CodexAppServer,
  loginId: string,
): Promise<"canceled" | "notFound" | "unknown"> {
  const request: ClientRequest = {
    method: "account/login/cancel",
    id: 0,
    params: { loginId },
  };
  const result = await server.request(request.method, request.params);
  if (!isRecord(result)) return "unknown";
  const status = result["status"];
  return status === "canceled" || status === "notFound" ? status : "unknown";
}

/** `account/logout` — disconnect the workspace's Codex account. */
export async function accountLogout(server: CodexAppServer): Promise<void> {
  const request: ClientRequest = {
    method: "account/logout",
    id: 0,
    params: undefined,
  };
  await server.request(request.method, request.params);
}

export type RateLimitsSummary = {
  /** Null means the backend did not report availability — unknown, not
   * unlimited (per integrations.md G1 step 4). */
  readonly ordinaryUsageAllowed: boolean | null;
  readonly limitIds: readonly string[];
  readonly resetCreditsAvailable: boolean;
};

/** `account/rateLimits/read` — usage availability before a model run. */
export async function accountRateLimitsRead(
  server: CodexAppServer,
): Promise<RateLimitsSummary> {
  const request: ClientRequest = {
    method: "account/rateLimits/read",
    id: 0,
    params: {},
  };
  const result = await server.request(request.method, request.params);
  if (!isRecord(result)) {
    throw new Error(
      "protocol violation: account/rateLimits/read result is not an object",
    );
  }
  const ordinaryUsageAllowed =
    typeof result["ordinaryUsageAllowed"] === "boolean"
      ? result["ordinaryUsageAllowed"]
      : null;
  const byId = result["rateLimitsByLimitId"];
  const limitIds = isRecord(byId) ? Object.keys(byId) : [];
  const resetCredits = result["rateLimitResetCredits"];
  const resetCreditsAvailable = isRecord(resetCredits)
    ? Object.values(resetCredits).some(
        (v) => typeof v === "number" && v > 0,
      ) || Object.keys(resetCredits).length > 0
    : false;
  return { ordinaryUsageAllowed, limitIds, resetCreditsAvailable };
}

export type ThreadHandle = {
  readonly threadId: string;
  readonly model: string;
  readonly modelProvider: string;
  readonly cwd: string;
};

function parseThreadStartResult(result: unknown): ThreadHandle {
  if (!isRecord(result) || !isRecord(result["thread"])) {
    throw new Error("protocol violation: thread result is not an object");
  }
  const thread = result["thread"];
  return {
    threadId: reqString(thread, "id"),
    model: reqString(result, "model"),
    modelProvider: reqString(result, "modelProvider"),
    cwd: reqString(result, "cwd"),
  };
}

/** `thread/start` — create the employee's scoped thread. Sandbox and approval
 * policy are enforced host-side: `approvalPolicy: "never"` plus an explicit
 * `sandbox` keep the turn non-interactive and confined. */
export async function threadStart(
  server: CodexAppServer,
  params: {
    readonly cwd: string;
    readonly model?: string;
    readonly serviceName?: string;
    readonly developerInstructions?: string;
  },
): Promise<ThreadHandle> {
  const request: ClientRequest = {
    method: "thread/start",
    id: 0,
    params: {
      cwd: params.cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      ...(params.model !== undefined ? { model: params.model } : {}),
      ...(params.serviceName !== undefined
        ? { serviceName: params.serviceName }
        : {}),
      ...(params.developerInstructions !== undefined
        ? { developerInstructions: params.developerInstructions }
        : {}),
    },
  };
  const result = await server.request(request.method, request.params);
  return parseThreadStartResult(result);
}

/** `thread/resume` — rejoin a persisted thread after restart. The caller must
 * have already verified the thread belongs to this workspace's employee. */
export async function threadResume(
  server: CodexAppServer,
  params: { readonly threadId: string },
): Promise<ThreadHandle> {
  const request: ClientRequest = {
    method: "thread/resume",
    id: 0,
    params: { threadId: params.threadId, excludeTurns: true },
  };
  const result = await server.request(request.method, request.params);
  return parseThreadStartResult(result);
}

export type TurnHandle = {
  readonly turnId: string;
  readonly status: string;
};

/** `turn/start` — one bounded turn. `input` is a single text item; an
 * `outputSchema` constrains the final assistant message to structured JSON.
 * Default host policy: `approvalPolicy:"never"` + readOnly/no-network. The
 * optional `sandboxPolicy` override exists for environments where codex's
 * bubblewrap sandbox cannot initialise (e.g. a container Box lacking user
 * namespaces) — `externalSandbox` tells codex the host already sandboxes. */
export async function turnStart(
  server: CodexAppServer,
  params: {
    readonly threadId: string;
    readonly prompt: string;
    readonly outputSchema?: JsonValue;
    readonly model?: string;
    readonly sandboxPolicy?:
      | { readonly type: "readOnly"; readonly networkAccess: boolean }
      | { readonly type: "externalSandbox"; readonly networkAccess: "restricted" | "enabled" }
      | { readonly type: "dangerFullAccess" };
  },
): Promise<TurnHandle> {
  const request: ClientRequest = {
    method: "turn/start",
    id: 0,
    params: {
      threadId: params.threadId,
      input: [{ type: "text", text: params.prompt, text_elements: [] }],
      approvalPolicy: "never",
      sandboxPolicy: params.sandboxPolicy ?? {
        type: "readOnly",
        networkAccess: false,
      },
      ...(params.outputSchema !== undefined
        ? { outputSchema: params.outputSchema }
        : {}),
      ...(params.model !== undefined ? { model: params.model } : {}),
    },
  };
  const result = await server.request(request.method, request.params);
  if (!isRecord(result) || !isRecord(result["turn"])) {
    throw new Error("protocol violation: turn/start result is not an object");
  }
  const turn = result["turn"];
  return {
    turnId: reqString(turn, "id"),
    status: reqString(turn, "status"),
  };
}

/** `turn/interrupt` — request termination of a running turn. */
export async function turnInterrupt(
  server: CodexAppServer,
  params: { readonly threadId: string; readonly turnId: string },
): Promise<void> {
  const request: ClientRequest = {
    method: "turn/interrupt",
    id: 0,
    params: { threadId: params.threadId, turnId: params.turnId },
  };
  await server.request(request.method, request.params);
}

export type TurnTerminal = {
  readonly turnId: string;
  readonly status: "completed" | "interrupted" | "failed" | "timeout";
  readonly error?: string;
  /** Raw `turn` payload from `turn/completed` (items incl. final agent
   *  message) — present only on real terminal events, not timeouts. */
  readonly turn?: unknown;
};

/** Wait for the `turn/completed` notification matching thread+turn, or a
 * terminal `error` notification for the same turn. Bounded by `timeoutMs`;
 * a timeout reports `timeout` — the caller must still interrupt/confirm
 * termination before the workspace slot may be reused (G1 req. 8). */
export function waitForTurn(
  server: CodexAppServer,
  args: {
    readonly threadId: string;
    readonly turnId: string;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
  },
): Promise<TurnTerminal> {
  if (args.signal?.aborted) return Promise.reject(new Error("turn wait aborted"));
  return new Promise<TurnTerminal>((resolve, reject) => {
    const done = (value: TurnTerminal) => {
      cleanup();
      resolve(value);
    };
    const timer = setTimeout(() => {
      done({ turnId: args.turnId, status: "timeout" });
    }, args.timeoutMs);
    const onAbort = () => {
      cleanup();
      reject(new Error("turn wait aborted"));
    };
    const off = server.onNotification(
      (notification: ServerNotificationEnvelope) => {
        const method: string = notification.method;
        // Params arrive as `unknown` over the wire; validate before indexing.
        const params: unknown = notification.params;
        if (!isRecord(params)) return;
        if (method === "turn/completed") {
          const turn = params["turn"];
          if (
            params["threadId"] === args.threadId &&
            isRecord(turn) &&
            turn["id"] === args.turnId
          ) {
            const status = turn["status"];
            const err = isRecord(turn["error"])
              ? optString(turn["error"], "message")
              : null;
            done({
              turnId: args.turnId,
              status:
                status === "completed" ||
                status === "interrupted" ||
                status === "failed"
                  ? status
                  : "failed",
              ...(err !== null ? { error: err } : {}),
              turn,
            });
          }
          return;
        }
        if (method === "error") {
          if (
            params["threadId"] === args.threadId &&
            params["turnId"] === args.turnId &&
            params["willRetry"] === false
          ) {
            const err = isRecord(params["error"])
              ? optString(params["error"], "message")
              : null;
            done({
              turnId: args.turnId,
              status: "failed",
              ...(err !== null ? { error: err } : {}),
            });
          }
        }
      },
      true,
    );
    const cleanup = () => {
      clearTimeout(timer);
      off();
      args.signal?.removeEventListener("abort", onAbort);
    };
    args.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type LoginCompletion = {
  readonly loginId: string | null;
  readonly success: boolean;
  readonly error?: string;
};

/** Wait for `account/login/completed` — the only event allowed to mark the
 * workspace Ready (followed by a fresh `account/read`). */
export function waitForLoginCompleted(
  server: CodexAppServer,
  args: {
    readonly loginId: string;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
  },
): Promise<LoginCompletion> {
  if (args.signal?.aborted) return Promise.reject(new Error("login wait aborted"));
  return new Promise<LoginCompletion>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve({ loginId: args.loginId, success: false, error: "timeout" });
    }, args.timeoutMs);
    const onAbort = () => {
      cleanup();
      reject(new Error("login wait aborted"));
    };
    const off = server.onNotification(
      (notification: ServerNotificationEnvelope) => {
        if (notification.method !== "account/login/completed") return;
        const params: unknown = notification.params;
        if (!isRecord(params)) return;
        const loginId =
          typeof params["loginId"] === "string" ? params["loginId"] : null;
        if (loginId !== args.loginId) return;
        cleanup();
        resolve({
          loginId,
          success: params["success"] === true,
          ...(typeof params["error"] === "string"
            ? { error: params["error"] }
            : {}),
        });
      },
      true,
    );
    const cleanup = () => {
      clearTimeout(timer);
      off();
      args.signal?.removeEventListener("abort", onAbort);
    };
    args.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Server-request policy for a non-interactive worker: approval prompts are
 * declined; requests the worker cannot service get a JSON-RPC error so the
 * app-server does not hang. Host policy (`approvalPolicy: "never"`, read-only
 * sandbox) should prevent these from arriving at all — this is the backstop.
 *
 * The production daemon installs `workerServerRequestHandler` (codex/toolRouter.ts)
 * instead, which reproduces every refusal below and replaces only the
 * `item/tool/call` branch with the capability-filtered router. This remains
 * the correct handler for a caller that has NO work context at all — the
 * probes, which never hold a lease and must therefore never route a tool.
 */
export function decliningServerRequestHandler(): ServerRequestHandler {
  return (method, _params) => {
    switch (method) {
      case "item/commandExecution/requestApproval":
        return Promise.resolve({ ok: true, result: { decision: "decline" } });
      case "item/fileChange/requestApproval":
        return Promise.resolve({ ok: true, result: { decision: "decline" } });
      case "applyPatchApproval":
      case "execCommandApproval":
        return Promise.resolve({
          ok: true,
          result: { decision: { denied: { rejection: "denied by worker policy" } } },
        });
      case "item/tool/requestUserInput":
        return Promise.resolve({ ok: true, result: { answers: {} } });
      case "item/tool/call":
        return Promise.resolve({
          ok: true,
          result: { contentItems: [], success: false },
        });
      case "mcpServer/elicitation/request":
        return Promise.resolve({
          ok: true,
          result: { action: "decline", content: null, _meta: null },
        });
      default:
        // account/chatgptAuthTokens/refresh, attestation/generate and any
        // unknown request get a method-not-found error: the worker holds no
        // tokens to refresh and cannot mint attestations.
        return Promise.resolve({
          ok: false,
          error: {
            code: -32601,
            message: `worker policy refuses server request ${method}`,
          },
        });
    }
  };
}
