// Bounded worker run-loop skeleton (G1 requirements 1–8).
//
// Proven locally in the spike: env hygiene check → spawn app-server →
// initialize → account/read → login-or-ready → one bounded turn → structured
// result. The bridge HTTP transport (claim/heartbeat/result endpoints) is P07;
// this file defines the status shape per plan/architecture.md §7 and a
// `BridgeReporter` seam the spike exercises with a local sink.

import type { CodexAppServer } from "./codex/appserver.js";
import { AppServerError } from "./codex/appserver.js";
import type { JsonValue } from "./generated/codex/serde_json/JsonValue";
import {
  accountLoginStartDeviceCode,
  accountRateLimitsRead,
  accountRead,
  accountLoginCancel,
  decliningServerRequestHandler,
  initialize,
  sendInitialized,
  threadStart,
  turnInterrupt,
  turnStart,
  waitForLoginCompleted,
  waitForTurn,
  WORKER_PROTOCOL_VERSION,
  type AccountState,
  type DeviceCodeChallenge,
  type RateLimitsSummary,
  type ServerIdentity,
  type ThreadHandle,
  type TurnTerminal,
} from "./codex/methods.js";
import type { WorkerConfig } from "./config.js";

/** Worker lifecycle phase reported via runtime-heartbeat. */
export type WorkerPhase =
  | "starting"
  | "env_check"
  | "idle"
  | "login_pending"
  | "ready"
  | "running_turn"
  | "stopping"
  | "stopped"
  | "error";

/** Shape of `POST /worker/runtime-heartbeat` (plan/architecture.md §7).
 * Liveness only — never grants or renews a model lease. */
export type RuntimeHeartbeat = {
  readonly runtimeGeneration: number;
  readonly workerVersion: string;
  readonly protocolVersion: string;
  readonly phase: WorkerPhase;
  readonly currentRunId?: string;
  readonly currentCodexTurnRef?: string;
  readonly heartbeatAt: number;
};

/** P07 seam: the Convex bridge reporter. The spike uses a local sink that
 * records payloads for inspection instead of POSTing to .convex.site. */
export interface BridgeReporter {
  runtimeHeartbeat(h: RuntimeHeartbeat): Promise<void>;
  /** Deliver an owner-only login challenge (URL + code are secret-class). */
  reportLoginChallenge(challenge: {
    readonly loginId: string;
    readonly verificationUrl: string;
    readonly userCode: string;
    readonly expiresHint?: string;
  }): Promise<void>;
  reportStatus(status: {
    readonly state: string;
    readonly detail?: string;
  }): Promise<void>;
  reportResult(result: unknown): Promise<void>;
}

export type BoundedTurnInput = {
  readonly threadId?: string;
  readonly cwd: string;
  readonly prompt: string;
  readonly outputSchema?: JsonValue;
  readonly model?: string;
  readonly turnDeadlineMs: number;
  readonly runId?: string;
};

export type RunLoopOutcome =
  | { readonly kind: "idle_ready" }
  | {
      readonly kind: "login_started";
      readonly loginId: string;
      readonly challengeDelivered: boolean;
      readonly completed: boolean;
      readonly error?: string;
    }
  | {
      readonly kind: "turn";
      readonly threadId: string;
      readonly turn: TurnTerminal;
    }
  | {
      readonly kind: "blocked";
      readonly reason: string;
      readonly rateLimits?: RateLimitsSummary;
    };

export type RunLoopDeps = {
  readonly config: WorkerConfig;
  readonly reporter: BridgeReporter;
  readonly loginTimeoutMs?: number;
};

export class WorkerRunLoop {
  readonly #config: WorkerConfig;
  readonly #reporter: BridgeReporter;
  readonly #loginTimeoutMs: number;
  #phase: WorkerPhase = "starting";
  #currentRunId: string | undefined;
  #currentTurnRef: string | undefined;

  constructor(deps: RunLoopDeps) {
    this.#config = deps.config;
    this.#reporter = deps.reporter;
    this.#loginTimeoutMs = deps.loginTimeoutMs ?? 10 * 60_000;
  }

