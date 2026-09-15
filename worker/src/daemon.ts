// Production worker daemon (P07) — outbound-polling bridge worker.
//
// Runs inside the ASCII Box as the supervised service. Three loops:
//
//   controlLoop      POST /worker/control/claim — owner commands (account
//                    inspect, device-code login start/cancel, logout,
//                    interrupt_turn). This path stays responsive while a
//                    model turn is running.
//   workLoop         POST /worker/claim — at most one leased request at a
//                    time (the backend's workspaceExecutionSlots row is the
//                    authority); heartbeats renew the lease and may order a
//                    stop; results/failures are posted exactly-once with a
//                    worker-computed canonical digest.
//   heartbeatLoop    POST /worker/runtime-heartbeat — liveness + version,
//                    never a lease operation.
//
// Safety properties preserved from the spike/review work: env hygiene gate,
// declining server-request handler, managed-login verification before Ready,
// bounded turns, interrupt+confirm before reporting a dead turn, non-zero
// exit on unexpected app-server death, and exit 78 on a permanently dead
// credential so provisioning — not restart loops — replaces the runtime.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CodexAppServer, ServerRequestHandler } from "./codex/appserver.js";
import { AppServerError } from "./codex/appserver.js";
import { workerServerRequestHandler } from "./codex/toolRouter.js";
import type { ParsedToolCall, ToolCallOutcome } from "./codex/toolRouter.js";
import {
  accountLoginCancel,
  accountLoginStartDeviceCode,
  accountLogout,
  accountRateLimitsRead,
  accountRead,
  threadResume,
  threadStart,
  turnInterrupt,
  turnStart,
  waitForLoginCompleted,
  waitForTurn,
} from "./codex/methods.js";
import type { AccountState, TurnTerminal } from "./codex/methods.js";
import type { WorkerConfig } from "./config.js";
import {
  BridgeAuthError,
  BridgeClient,
  BridgeConflictError,
  BridgeError,
  BridgeRetryableError,
} from "./bridge.js";
import {
  buildWorkerResult,
  extractFinalOutputText,
} from "./contracts.js";
import type {
  ClaimedControl,
  ClaimedWork,
  ControlStatus,
  WorkerPhase,
} from "./contracts.js";
import { mintBridgeId } from "./ids.js";

const CONTROL_POLL_MS = 2_500;
const WORK_POLL_MS = 3_000;
const RUNTIME_HEARTBEAT_MS = 15_000;
const WORK_HEARTBEAT_MS = 15_000;
const INTERRUPT_CONFIRM_MS = 30_000;
const LOGIN_WAIT_MAX_MS = 9 * 60_000;
const ACCOUNT_RECHECK_MS = 60_000;

