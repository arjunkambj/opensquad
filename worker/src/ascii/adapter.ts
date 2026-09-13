// ASCII Box lifecycle adapter (G1): each operation is a typed function that
// records a durable BoxOperationRecord BEFORE calling the provider, so a lost
// response can be safely reconciled by replaying the persisted idempotency key
// with an identical request fingerprint.
//
// The store is an interface: the spike ships an in-memory implementation;
// P07 backs it with `runtimeLifecycleOperations` rows in Convex.

import type { AsciiCallError, AsciiBoxClient } from "./client.js";
import {
  classifyBoxState,
  sanitizeBox,
  stableStringify,
  type BoxCommandSpec,
  type BoxCreateConfig,
  type BoxFacts,
  type BoxOperationKind,
  type BoxOperationRecord,
  type BoxReadiness,
} from "./types.js";

/** Persistence contract for operation records (Convex-side in P07). */
export interface BoxOperationStore {
  get(operationKey: string): Promise<BoxOperationRecord | undefined>;
  save(record: BoxOperationRecord): Promise<void>;
}

export class InMemoryBoxOperationStore implements BoxOperationStore {
  readonly #records = new Map<string, BoxOperationRecord>();

  get(operationKey: string): Promise<BoxOperationRecord | undefined> {
    return Promise.resolve(this.#records.get(operationKey));
  }

  save(record: BoxOperationRecord): Promise<void> {
    this.#records.set(record.operationKey, { ...record });
    return Promise.resolve();
  }

  list(): readonly BoxOperationRecord[] {
    return [...this.#records.values()];
  }
}

export type AdapterFailure = {
  readonly ok: false;
  readonly record: BoxOperationRecord;
  readonly error: AsciiCallError;
  /** True when the provider may have applied the request (timeout/5xx after
   * accept, or transport failure). Callers must reconcile, never blind-retry. */
  readonly uncertain: boolean;
};

export type AdapterOutcome<T> =
  | { readonly ok: true; readonly record: BoxOperationRecord; readonly value: T }
  | AdapterFailure;

export type PollOptions = {
  /** Hard deadline for the whole poll loop (ms). */
  readonly timeoutMs: number;
  /** Base interval; actual delay grows with bounded exponential backoff. */
  readonly intervalMs?: number;
  readonly signal?: AbortSignal;
  /** Injectable for spike/verification runs; defaults to setTimeout-based. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export type BoxWaitOutcome =
  | { readonly readiness: "usable"; readonly box: BoxFacts }
  | {
      readonly readiness: "archived" | "error" | "timeout" | "aborted";
      readonly box?: BoxFacts;
      readonly detail?: string;
    };

const DEFAULT_INTERVAL_MS = 2_000;
const MAX_INTERVAL_MS = 15_000;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract provider `box` payload from any response envelope carrying one. */
function extractBox(value: unknown): unknown {
  if (isRecord(value) && "box" in value) return value["box"];
  return value;
}

function now(): number {
  return Date.now();
}

export class BoxLifecycleAdapter {
  readonly #client: AsciiBoxClient;
  readonly #store: BoxOperationStore;

  constructor(client: AsciiBoxClient, store: BoxOperationStore) {
    this.#client = client;
    this.#store = store;
  }

  async #begin(
    operation: BoxOperationKind,
    operationKey: string,
    requestFingerprint: string,
    boxId?: string,
    idempotencyKey?: string,
  ): Promise<
    | { readonly fresh: true; readonly record: BoxOperationRecord }
    | { readonly fresh: false; readonly record: BoxOperationRecord }
    | { readonly conflict: string }
  > {
    const existing = await this.#store.get(operationKey);
    if (existing !== undefined) {
      if (existing.requestFingerprint !== requestFingerprint) {
        // Same key, different body: exactly what the provider reports as
        // idempotency_key_reused on create; refuse before calling out.
        return {
          conflict: `operationKey ${operationKey} was already used with a different request`,
        };
      }
      return { fresh: false, record: existing };
    }
    const record: BoxOperationRecord = {
      operationKey,
      operation,
      requestFingerprint,
      state: "pending",
      attempts: 0,
      createdAt: now(),
      updatedAt: now(),
      ...(boxId !== undefined ? { boxId } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    };
    await this.#store.save(record);
    return { fresh: true, record };
  }

  async #finish(
    record: BoxOperationRecord,
    state: BoxOperationRecord["state"],
    extra?: {
      providerOperationRef?: string;
      lastError?: string;
      boxId?: string;
    },
  ): Promise<BoxOperationRecord> {
    const next: BoxOperationRecord = {
      ...record,
      state,
      attempts: record.attempts + 1,
      updatedAt: now(),
      ...(extra?.providerOperationRef !== undefined
        ? { providerOperationRef: extra.providerOperationRef }
        : {}),
      ...(extra?.lastError !== undefined
        ? { lastError: extra.lastError }
        : {}),
      ...(extra?.boxId !== undefined ? { boxId: extra.boxId } : {}),
    };
    await this.#store.save(next);
    return next;
  }

  /**
   * Create a Box with a caller-persisted idempotency key. The key and the
   * canonical request fingerprint are stored before the provider call, so a
   * repeated `operationKey` replays the exact same create — the provider
   * returns the original Box rather than a second billable one.
   */
  async createBox(input: {
    readonly operationKey: string;
    readonly idempotencyKey: string;
    readonly config: BoxCreateConfig;
  }): Promise<AdapterOutcome<BoxFacts>> {
    const fingerprint = stableStringify({
      operation: "create",
      idempotencyKey: input.idempotencyKey,
      config: input.config,
    });
    const begun = await this.#begin(
      "create",
      input.operationKey,
      fingerprint,
      undefined,
      input.idempotencyKey,
    );
    if ("conflict" in begun) {
      return {
        ok: false,
        record: await this.#store.get(input.operationKey) as BoxOperationRecord,
        error: { kind: "validation", message: begun.conflict },
        uncertain: false,
      };
    }
    const result = await this.#client.createBox(
      input.idempotencyKey,
      input.config,
    );
    if (!result.ok) {
      // 409 idempotency_in_progress / transport failures are uncertain: the
      // provider may still be creating the Box under our key. Everything else
      // is a definitive failure.
      const uncertain =
        result.error.kind === "transport" ||
        (result.error.status !== undefined && result.error.status >= 500) ||
        result.error.code === "idempotency_in_progress";
      const record = await this.#finish(
        begun.record,
        uncertain ? "uncertain" : "failed",
        { lastError: `${result.error.code ?? result.error.kind}: ${result.error.message}` },
      );
      return { ok: false, record, error: result.error, uncertain };
    }
    let facts: BoxFacts;
    try {
      facts = sanitizeBox(result.value.box);
    } catch (err) {
      const record = await this.#finish(begun.record, "uncertain", {
        lastError: `unparseable create response: ${String(err)}`,
      });
      return {
        ok: false,
        record,
        error: { kind: "validation", message: "create response failed validation" },
        uncertain: true,
      };
    }
    const record = await this.#finish(begun.record, "accepted", {
      boxId: facts.boxId,
    });
    return { ok: true, record, value: facts };
  }

  /** GET /boxes/{boxId} with sanitisation into persistable facts. */
  async inspectBox(input: {
    readonly operationKey: string;
    readonly boxId: string;
  }): Promise<AdapterOutcome<BoxFacts>> {
    const fingerprint = stableStringify({
      operation: "inspect",
      boxId: input.boxId,
    });
    const begun = await this.#begin(
      "inspect",
      input.operationKey,
      fingerprint,
      input.boxId,
    );
    if ("conflict" in begun) {
      return {
        ok: false,
        record: await this.#store.get(input.operationKey) as BoxOperationRecord,
        error: { kind: "validation", message: begun.conflict },
        uncertain: false,
      };
    }
    const result = await this.#client.inspectBox(input.boxId);
    if (!result.ok) {
      const record = await this.#finish(begun.record, "failed", {
        lastError: `${result.error.code ?? result.error.kind}: ${result.error.message}`,
      });
      return { ok: false, record, error: result.error, uncertain: false };
    }
    try {
      const facts = sanitizeBox(result.value.box);
      const record = await this.#finish(begun.record, "completed");
      return { ok: true, record, value: facts };
    } catch (err) {
      const record = await this.#finish(begun.record, "failed", {
        lastError: `unparseable inspect response: ${String(err)}`,
      });
      return {
        ok: false,
        record,
        error: { kind: "validation", message: "inspect response failed validation" },
        uncertain: false,
      };
    }
  }

  /** Poll GET /boxes/{boxId} with bounded backoff until usable/terminal/timeout.
   * `idle`/`running` count as usable; per ASCII docs they reflect only the
   * built-in prompt harness, so worker heartbeats remain authoritative for
   * whether custom work is active. */
  async waitForReady(
    boxId: string,
    options: PollOptions,
  ): Promise<BoxWaitOutcome> {
    const sleep = options.sleep ?? defaultSleep;
    const baseInterval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const deadline =
      options.timeoutMs === 0
        ? Number.POSITIVE_INFINITY
        : now() + options.timeoutMs;
    let attempt = 0;
    let lastFacts: BoxFacts | undefined;
    for (;;) {
      attempt += 1;
      const result = await this.#client.inspectBox(boxId);
      if (result.ok) {
        try {
          const facts = sanitizeBox(result.value.box);
          lastFacts = facts;
          const readiness: BoxReadiness = facts.readiness;
          if (readiness === "usable") {
            return { readiness: "usable", box: facts };
          }
          if (readiness === "archived" || readiness === "error") {
            return { readiness, box: facts };
          }
        } catch {
          // Unparseable box payload — keep polling until the deadline.
        }
      } else if (
        result.error.status === 404 ||
        result.error.status === 401 ||
        result.error.status === 403
      ) {
        // Definitive states; polling cannot fix them.
        return {
          readiness: "error",
          ...(lastFacts !== undefined ? { box: lastFacts } : {}),
          detail: `${result.error.code ?? "http"}: ${result.error.message}`,
        };
      }
      if (now() >= deadline) {
        return {
          readiness: "timeout",
          ...(lastFacts !== undefined ? { box: lastFacts } : {}),
        };
      }
      const delayMs = Math.min(
        baseInterval * Math.pow(1.5, attempt - 1),
        MAX_INTERVAL_MS,
      );
      try {
        await sleep(delayMs, options.signal);
      } catch {
        return {
          readiness: "aborted",
          ...(lastFacts !== undefined ? { box: lastFacts } : {}),
        };
      }
    }
  }

  /**
   * Bootstrap: run one detached command inside the Box and poll its status
   * until it exits or the deadline passes. Commands are never automatically
   * retried — a 502 box_direct_failed means the command may already be running.
   */
  async bootstrap(input: {
    readonly operationKey: string;
    readonly boxId: string;
    readonly spec: BoxCommandSpec;
    readonly timeoutMs: number;
    readonly pollIntervalMs?: number;
    readonly sleep?: PollOptions["sleep"];
    readonly signal?: AbortSignal;
  }): Promise<
    AdapterOutcome<{
      readonly processId: number;
      readonly exitCode: number | null;
      readonly status: string;
      readonly stdoutTail?: string;
      readonly stderrTail?: string;
    }>
  > {
    const spec: BoxCommandSpec = { ...input.spec, detached: true };
    const fingerprint = stableStringify({
      operation: "bootstrap",
      boxId: input.boxId,
      spec,
    });
    const begun = await this.#begin(
      "bootstrap",
      input.operationKey,
      fingerprint,
      input.boxId,
    );
    if ("conflict" in begun) {
      return {
        ok: false,
        record: await this.#store.get(input.operationKey) as BoxOperationRecord,
        error: { kind: "validation", message: begun.conflict },
        uncertain: false,
      };
    }
    const started = await this.#client.runCommand(input.boxId, spec);
    if (!started.ok) {
      const uncertain =
        started.error.kind === "transport" ||
        (started.error.status !== undefined && started.error.status >= 500);
      const record = await this.#finish(
        begun.record,
        uncertain ? "uncertain" : "failed",
        {
          lastError: `${started.error.code ?? started.error.kind}: ${started.error.message}`,
        },
      );
      return { ok: false, record, error: started.error, uncertain };
    }
    const startedValue = started.value;
    if (
      !isRecord(startedValue) ||
      startedValue["type"] !== "command.started" ||
      typeof startedValue["processId"] !== "number"
    ) {
      const record = await this.#finish(begun.record, "uncertain", {
        lastError: "bootstrap did not return a detached processId",
      });
      return {
        ok: false,
        record,
        error: { kind: "validation", message: "unexpected command response shape" },
        uncertain: true,
      };
    }
    const processId = startedValue["processId"];
    const record = await this.#finish(begun.record, "accepted", {
      providerOperationRef: `process:${processId}`,
    });

    // Poll command status until terminal or deadline.
    const sleep = input.sleep ?? defaultSleep;
    const deadline = now() + input.timeoutMs;
    const interval = input.pollIntervalMs ?? DEFAULT_INTERVAL_MS;
    let lastStatus = "running";
    for (;;) {
      const status = await this.#client.commandStatus(
        input.boxId,
        processId,
        16_384,
      );
      if (status.ok) {
        const value = status.value;
        lastStatus = value.status;
        if (!value.running) {
          const done = await this.#finish(record, "completed");
          const stdoutTail =
            typeof value.stdout === "string" && value.stdout.length > 0
              ? value.stdout.slice(-4_096)
              : undefined;
          const stderrTail =
            typeof value.stderr === "string" && value.stderr.length > 0
              ? value.stderr.slice(-4_096)
              : undefined;
          return {
            ok: true,
            record: done,
            value: {
              processId,
              exitCode: value.exitCode,
              status: value.status,
              ...(stdoutTail !== undefined ? { stdoutTail } : {}),
              ...(stderrTail !== undefined ? { stderrTail } : {}),
            },
          };
        }
      } else if (
        status.error.status === 404 ||
        status.error.status === 401 ||
        status.error.status === 403
      ) {
        const done = await this.#finish(record, "failed", {
          lastError: `command status: ${status.error.code ?? status.error.kind}`,
        });
        return { ok: false, record: done, error: status.error, uncertain: false };
      }
      if (now() >= deadline) {
        const done = await this.#finish(record, "uncertain", {
          lastError: `bootstrap poll deadline reached (last status: ${lastStatus})`,
        });
        return {
          ok: false,
          record: done,
          error: { kind: "transport", message: "bootstrap timed out" },
          uncertain: true,
        };
      }
      try {
        await sleep(interval, input.signal);
      } catch {
        const done = await this.#finish(record, "uncertain", {
          lastError: "bootstrap poll aborted",
        });
        return {
          ok: false,
          record: done,
          error: { kind: "transport", message: "bootstrap poll aborted" },
          uncertain: true,
        };
      }
    }
  }

  /** POST /boxes/{boxId}/resume — resume the same Box, then wait usable. */
  async resumeBox(input: {
    readonly operationKey: string;
    readonly boxId: string;
    readonly ttlSeconds?: number;
    readonly wait?: PollOptions;
  }): Promise<AdapterOutcome<BoxFacts>> {
    const fingerprint = stableStringify({
      operation: "resume",
      boxId: input.boxId,
      ttlSeconds: input.ttlSeconds ?? null,
    });
    const begun = await this.#begin(
      "resume",
      input.operationKey,
      fingerprint,
      input.boxId,
    );
    if ("conflict" in begun) {
      return {
        ok: false,
        record: await this.#store.get(input.operationKey) as BoxOperationRecord,
        error: { kind: "validation", message: begun.conflict },
        uncertain: false,
      };
    }
    const result = await this.#client.resumeBox(input.boxId, {
      ...(input.ttlSeconds !== undefined
        ? { ttlSeconds: input.ttlSeconds }
        : {}),
      noEnv: true,
    });
    if (!result.ok) {
      const uncertain =
        result.error.kind === "transport" ||
        (result.error.status !== undefined && result.error.status >= 500);
      const record = await this.#finish(
        begun.record,
        uncertain ? "uncertain" : "failed",
        {
          lastError: `${result.error.code ?? result.error.kind}: ${result.error.message}`,
        },
      );
      return { ok: false, record, error: result.error, uncertain };
    }
    const accepted = await this.#finish(begun.record, "accepted");
    if (input.wait === undefined) {
      try {
        const facts = sanitizeBox(extractBox(result.value));
        const done = await this.#finish(accepted, "completed");
        return { ok: true, record: done, value: facts };
      } catch {
        const done = await this.#finish(accepted, "completed");
        return {
          ok: true,
          record: done,
          value: {
            boxId: input.boxId,
            state: "resuming",
            readiness: "provisioning",
          },
        };
      }
    }
    const waited = await this.waitForReady(input.boxId, input.wait);
    if (waited.readiness === "usable") {
      const done = await this.#finish(accepted, "completed");
      return { ok: true, record: done, value: waited.box };
    }
    const done = await this.#finish(accepted, "uncertain", {
      lastError: `resume wait ended in ${waited.readiness}`,
    });
    return {
      ok: false,
      record: done,
      error: {
        kind: "transport",
        message: `box did not become usable: ${waited.readiness}`,
      },
      uncertain: true,
    };
  }

  /** PATCH /boxes/{boxId} — extend remaining TTL to an explicit limit. */
  async extendTtl(input: {
    readonly operationKey: string;
    readonly boxId: string;
    readonly ttlSeconds: number;
  }): Promise<AdapterOutcome<BoxFacts>> {
    const fingerprint = stableStringify({
      operation: "extend_ttl",
      boxId: input.boxId,
      ttlSeconds: input.ttlSeconds,
    });
    const begun = await this.#begin(
      "extend_ttl",
      input.operationKey,
      fingerprint,
      input.boxId,
    );
    if ("conflict" in begun) {
      return {
        ok: false,
        record: await this.#store.get(input.operationKey) as BoxOperationRecord,
        error: { kind: "validation", message: begun.conflict },
        uncertain: false,
      };
    }
    const result = await this.#client.extendTtl(input.boxId, input.ttlSeconds);
    if (!result.ok) {
      const uncertain =
        result.error.kind === "transport" ||
        (result.error.status !== undefined && result.error.status >= 500);
      const record = await this.#finish(
        begun.record,
        uncertain ? "uncertain" : "failed",
        {
          lastError: `${result.error.code ?? result.error.kind}: ${result.error.message}`,
        },
      );
      return { ok: false, record, error: result.error, uncertain };
    }
    try {
      const facts = sanitizeBox(result.value.box);
      const done = await this.#finish(begun.record, "completed");
      return { ok: true, record: done, value: facts };
    } catch {
      const done = await this.#finish(begun.record, "completed");
      return {
        ok: true,
        record: done,
        value: {
          boxId: input.boxId,
          state: "unknown",
          readiness: classifyBoxState("unknown"),
        },
      };
    }
  }

  /** POST /boxes/{boxId}/stop — drain, snapshot, archive; optionally wait for
   * the `archived` state. Stop preserves filesystem for later resume. */
  async pauseBox(input: {
    readonly operationKey: string;
    readonly boxId: string;
    readonly force?: boolean;
    readonly waitForArchivedMs?: number;
    readonly sleep?: PollOptions["sleep"];
    readonly signal?: AbortSignal;
  }): Promise<AdapterOutcome<BoxFacts>> {
    const fingerprint = stableStringify({
      operation: "stop",
      boxId: input.boxId,
      force: input.force ?? false,
    });
    const begun = await this.#begin(
      "stop",
      input.operationKey,
      fingerprint,
      input.boxId,
    );
    if ("conflict" in begun) {
      return {
        ok: false,
        record: await this.#store.get(input.operationKey) as BoxOperationRecord,
        error: { kind: "validation", message: begun.conflict },
        uncertain: false,
      };
    }
    const result = await this.#client.stopBox(input.boxId, {
      ...(input.force !== undefined ? { force: input.force } : {}),
    });
    if (!result.ok) {
      const uncertain =
        result.error.kind === "transport" ||
        (result.error.status !== undefined && result.error.status >= 500);
      const record = await this.#finish(
        begun.record,
        uncertain ? "uncertain" : "failed",
        {
          lastError: `${result.error.code ?? result.error.kind}: ${result.error.message}`,
        },
      );
      return { ok: false, record, error: result.error, uncertain };
    }
    const accepted = await this.#finish(begun.record, "accepted");
    if (input.waitForArchivedMs === undefined) {
      const done = await this.#finish(accepted, "completed");
      return {
        ok: true,
        record: done,
        value: { boxId: input.boxId, state: "stopping", readiness: "archiving" },
      };
    }
    // Poll until archived.
    const sleep = input.sleep ?? defaultSleep;
    const deadline = now() + input.waitForArchivedMs;
    for (;;) {
      const inspected = await this.#client.inspectBox(input.boxId);
      if (inspected.ok) {
        try {
          const facts = sanitizeBox(inspected.value.box);
          if (facts.readiness === "archived") {
            const done = await this.#finish(accepted, "completed");
            return { ok: true, record: done, value: facts };
          }
          if (facts.readiness === "error") {
            const done = await this.#finish(accepted, "failed", {
              lastError: "box entered error while archiving",
            });
            return {
              ok: false,
              record: done,
              error: { kind: "http", message: "box entered error state" },
              uncertain: false,
            };
          }
        } catch {
          // keep polling
        }
      }
      if (now() >= deadline) {
        const done = await this.#finish(accepted, "uncertain", {
          lastError: "archive deadline reached",
        });
        return {
          ok: false,
          record: done,
          error: { kind: "transport", message: "archive wait timed out" },
          uncertain: true,
        };
      }
      try {
        await sleep(DEFAULT_INTERVAL_MS, input.signal);
      } catch {
        const done = await this.#finish(accepted, "uncertain", {
          lastError: "archive wait aborted",
        });
        return {
          ok: false,
          record: done,
          error: { kind: "transport", message: "archive wait aborted" },
          uncertain: true,
        };
      }
    }
  }

  /** DELETE /boxes/{boxId} — permanent, confirmed by echoing the boxId in the
   * X-Ascii-Confirm-Delete header. Mark the connection unrecoverable after
   * the deletion operation completes. */
  async deleteBox(input: {
    readonly operationKey: string;
    readonly boxId: string;
    readonly waitMs?: number;
    readonly sleep?: PollOptions["sleep"];
    readonly signal?: AbortSignal;
  }): Promise<AdapterOutcome<{ readonly deleted: true; readonly boxId: string }>> {
    const fingerprint = stableStringify({
      operation: "delete",
      boxId: input.boxId,
    });
    const begun = await this.#begin(
      "delete",
      input.operationKey,
      fingerprint,
      input.boxId,
    );
    if ("conflict" in begun) {
      return {
        ok: false,
        record: await this.#store.get(input.operationKey) as BoxOperationRecord,
        error: { kind: "validation", message: begun.conflict },
        uncertain: false,
      };
    }
    const result = await this.#client.deleteBox(input.boxId);
    if (!result.ok) {
      const uncertain =
        result.error.kind === "transport" ||
        (result.error.status !== undefined && result.error.status >= 500);
      const record = await this.#finish(
        begun.record,
        uncertain ? "uncertain" : "failed",
        {
          lastError: `${result.error.code ?? result.error.kind}: ${result.error.message}`,
        },
      );
      return { ok: false, record, error: result.error, uncertain };
    }
    const operationId =
      isRecord(result.value.operation) &&
      typeof result.value.operation["id"] === "string"
        ? result.value.operation["id"]
        : undefined;
    const accepted = await this.#finish(begun.record, "accepted", {
      ...(operationId !== undefined
        ? { providerOperationRef: operationId }
        : {}),
    });
    if (input.waitMs === undefined || operationId === undefined) {
      const done = await this.#finish(accepted, "completed");
      return { ok: true, record: done, value: { deleted: true, boxId: input.boxId } };
    }
    const sleep = input.sleep ?? defaultSleep;
    const deadline = now() + input.waitMs;
    for (;;) {
      const op = await this.#client.getDeletionOperation(operationId);
      if (op.ok) {
        const status =
          isRecord(op.value.operation) &&
          typeof op.value.operation["status"] === "string"
            ? op.value.operation["status"]
            : undefined;
        if (status === "completed") {
          const done = await this.#finish(accepted, "completed");
          return {
            ok: true,
            record: done,
            value: { deleted: true, boxId: input.boxId },
          };
        }
        if (status === "blocked") {
          const done = await this.#finish(accepted, "failed", {
            lastError: "deletion operation blocked by provider",
          });
          return {
            ok: false,
            record: done,
            error: { kind: "http", message: "deletion operation blocked" },
            uncertain: false,
          };
        }
      }
      if (now() >= deadline) {
        const done = await this.#finish(accepted, "uncertain", {
          lastError: "deletion poll deadline reached",
        });
        return {
          ok: false,
          record: done,
          error: { kind: "transport", message: "deletion poll timed out" },
          uncertain: true,
        };
      }
      try {
        await sleep(DEFAULT_INTERVAL_MS, input.signal);
      } catch {
        const done = await this.#finish(accepted, "uncertain", {
          lastError: "deletion poll aborted",
        });
        return {
          ok: false,
          record: done,
          error: { kind: "transport", message: "deletion poll aborted" },
          uncertain: true,
        };
      }
    }
  }
}
