// Scoped bridge HTTP client (P07).
//
// Speaks the authenticated `/worker/*` transport on the Convex site endpoint.
// All calls carry `Authorization: Bearer $OPENSQUAD_WORKER_TOKEN` and the
// runtime generation; the client classifies responses into retryable
// transport problems (network/5xx/429 → backoff) and authoritative conflicts
// (409 → the operation is dead and must not be retried). A persistent 401
// means the credential is retired — the daemon exits 78 so provisioning
// replaces the runtime rather than restart-looping.
import { createHash } from "node:crypto";
import type { WorkerConfig } from "./config.js";
import {
  BRIDGE_PROTOCOL_VERSION,
  computeResultDigest,
  parseClaimedControl,
  parseClaimedWork,
} from "./contracts.js";
import type {
  ClaimedControl,
  ClaimedWork,
  ControlStatus,
  WorkerPhase,
} from "./contracts.js";
import { mintBridgeId } from "./ids.js";

const REQUEST_TIMEOUT_MS = 15_000;

export class BridgeError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(`${status} ${code}: ${message}`);
    this.name = "BridgeError";
    this.status = status;
    this.code = code;
  }
}

/** 401 — the credential is gone (revoked/expired/retired generation). The
 *  daemon treats this as fatal: only provisioning can issue a new one. */
export class BridgeAuthError extends BridgeError {}

/** 409 — stale generation/lease or already-applied id. Never retried. */
export class BridgeConflictError extends BridgeError {}

/** 429/5xx/network — retryable with backoff. */
export class BridgeRetryableError extends BridgeError {}

export class BridgeClient {
  readonly #config: WorkerConfig;
  readonly #base: string;

  constructor(config: WorkerConfig) {
    this.#config = config;
    this.#base = config.bridgeUrl.replace(/\/+$/, "");
  }