function log(event: string, fields?: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({ kind: "daemon", event, ...fields })}\n`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runtime-reported phases never exceed the bridge enum. */
function bridgePhaseFor(
  phase: "boot" | "ready" | "running" | "degraded" | "stopping",
): WorkerPhase {
  return phase;
}

/** Whether the app-server account can run managed model work — an API-key
 *  account is not a managed worker login (review fix). */
function managedAccountReady(account: AccountState): boolean {
  if (account.account.state === "apiKey") {
    return false;
  }
  return (
    account.account.state === "chatgpt" ||
    (account.account.state !== "none" && !account.requiresOpenaiAuth)
  );
}

type ActiveLogin = {
  readonly loginId: string;
  readonly controlRequestId: string;
  readonly abort: AbortController;
};

export class WorkerDaemon {
  readonly #config: WorkerConfig;
  readonly #server: CodexAppServer;
  readonly #bridge: BridgeClient;
  #phase: "boot" | "ready" | "running" | "degraded" | "stopping" = "boot";
  #accountReady = false;
  #stopping = false;
  #fatal: Error | null = null;
  #currentWork: ClaimedWork | null = null;
  #currentTurnRef: string | null = null;
  /** Tool calls accepted for the CURRENT request. Reset on every claim; the
   *  budget is `constraints.maxToolCalls`, and an absent constraint means
   *  zero. This counter is the fast local half — Convex keeps the
   *  authoritative one on the request row, because the worker is untrusted. */
  #toolCallsUsed = 0;
  #activeLogin: ActiveLogin | null = null;
  /** controlRequestIds currently executing — the bridge re-delivers a
   *  claimed command on every poll (crash recovery), so the same request
   *  must never be run twice concurrently. */
  #executingControls = new Set<string>();
  /** Terminal results the bridge hasn't acked yet — a redelivered claimed
   *  row reposts the stored result (same resultId) instead of re-executing
   *  the command; re-running a start_login would mint a second device-code
   *  challenge mid-entry. */
  #settledControls = new Map<
    string,
    { status: ControlStatus; safeResult: Record<string, unknown>; resultId: string }
  >();

  constructor(config: WorkerConfig, server: CodexAppServer) {
    this.#config = config;
    this.#server = server;
    this.#bridge = new BridgeClient(config);
  }

  /**
   * The app-server's single server-request handler, built once and installed
   * at boot. It closes over `this` rather than over a work item, so it always
   * reads the lease the daemon holds at call time — installing it per turn
   * would race the control loop, which drives `accountRead`/`turnInterrupt`
   * through the same connection while a turn is running.
   */
  serverRequestHandler(): ServerRequestHandler {
    return workerServerRequestHandler({
      currentWork: () => this.#currentWork,
      currentTurnRef: () => this.#currentTurnRef,
      consumeToolCall: () => this.#consumeToolCall(),
      invokeTool: (work, call) => this.#invokeTool(work, call),
      log: (event, fields) => log(event, fields),
    });
  }

  /** Spend one tool call against `constraints.maxToolCalls`. An absent
   *  constraint is zero, not unlimited. */
  #consumeToolCall(): boolean {
    const budget = this.#currentWork?.input.constraints.maxToolCalls ?? 0;
    if (this.#toolCallsUsed >= budget) {
      return false;
    }
    this.#toolCallsUsed += 1;
    return true;
  }

  /**
   * Execute a permitted tool through the backend. No provider credential
   * exists inside the Box (envcheck refuses to start with one), so every
   * paid call runs Convex-side; until the bridge carries a tool channel
   * there is nothing to call, and a permitted tool reports an explicit
   * unknown rather than a fabricated result.
   */
  async #invokeTool(
    _work: ClaimedWork,
    call: ParsedToolCall,
  ): Promise<ToolCallOutcome> {
    log("tool_unavailable", { tool: call.tool, reason: "no_backend_channel" });
    return {
      kind: "unavailable",
      text: JSON.stringify({
        status: "unavailable",
        reason: "the research channel is not available on this build",
      }),
    };
  }

  /** Signal handler hook — stop accepting work, let the lease lapse. */
  requestStop(): void {
    this.#stopping = true;
    this.#phase = "stopping";
  }

  get fatalError(): Error | null {
    return this.#fatal;
  }

  /**
   * Run the poll loops until stopped or the credential dies.
   * Returns the process exit code: 0 = clean stop, 78 = dead credential
   * (provisioning must replace), 1 = unexpected failure.
   */
  async run(): Promise<number> {
    // Verify account posture once — no implicit login; the owner drives it
    // via the control channel (start_login). A slow recheck keeps polling so
    // a transient read failure or a completed login is never sticky.
    try {
      const account = await accountRead(this.#server, { refreshToken: false });
      this.#applyAccountReadiness(managedAccountReady(account));
      log("account_state", { state: account.account.state });
    } catch (error) {
      this.#phase = "degraded";
      log("account_read_failed", { error: errorMessage(error) });
    }

    const heartbeat = setInterval(
      () => void this.#runtimeHeartbeat(),
      RUNTIME_HEARTBEAT_MS,
    );
    const control = setInterval(() => void this.#controlTick(), CONTROL_POLL_MS);
    const work = setInterval(() => void this.#workTick(), WORK_POLL_MS);
    const accountRecheck = setInterval(
      () => void this.#accountRecheck(),
      ACCOUNT_RECHECK_MS,
    );
    void this.#runtimeHeartbeat();

    try {
      while (!this.#stopping && this.#fatal === null) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    } finally {
      clearInterval(heartbeat);
      clearInterval(control);
      clearInterval(work);
      clearInterval(accountRecheck);
    }
    if (this.#fatal !== null) {
      return this.#fatal instanceof BridgeAuthError ? 78 : 1;
    }
    return 0;
  }

  #isFatal(error: unknown): boolean {
    if (error instanceof BridgeAuthError) {
      this.#fatal = error;
      log("credential_dead", { error: error.message });
      return true;
    }
    return false;
  }

  /** Apply an observed account posture — never clobbers running/stopping. */
  #applyAccountReadiness(ready: boolean): void {
    this.#accountReady = ready;
    if (this.#phase === "running" || this.#phase === "stopping") {
      return;
    }
    this.#phase = ready ? "ready" : "degraded";
  }

  /** Slow account re-read while unauthenticated: a boot-time read failure or
   *  an externally completed login must not park work claims forever. */
  async #accountRecheck(): Promise<void> {
    if (this.#accountReady || this.#stopping || this.#fatal !== null) {
      return;
    }
    try {
      const account = await accountRead(this.#server, { refreshToken: false });
      this.#applyAccountReadiness(managedAccountReady(account));
      if (this.#accountReady) {
        log("account_ready", { state: account.account.state });
      }
    } catch {
      // stay degraded — the next tick re-checks
    }
  }

  async #runtimeHeartbeat(): Promise<void> {
    try {
      await this.#bridge.runtimeHeartbeat({
        phase: bridgePhaseFor(this.#phase),
        ...(this.#currentWork !== null
          ? { currentRunId: this.#currentWork.runId }
          : {}),
        ...(this.#currentTurnRef !== null
          ? { currentCodexTurnRef: this.#currentTurnRef }
          : {}),
      });
    } catch (error) {
      if (this.#isFatal(error)) return;
      log("runtime_heartbeat_error", { error: errorMessage(error) });
    }
  }

  /* ------------------------- control channel ------------------------- */

  async #controlTick(): Promise<void> {
    if (this.#stopping || this.#fatal !== null) return;
    let claim: ClaimedControl | null;
    try {
      claim = await this.#bridge.claimControl();
    } catch (error) {
      if (this.#isFatal(error)) return;
      if (!(error instanceof BridgeError)) {
        log("control_claim_error", { error: errorMessage(error) });
      }
      return;
    }
    if (claim === null) return;
    // The bridge re-delivers a still-claimed command while it executes —
    // without this gate a second start_login would race the first and post
    // a terminal "failed" onto the live login request. A command whose
    // result post was dropped is NOT re-executed — the recorded result is
    // reposted with its original resultId.
    const settled = this.#settledControls.get(claim.controlRequestId);
    if (settled !== undefined) {
      void this.#repostControlResult(claim.controlRequestId, settled);
      return;
    }
    if (this.#executingControls.has(claim.controlRequestId)) {
      return;
    }
    this.#executingControls.add(claim.controlRequestId);
    log("control_claimed", {
      controlRequestId: claim.controlRequestId,
      command: claim.command,
    });
    // Executed without blocking the poll loop — login waits take minutes.
    void this.#executeControl(claim)
      .catch((error) => {
        if (this.#isFatal(error)) return;
        log("control_execute_error", {
          command: claim.command,
          error: errorMessage(error),
        });
        void this.#postControlResult(claim.controlRequestId, "failed", {
          error: errorMessage(error).slice(0, 300),
        });
      })
      .finally(() => {
        this.#executingControls.delete(claim.controlRequestId);
      });
  }

  /** Deliver a terminal control outcome; keeps it in #settledControls until
   *  the bridge acks so a redelivered claim reposts rather than re-runs. */
  async #postControlResult(
    controlRequestId: string,
    status: ControlStatus,
    safeResult: Record<string, unknown>,
  ): Promise<void> {
    const settled = {
      status,
      safeResult,
      resultId: mintBridgeId("cres"),
    };
    this.#settledControls.set(controlRequestId, settled);
    await this.#deliverControlResult(controlRequestId, settled);
  }

  /** Repost an already-recorded outcome for a redelivered claimed row. */
  async #repostControlResult(
    controlRequestId: string,
    settled: {
      status: ControlStatus;
      safeResult: Record<string, unknown>;
      resultId: string;
    },
  ): Promise<void> {
    if (this.#executingControls.has(controlRequestId)) return;
    this.#executingControls.add(controlRequestId);
    try {
      await this.#deliverControlResult(controlRequestId, settled);
    } finally {
      this.#executingControls.delete(controlRequestId);
    }
  }

  async #deliverControlResult(
    controlRequestId: string,
    settled: {
      status: ControlStatus;
      safeResult: Record<string, unknown>;
      resultId: string;
    },
  ): Promise<void> {
    try {
      await this.#bridge.reportControlResult(
        controlRequestId,
        settled.status,
        settled.safeResult,
        settled.resultId,
      );
      this.#settledControls.delete(controlRequestId);
    } catch (error) {
      if (this.#isFatal(error)) {
        // Credential is dead — nothing can ever be reposted.
        this.#settledControls.delete(controlRequestId);
        return;
      }
      if (error instanceof BridgeConflictError) {
        // Expired/retired control request — the outcome is moot.
        this.#settledControls.delete(controlRequestId);
        log("control_result_dropped", {
          controlRequestId,
          status: settled.status,
        });
        return;
      }
      // Transient failure — stays settled; the next claim redelivery reposts.
      log("control_result_error", {
        controlRequestId,
        error: errorMessage(error),
      });
    }
  }

  async #executeControl(claim: ClaimedControl): Promise<void> {
    switch (claim.command) {
      case "inspect_account": {
        const account = await accountRead(this.#server, {
          refreshToken: false,
        });
        this.#applyAccountReadiness(managedAccountReady(account));
        await this.#postControlResult(
          claim.controlRequestId,
          "completed",
          {
            account: {
              state: account.account.state,
              ...(account.account.state === "chatgpt" &&
              account.account.planType !== null
                ? { planType: account.account.planType }
                : {}),
            },
            requiresOpenaiAuth: account.requiresOpenaiAuth,
          },
        );
        return;
      }
      case "start_login": {
        if (this.#activeLogin !== null) {
          await this.#postControlResult(claim.controlRequestId, "failed", {
            error: "a login is already in progress",
          });
          return;
        }
        const started = await accountLoginStartDeviceCode(this.#server);
        if (started.kind !== "deviceCode") {
          await this.#postControlResult(claim.controlRequestId, "failed", {
            error: `unexpected login start type ${started.type}`,
          });
          return;
        }
        const challenge = started.challenge;
        const abort = new AbortController();
        this.#activeLogin = {
          loginId: challenge.loginId,
          controlRequestId: claim.controlRequestId,
          abort,
        };
        // Deliver the challenge FIRST — only then does the wait begin.
        await this.#postControlResult(
          claim.controlRequestId,
          "challenge_issued",
          {
            loginId: challenge.loginId,
            verificationUrl: challenge.verificationUrl,
            userCode: challenge.userCode,
          },
        );
        const waitMs = Math.min(
          LOGIN_WAIT_MAX_MS,
          Math.max(30_000, claim.expiresAt - Date.now() - 15_000),
        );
        const completion = await waitForLoginCompleted(this.#server, {
          loginId: challenge.loginId,
          timeoutMs: waitMs,
          signal: abort.signal,
        }).catch((error) => ({
          loginId: challenge.loginId,
          success: false,
          error: errorMessage(error),
        }));
        this.#activeLogin = null;
        if (!completion.success) {
          await accountLoginCancel(this.#server, challenge.loginId).catch(
            () => {},
          );
          await this.#postControlResult(claim.controlRequestId, "failed", {
            error: completion.error ?? "login did not complete",
          });
          return;
        }
        // Fresh account read is the only valid Ready proof (review fix).
        const verified = await accountRead(this.#server, {
          refreshToken: false,
        });
        const ok = verified.account.state === "chatgpt";
        this.#applyAccountReadiness(ok);
        await this.#postControlResult(
          claim.controlRequestId,
          ok ? "completed" : "failed",
          ok
            ? {
                account: {
                  state: verified.account.state,
                  ...(verified.account.state === "chatgpt" &&
                  verified.account.planType !== null
                    ? { planType: verified.account.planType }
                    : {}),
                },
              }
            : { error: "login completed but account is not chatgpt" },
        );
        return;
      }
      case "cancel_login": {
        const active = this.#activeLogin;
        if (
          active === null ||
          (claim.loginId !== undefined && claim.loginId !== active.loginId)
        ) {
          await this.#postControlResult(claim.controlRequestId, "completed", {
            cancelled: false,
            reason: "no matching pending login",
          });
          return;
        }
        active.abort.abort();
        const status = await accountLoginCancel(
          this.#server,
          active.loginId,
        ).catch(() => "unknown" as const);
        this.#activeLogin = null;
        await this.#postControlResult(claim.controlRequestId, "completed", {
          cancelled: status === "canceled",
          reason: status,
        });
        return;
      }
      case "logout": {
        await accountLogout(this.#server);
        this.#applyAccountReadiness(false);
        await this.#postControlResult(claim.controlRequestId, "completed", {});
        return;
      }
      case "interrupt_turn": {
        const turnRef = this.#currentTurnRef;
        const running = turnRef !== null && this.#currentWork !== null;
        // No turnId = "interrupt whatever turn is running" — issued by the
        // lease-expiry sweep when the backend never learned the ref. The
        // uncertain slot blocks new claims, so the only turn that can be
        // running is the orphaned one.
        const matches =
          running &&
          (claim.turnId === undefined ||
            (claim.threadId !== undefined
              ? turnRef === `${claim.threadId}:${claim.turnId}`
              : turnRef.split(":")[1] === claim.turnId));
        if (!matches || turnRef === null) {
          // The targeted turn is not running on this worker — that IS a
          // confirmed termination (a restarted worker kills its app-server
          // child and every turn it hosted; a finished turn is gone too).
          // Reporting terminated:false here would leave the workspace's
          // uncertain slot wedged forever.
          await this.#postControlResult(claim.controlRequestId, "completed", {
            terminated: true,
            reason: running
              ? "a different turn is running; the targeted turn is gone"
              : "no matching active turn",
          });
          return;
        }
        const [threadId, turnId] = turnRef.split(":");
        await turnInterrupt(this.#server, {
          threadId: threadId ?? "",
          turnId: turnId ?? "",
        }).catch(() => {});
        const confirmed = await waitForTurn(this.#server, {
          threadId: threadId ?? "",
          turnId: turnId ?? "",
          timeoutMs: INTERRUPT_CONFIRM_MS,
        }).catch(() => null);
        await this.#postControlResult(claim.controlRequestId, "completed", {
          terminated:
            confirmed !== null &&
            (confirmed.status === "interrupted" ||
              confirmed.status === "completed" ||
              confirmed.status === "failed"),
          reason: confirmed?.status ?? "unconfirmed",
        });
        return;
      }
    }
  }

  /* ------------------------- model work ------------------------------- */

  async #workTick(): Promise<void> {
    if (
      this.#stopping ||
      this.#fatal !== null ||
      this.#currentWork !== null ||
      this.#phase === "boot" ||
      // No managed login = claiming would only fail turn setup and burn the
      // request's honest state — park until the account read says ready.
      !this.#accountReady
    ) {
      return;
    }
    let work: ClaimedWork | null;
    try {
      work = await this.#bridge.claimWork();
    } catch (error) {
      if (this.#isFatal(error)) return;
      if (error instanceof BridgeRetryableError) {
        return; // backoff via the interval
      }
      log("work_claim_error", { error: errorMessage(error) });
      return;
    }
    if (work === null) return;
    log("work_claimed", {
      workerRequestId: work.workerRequestId,
      operation: work.operation,
      generation: work.generation,
    });
    this.#currentWork = work;
    this.#toolCallsUsed = 0;
    const priorPhase = this.#phase;
    this.#phase = "running";
    try {
      await this.#executeWork(work);
    } catch (error) {
      if (!this.#isFatal(error)) {
        log("work_execute_error", {
          workerRequestId: work.workerRequestId,
          error: errorMessage(error),
        });
        await this.#reportFailureSafe(work, {
          code: "worker_error",
          retrySafety: "unknown",
          summary: errorMessage(error),
        });
      }
    } finally {
      this.#currentWork = null;
      this.#currentTurnRef = null;
      this.#phase = priorPhase === "running" ? "ready" : priorPhase;
    }
  }

  async #reportFailureSafe(
    work: ClaimedWork,
    args: { code: string; retrySafety: "safe" | "unsafe" | "unknown"; summary: string },
  ): Promise<void> {
    try {
      await this.#bridge.reportFailure(work, {
        failureId: mintBridgeId("fail"),
        ...args,
      });
    } catch (error) {
      this.#isFatal(error);
      log("failure_report_error", { error: errorMessage(error) });
    }
  }

  /**
   * §7.7 last resort — the daemon could not prove a turn died. Kill the
   * app-server child (process death is the only reliable termination
   * proof) and exit non-zero so the supervisor restarts a fresh worker.
   * The backend keeps the slot `uncertain` until a post-restart
   * interrupt_turn confirms nothing is running.
   */
  async #dieAfterUnconfirmedTermination(detail: string): Promise<void> {
    log("unconfirmed_termination_exit", { detail });
    await this.#server.close().catch(() => {});
    this.#fatal = new Error(`${detail}; restarting to guarantee turn death`);
  }

  /** Lease heartbeat during a turn — "stop" aborts the turn wait. */
  async #workHeartbeatLoop(
    work: ClaimedWork,
    stop: AbortController,
  ): Promise<void> {
    while (!stop.signal.aborted && this.#currentWork !== null) {
      await new Promise((resolve) => setTimeout(resolve, WORK_HEARTBEAT_MS));
      if (stop.signal.aborted) return;
      try {
        const instruction = await this.#bridge.heartbeat(
          work,
          bridgePhaseFor("running"),
        );
        if (instruction === "stop") {
          log("work_stop_ordered", { workerRequestId: work.workerRequestId });
          stop.abort();
          return;
        }
      } catch (error) {
        if (this.#isFatal(error)) return;
        if (error instanceof BridgeConflictError) {
          // Lease lost — stop the turn; the report will be a 409 no-op.
          stop.abort();
          return;
        }
        log("work_heartbeat_error", { error: errorMessage(error) });
      }
    }
  }

  async #executeWork(work: ClaimedWork): Promise<void> {
    const input = work.input;
    const stop = new AbortController();
    const heartbeatLoop = this.#workHeartbeatLoop(work, stop);

    // Rate-limit posture — metadata unknown is not "unlimited".
    const limits = await accountRateLimitsRead(this.#server).catch(
      () => undefined,
    );
    if (limits?.ordinaryUsageAllowed === false) {
      stop.abort();
      await heartbeatLoop;
      await this.#reportFailureSafe(work, {
        code: "rate_limited",
        retrySafety: "safe",
        summary: "account rate limits disallow ordinary usage",
      });
      return;
    }

    // Scoped thread: resume a saved thread when the dispatch carries one.
    const workDir = join(this.#config.workDir, work.workerRequestId);
    await mkdir(workDir, { recursive: true, mode: 0o700 });
    let thread;
    try {
      thread =
        input.session?.codexThreadRef !== undefined
          ? await threadResume(this.#server, {
              threadId: input.session.codexThreadRef,
            })
          : await threadStart(this.#server, {
              cwd: workDir,
              serviceName: "opensquad",
              ...(input.constraints.model !== undefined
                ? { model: input.constraints.model }
                : {}),
            });
    } catch (error) {
      stop.abort();
      await heartbeatLoop;
      await this.#reportFailureSafe(work, {
        code: "thread_setup_failed",
        retrySafety: "safe",
        summary: errorMessage(error),
      });
      return;
    }

    let turn;
    try {
      turn = await turnStart(this.#server, {
        threadId: thread.threadId,
        prompt: input.prompt,
        outputSchema: input.outputSchema as never,
        ...(input.constraints.model !== undefined
          ? { model: input.constraints.model }
          : {}),
        ...(process.env["OPENSQUAD_CODEX_SANDBOX"] === "externalSandbox"
          ? {
              sandboxPolicy: {
                type: "externalSandbox" as const,
                networkAccess: "restricted" as const,
              },
            }
          : {}),
      });
    } catch (error) {
      stop.abort();
      await heartbeatLoop;
      // An AppServerError means the server processed and REJECTED the start
      // — the turn never ran, safely reportable as failed. A timeout or a
      // mid-request disconnect proves nothing: the turn may be live, so the
      // report is unconfirmed (§7.7) and this process exits — child-process
      // death is the only reliable termination proof.
      if (error instanceof AppServerError) {
        await this.#reportFailureSafe(work, {
          code: "turn_start_failed",
          retrySafety: "safe",
          summary: errorMessage(error),
        });
        return;
      }
      await this.#reportFailureSafe(work, {
        code: "turn_start_unconfirmed",
        retrySafety: "unknown",
        summary: `turn start outcome unknown: ${errorMessage(error)}`,
      });
      await this.#dieAfterUnconfirmedTermination("turn start unconfirmed");
      return;
    }
    // Reported as `threadId:turnId` — the backend splits on ':' for
    // interrupt_turn control requests.
    this.#currentTurnRef = `${thread.threadId}:${turn.turnId}`;
    void this.#bridge
      .recordActivity(
        work,
        mintBridgeId("act"),
        "worker_progress",
        "turn started",
        "running",
      )
      .catch(() => {});

    const deadlineMs = Math.min(input.constraints.deadlineMs, 30 * 60_000);
    const terminal:
      | TurnTerminal
      | { turnId: string; status: "aborted"; error: string } =
      await waitForTurn(this.#server, {
        threadId: thread.threadId,
        turnId: turn.turnId,
        timeoutMs: deadlineMs,
        signal: stop.signal,
      }).catch((error) => ({
        turnId: turn.turnId,
        status: "aborted" as const,
        error: errorMessage(error),
      }));
    stop.abort();
    await heartbeatLoop;

    if (terminal.status === "aborted") {
      // Ordered stop or lost lease — interrupt, confirm, report.
      await turnInterrupt(this.#server, {
        threadId: thread.threadId,
        turnId: turn.turnId,
      }).catch(() => {});
      const confirmed = await waitForTurn(this.#server, {
        threadId: thread.threadId,
        turnId: turn.turnId,
        timeoutMs: INTERRUPT_CONFIRM_MS,
      }).catch(() => null);
      await this.#reportFailureSafe(work, {
        code: confirmed === null ? "interruption_unconfirmed" : "cancelled",
        retrySafety: "safe",
        summary:
          confirmed === null
            ? "stop ordered; turn termination unconfirmed"
            : "stop ordered by the backend",
      });
      if (confirmed === null) {
        // The turn could not be proven dead — exit so the supervisor
        // restarts a fresh app-server; process death IS the proof.
        await this.#dieAfterUnconfirmedTermination("interruption unconfirmed");
      }
      return;
    }

    if (terminal.status === "timeout") {
      await turnInterrupt(this.#server, {
        threadId: thread.threadId,
        turnId: turn.turnId,
      }).catch(() => {});
      const confirmed = await waitForTurn(this.#server, {
        threadId: thread.threadId,
        turnId: turn.turnId,
        timeoutMs: INTERRUPT_CONFIRM_MS,
      }).catch(() => null);
      await this.#reportFailureSafe(work, {
        code: confirmed === null ? "termination_unconfirmed" : "deadline_exceeded",
        retrySafety: confirmed === null ? "unknown" : "safe",
        summary:
          confirmed === null
            ? "deadline exceeded; termination unconfirmed"
            : `deadline exceeded; turn ${confirmed.status}`,
      });
      if (confirmed === null) {
        await this.#dieAfterUnconfirmedTermination("termination unconfirmed");
      }
      return;
    }

    if (terminal.status !== "completed") {
      await this.#reportFailureSafe(work, {
        code: terminal.status === "interrupted" ? "interrupted" : "turn_failed",
        retrySafety: "safe",
        summary: terminal.error ?? `turn ${terminal.status}`,
      });
      return;
    }

    // Completed — the terminal notification carried the turn payload
    // (items incl. the final agentMessage); extract the structured output.
    const outputText = extractFinalOutputText(terminal.turn);
    if (outputText === undefined) {
      await this.#reportFailureSafe(work, {
        code: "no_output",
        retrySafety: "unsafe",
        summary: "turn completed without a final agent message",
      });
      return;
    }
    let parsedOutput: unknown;
    try {
      parsedOutput = JSON.parse(outputText);
    } catch {
      await this.#reportFailureSafe(work, {
        code: "output_not_json",
        retrySafety: "unsafe",
        summary: "final agent message was not valid JSON",
      });
      return;
    }
    let result: Record<string, unknown>;
    try {
      result = buildWorkerResult(work.operation, parsedOutput);
    } catch (error) {
      await this.#reportFailureSafe(work, {
        code: "output_invalid",
        retrySafety: "unsafe",
        summary: errorMessage(error),
      });
      return;
    }
    // Post the result — retry only transient failures; 409 means the row is
    // already terminal (replay-safe either way).
    const resultId = mintBridgeId("res");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await this.#bridge.reportResult(work, result, resultId);
        log("work_completed", { workerRequestId: work.workerRequestId });
        return;
      } catch (error) {
        if (this.#isFatal(error)) return;
        if (error instanceof BridgeConflictError) {
          // A 400 refuses the payload itself while the row is still leased
          // (contract violation) — report an honest failure now rather than
          // letting the lease lapse into a misleading "interrupted".
          if (error.status === 400) {
            await this.#reportFailureSafe(work, {
              code: "output_contract_violation",
              retrySafety: "unsafe",
              summary: `result rejected by bridge: ${error.message}`,
            });
          }
          log("work_result_conflict", {
            workerRequestId: work.workerRequestId,
            error: error.message,
          });
          return;
        }
        if (attempt === 3) {
          log("work_result_unreported", {
            workerRequestId: work.workerRequestId,
            error: errorMessage(error),
          });
          return; // lease expires → uncertain → reconciliation owns it
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 1_000 * 2 ** attempt),
        );
      }
    }
  }

}

export { AppServerError };