  get phase(): WorkerPhase {
    return this.#phase;
  }

  heartbeatSnapshot(): RuntimeHeartbeat {
    return {
      runtimeGeneration: this.#config.runtimeGeneration,
      workerVersion: this.#config.workerVersion,
      protocolVersion: WORKER_PROTOCOL_VERSION,
      phase: this.#phase,
      ...(this.#currentRunId !== undefined
        ? { currentRunId: this.#currentRunId }
        : {}),
      ...(this.#currentTurnRef !== undefined
        ? { currentCodexTurnRef: this.#currentTurnRef }
        : {}),
      heartbeatAt: Date.now(),
    };
  }

  async #setPhase(phase: WorkerPhase, detail?: string): Promise<void> {
    this.#phase = phase;
    await this.#reporter.runtimeHeartbeat(this.heartbeatSnapshot());
    if (detail !== undefined) {
      await this.#reporter.reportStatus({ state: phase, detail });
    }
  }

  /**
   * One bounded pass: handshake → account → login-if-needed → optional turn.
   * Deliberately performs at most one model turn; the steady-state claim loop
   * over `/worker/claim` is P07 scope.
   */
  async runOnce(
    server: CodexAppServer,
    turn?: BoundedTurnInput,
  ): Promise<RunLoopOutcome> {
    await this.#setPhase("env_check");

    server.setServerRequestHandler(decliningServerRequestHandler());

    let identity: ServerIdentity;
    try {
      identity = await initialize(server, this.#config.workerVersion);
      sendInitialized(server);
    } catch (err) {
      await this.#setPhase(
        "error",
        `initialize failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { kind: "blocked", reason: "app-server initialize failed" };
    }

    let account: AccountState;
    try {
      account = await accountRead(server, { refreshToken: false });
    } catch (err) {
      await this.#setPhase(
        "error",
        `account/read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { kind: "blocked", reason: "account read failed" };
    }

    if (account.account.state === "none" && account.requiresOpenaiAuth) {
      return this.#loginFlow(server);
    }
    if (account.account.state === "none") {
      // No account and none required — external/auth-token mode not used by
      // OpenSquad's managed path; report blocked rather than infer access.
      await this.#setPhase("error", "no account and requiresOpenaiAuth=false");
      return {
        kind: "blocked",
        reason: "no codex account and server reports auth not required",
      };
    }

    await this.#setPhase("ready", `codex ${identity.userAgent}`);
    if (turn === undefined) {
      await this.#setPhase("idle");
      return { kind: "idle_ready" };
    }
    return this.#boundedTurn(server, turn);
  }

  async #loginFlow(server: CodexAppServer): Promise<RunLoopOutcome> {
    let challenge: DeviceCodeChallenge;
    try {
      const started = await accountLoginStartDeviceCode(server);
      if (started.kind !== "deviceCode") {
        await this.#setPhase(
          "error",
          `login/start returned unexpected type ${started.type}`,
        );
        return {
          kind: "blocked",
          reason: `unexpected login start type: ${started.type}`,
        };
      }
      challenge = started.challenge;
    } catch (err) {
      const message =
        err instanceof AppServerError
          ? `${err.code}: ${err.message}`
          : String(err);
      await this.#setPhase("error", `login/start failed: ${message}`);
      return { kind: "blocked", reason: `login start failed: ${message}` };
    }

    await this.#setPhase("login_pending");
    // The challenge is delivered to the owner-only short-lived record via the
    // reporter seam. It is never logged or put in activity (integrations.md §G1-2).
    try {
      await this.#reporter.reportLoginChallenge({
        loginId: challenge.loginId,
        verificationUrl: challenge.verificationUrl,
        userCode: challenge.userCode,
      });
    } catch (err) {
      // Cannot reach the owner — cancel the pending login so nothing lingers.
      await accountLoginCancel(server, challenge.loginId).catch(() => {});
      return {
        kind: "login_started",
        loginId: challenge.loginId,
        challengeDelivered: false,
        completed: false,
        error: `challenge delivery failed: ${String(err)}`,
      };
    }

    const completion = await waitForLoginCompleted(server, {
      loginId: challenge.loginId,
      timeoutMs: this.#loginTimeoutMs,
    });
    if (!completion.success) {
      await accountLoginCancel(server, challenge.loginId).catch(() => {});
      await this.#setPhase(
        "idle",
        `login not completed: ${completion.error ?? "failed"}`,
      );
      return {
        kind: "login_started",
        loginId: challenge.loginId,
        challengeDelivered: true,
        completed: false,
        ...(completion.error !== undefined ? { error: completion.error } : {}),
      };
    }
    // Only a fresh account read after a matching success may set Ready.
    const verified = await accountRead(server, { refreshToken: false });
    if (verified.account.state === "none") {
      await this.#setPhase("idle", "login completed but account still absent");
      return {
        kind: "login_started",
        loginId: challenge.loginId,
        challengeDelivered: true,
        completed: false,
        error: "post-login account read returned no account",
      };
    }
    await this.#setPhase("ready", "managed login verified");
    return {
      kind: "login_started",
      loginId: challenge.loginId,
      challengeDelivered: true,
      completed: true,
    };
  }

  async #boundedTurn(
    server: CodexAppServer,
    turn: BoundedTurnInput,
  ): Promise<RunLoopOutcome> {
    // G1 step 4: rate-limit metadata check. Missing metadata is unknown, not
    // unlimited; an explicit "not allowed" blocks the run.
    let rateLimits: RateLimitsSummary | undefined;
    try {
      rateLimits = await accountRateLimitsRead(server);
    } catch {
      rateLimits = undefined;
    }
    if (rateLimits?.ordinaryUsageAllowed === false) {
      await this.#setPhase("idle", "ordinary usage not allowed by account");
      return {
        kind: "blocked",
        reason: "account rate limits disallow ordinary usage",
        rateLimits,
      };
    }

    let thread: ThreadHandle;
    try {
      thread = await threadStart(server, {
        cwd: turn.cwd,
        ...(turn.model !== undefined ? { model: turn.model } : {}),
        serviceName: "opensquad",
      });
    } catch (err) {
      return {
        kind: "blocked",
        reason: `thread/start failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    this.#currentRunId = turn.runId;
    try {
      const started = await turnStart(server, {
        threadId: thread.threadId,
        prompt: turn.prompt,
        ...(turn.outputSchema !== undefined
          ? { outputSchema: turn.outputSchema }
          : {}),
        ...(turn.model !== undefined ? { model: turn.model } : {}),
      });
      this.#currentTurnRef = started.turnId;
      await this.#setPhase("running_turn", `turn ${started.turnId}`);

      const terminal = await waitForTurn(server, {
        threadId: thread.threadId,
        turnId: started.turnId,
        timeoutMs: turn.turnDeadlineMs,
      });
      if (terminal.status === "timeout") {
        // G1 req. 8: request interrupt and confirm termination before the
        // workspace slot may be released or a replacement started.
        await turnInterrupt(server, {
          threadId: thread.threadId,
          turnId: started.turnId,
        }).catch(() => {});
        const confirmed = await waitForTurn(server, {
          threadId: thread.threadId,
          turnId: started.turnId,
          timeoutMs: 30_000,
        });
        await this.#setPhase(
          "idle",
          confirmed.status === "timeout"
            ? "turn termination unconfirmed — needs attention"
            : `turn ${confirmed.status}`,
        );
        return {
          kind: "turn",
          threadId: thread.threadId,
          turn: confirmed.status === "timeout" ? terminal : confirmed,
        };
      }
      await this.#setPhase("idle", `turn ${terminal.status}`);
      return { kind: "turn", threadId: thread.threadId, turn: terminal };
    } finally {
      this.#currentRunId = undefined;
      this.#currentTurnRef = undefined;
    }
  }
}