  async #call(
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.#base}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#config.workerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new BridgeRetryableError(
        0,
        "TRANSPORT",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 204) {
      return null;
    }
    const text = await response.text();
    if (!response.ok) {
      let code = "UNKNOWN";
      let message = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as {
          error?: { code?: string; message?: string };
        };
        if (parsed.error?.code !== undefined) code = parsed.error.code;
        if (parsed.error?.message !== undefined) message = parsed.error.message;
      } catch {
        // keep the raw text excerpt
      }
      if (response.status === 401) {
        throw new BridgeAuthError(response.status, code, message);
      }
      if (response.status === 409 || response.status === 400 || response.status === 403) {
        throw new BridgeConflictError(response.status, code, message);
      }
      throw new BridgeRetryableError(response.status, code, message);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new BridgeRetryableError(response.status, "BAD_JSON", text.slice(0, 200));
    }
  }

  /** Poll for model work. `null` = nothing claimable (204). */
  async claimWork(): Promise<ClaimedWork | null> {
    const response = await this.#call("/worker/claim", {
      requestId: mintBridgeId("claim"),
      runtimeGeneration: this.#config.runtimeGeneration,
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    });
    if (response === null) return null;
    return parseClaimedWork(response);
  }

  /** Poll for owner control commands. `null` = none pending (204). */
  async claimControl(): Promise<ClaimedControl | null> {
    const response = await this.#call("/worker/control/claim", {
      requestId: mintBridgeId("cclaim"),
      runtimeGeneration: this.#config.runtimeGeneration,
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    });
    if (response === null) return null;
    return parseClaimedControl(response);
  }

  /** Report a control-command outcome — idempotent per resultId. */
  async reportControlResult(
    controlRequestId: string,
    status: ControlStatus,
    safeResult: Record<string, unknown>,
    resultId?: string,
  ): Promise<void> {
    await this.#call("/worker/control/result", {
      controlRequestId,
      runtimeGeneration: this.#config.runtimeGeneration,
      resultId: resultId ?? mintBridgeId("cres"),
      status,
      safeResult,
    });
  }

  /** Runtime liveness — carries no lease or business effect. */
  async runtimeHeartbeat(args: {
    phase: WorkerPhase;
    currentRunId?: string;
    currentCodexTurnRef?: string;
  }): Promise<void> {
    await this.#call("/worker/runtime-heartbeat", {
      runtimeGeneration: this.#config.runtimeGeneration,
      workerVersion: this.#config.workerVersion,
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      phase: args.phase,
      ...(args.currentRunId !== undefined
        ? { currentRunId: args.currentRunId }
        : {}),
      ...(args.currentCodexTurnRef !== undefined
        ? { currentCodexTurnRef: args.currentCodexTurnRef }
        : {}),
    });
  }

  /** Renew a held lease; returns the authoritative instruction. */
  async heartbeat(
    work: ClaimedWork,
    phase: WorkerPhase,
  ): Promise<"continue" | "stop"> {
    const response = await this.#call("/worker/heartbeat", {
      workerRequestId: work.workerRequestId,
      generation: work.generation,
      leaseToken: work.leaseToken,
      runtimeGeneration: this.#config.runtimeGeneration,
      phase,
    });
    if (
      typeof response === "object" &&
      response !== null &&
      (response as Record<string, unknown>)["instruction"] === "stop"
    ) {
      return "stop";
    }
    return "continue";
  }

  /** Deduped progress event — allowlisted kinds only. */
  async recordActivity(
    work: ClaimedWork,
    eventId: string,
    kind: "worker_progress",
    summary: string,
    phase?: WorkerPhase,
  ): Promise<void> {
    await this.#call("/worker/activity", {
      workerRequestId: work.workerRequestId,
      generation: work.generation,
      leaseToken: work.leaseToken,
      runtimeGeneration: this.#config.runtimeGeneration,
      eventId,
      kind,
      summary: summary.slice(0, 500),
      ...(phase !== undefined ? { phase } : {}),
    });
  }

  /** Apply a validated result — the client computes the canonical digest. */
  async reportResult(
    work: ClaimedWork,
    result: Record<string, unknown>,
    resultId: string,
  ): Promise<{ duplicate: boolean }> {
    const resultDigest = computeResultDigest(result);
    const response = await this.#call("/worker/result", {
      workerRequestId: work.workerRequestId,
      generation: work.generation,
      leaseToken: work.leaseToken,
      runtimeGeneration: this.#config.runtimeGeneration,
      resultId,
      resultDigest,
      result,
    });
    const duplicate =
      typeof response === "object" &&
      response !== null &&
      (response as Record<string, unknown>)["duplicate"] === true;
    return { duplicate };
  }

  /** Record a bounded failure — Workflow owns the retry decision. */
  async reportFailure(
    work: ClaimedWork,
    args: {
      failureId: string;
      code: string;
      retrySafety: "safe" | "unsafe" | "unknown";
      summary: string;
    },
  ): Promise<void> {
    await this.#call("/worker/failure", {
      workerRequestId: work.workerRequestId,
      generation: work.generation,
      leaseToken: work.leaseToken,
      runtimeGeneration: this.#config.runtimeGeneration,
      failureId: args.failureId,
      code: args.code,
      retrySafety: args.retrySafety,
      summary: args.summary.slice(0, 500),
    });
  }

  /** Upload bounded artifact bytes; deduped on operationKey server-side. */
  async uploadArtifact(
    work: ClaimedWork,
    args: {
      operationKey: string;
      kind: "research_brief" | "crawl" | "audit" | "attachment";
      mimeType: "image/png" | "image/jpeg" | "application/pdf" | "application/json" | "text/markdown" | "text/plain";
      bytes: Uint8Array;
      prospectId?: string;
    },
  ): Promise<{ artifactId: string; deduplicated: boolean }> {
    const digest = `sha256:${createHash("sha256").update(args.bytes).digest("hex")}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      response = await fetch(`${this.#base}/worker/artifact`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#config.workerToken}`,
          "Content-Type": args.mimeType,
          "X-Worker-Request-Id": work.workerRequestId,
          "X-Runtime-Generation": String(this.#config.runtimeGeneration),
          "X-Lease-Token": work.leaseToken,
          "X-Artifact-Operation-Key": args.operationKey,
          "X-Artifact-Kind": args.kind,
          "X-Artifact-Digest": digest,
          ...(args.prospectId !== undefined
            ? { "X-Prospect-Id": args.prospectId }
            : {}),
        },
        body: Buffer.from(args.bytes),
        signal: controller.signal,
      });
    } catch (error) {
      throw new BridgeRetryableError(
        0,
        "TRANSPORT",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (!response.ok) {
      let code = "UNKNOWN";
      let message = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as {
          error?: { code?: string; message?: string };
        };
        if (parsed.error?.code !== undefined) code = parsed.error.code;
        if (parsed.error?.message !== undefined) message = parsed.error.message;
      } catch {
        // keep raw excerpt
      }
      if (response.status === 401) {
        throw new BridgeAuthError(response.status, code, message);
      }
      if (response.status === 409 || response.status === 400 || response.status === 403 || response.status === 413) {
        throw new BridgeConflictError(response.status, code, message);
      }
      throw new BridgeRetryableError(response.status, code, message);
    }
    const parsed = JSON.parse(text) as {
      artifactId?: string;
      deduplicated?: boolean;
    };
    if (typeof parsed.artifactId !== "string") {
      throw new BridgeRetryableError(200, "BAD_JSON", "artifactId missing");
    }
    return {
      artifactId: parsed.artifactId,
      deduplicated: parsed.deduplicated === true,
    };
  }
}
