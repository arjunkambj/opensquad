// Bridge wire contracts (P07 — architecture §4.5).
//
// These mirror the server-side validators in convex/lib/validators.ts; the
// server is authoritative — this module validates before trusting payloads
// from the bridge and builds the result envelopes it posts back.
import { createHash } from "node:crypto";

export const BRIDGE_PROTOCOL_VERSION = "opensquad-bridge/1";
export const WORKER_INPUT_SCHEMA_VERSION = 1;
export const WORKER_RESULT_SCHEMA_VERSION = 1;

export const WORKER_OPERATIONS = [
  "discover",
  "research",
  "contact",
  "draft",
  "classify_reply",
] as const;
export type WorkerOperation = (typeof WORKER_OPERATIONS)[number];

/** Host capability IDs — mirrors `CAPABILITY_IDS` in convex/lib/validators.ts.
 *  The server is authoritative; this copy exists so the worker can refuse a
 *  tool locally without a round trip, never so it can grant one. */
export const CAPABILITY_IDS = [
  "apollo.company_search",
  "apollo.contact_enrichment",
  "opensquad.web_research",
  "opensquad.draft_compose",
  "opensquad.reply_classify",
] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export type WorkerPhase =
  | "boot"
  | "ready"
  | "running"
  | "degraded"
  | "stopping";

export type ControlCommand =
  | "inspect_account"
  | "start_login"
  | "cancel_login"
  | "logout"
  | "interrupt_turn";

export type WorkerInputContextBlock = {
  readonly label: string;
  readonly text: string;
};

export type WorkerInputConstraints = {
  readonly deadlineMs: number;
  readonly maxToolCalls?: number;
  readonly model?: string;
};

export type WorkerRequestInput = {
  readonly schemaVersion: 1;
  readonly operation: WorkerOperation;
  readonly prompt: string;
  readonly context?: readonly WorkerInputContextBlock[];
  readonly constraints: WorkerInputConstraints;
  readonly outputSchema: unknown;
  /** Mirror of `ClaimedWork.capabilities`. Present for symmetry with the
   *  server envelope; `ClaimedWork.capabilities` is what the router reads. */
  readonly capabilities: readonly CapabilityId[];
  readonly session?: {
    readonly scopeKey: string;
    readonly codexThreadRef?: string;
  };
};

/** The payload `POST /worker/claim` returns on 200. */
export type ClaimedWork = {
  readonly workerRequestId: string;
  readonly runId: string;
  readonly generation: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: number;
  readonly operation: WorkerOperation;
  readonly outputSchemaVersion: number;
  /** The capability set Convex issued for this request. Absent on the wire
   *  means NONE — the router denies every tool. */
  readonly capabilities: readonly CapabilityId[];
  readonly input: WorkerRequestInput;
};

export type ClaimedControl = {
  readonly controlRequestId: string;
  readonly command: ControlCommand;
  readonly expiresAt: number;
  readonly loginId?: string;
  readonly turnId?: string;
  readonly threadId?: string;
};

export type ControlStatus = "challenge_issued" | "completed" | "failed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reqString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`bridge payload: ${key} must be a non-empty string`);
  }
  return value;
}

function optString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function reqInt(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`bridge payload: ${key} must be an integer`);
  }
  return value;
}

/**
 * Parse an issued capability set element by element. Fail-closed by
 * construction: an absent field is handled by the caller as `[]`, and a
 * malformed one THROWS rather than degrading — a capability field the worker
 * and the bridge disagree about means the contract is broken, and the safe
 * move is to run no work at all.
 */
function parseCapabilities(value: unknown): CapabilityId[] {
  if (!Array.isArray(value)) {
    throw new Error("bridge payload: capabilities must be an array");
  }
  if (value.length > CAPABILITY_IDS.length) {
    throw new Error("bridge payload: capabilities has too many entries");
  }
  const parsed: CapabilityId[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new Error("bridge payload: capabilities entry must be a string");
    }
    if (!(CAPABILITY_IDS as readonly string[]).includes(entry)) {
      throw new Error(`bridge payload: unknown capability ${entry}`);
    }
    if (parsed.includes(entry as CapabilityId)) {
      throw new Error("bridge payload: capabilities contains a duplicate");
    }
    parsed.push(entry as CapabilityId);
  }
  return parsed;
}

/** Parse bounded context blocks. Previously these were CAST rather than
 *  checked; a cast is not a parse, and the pattern is removed here so it is
 *  not the template the capability set gets copied from. */
function parseContextBlocks(value: unknown): WorkerInputContextBlock[] {
  if (!Array.isArray(value)) {
    throw new Error("bridge payload: input.context must be an array");
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(
        `bridge payload: input.context[${index}] must be an object`,
      );
    }
    const label = entry["label"];
    const text = entry["text"];
    if (typeof label !== "string" || label.length === 0) {
      throw new Error(
        `bridge payload: input.context[${index}].label must be a non-empty string`,
      );
    }
    if (typeof text !== "string") {
      throw new Error(
        `bridge payload: input.context[${index}].text must be a string`,
      );
    }
    return { label, text };
  });
}

/** Validate an untrusted claimed-work payload before trusting any field. */
export function parseClaimedWork(value: unknown): ClaimedWork {
  if (!isRecord(value) || value["claimed"] !== true) {
    throw new Error("bridge payload: claim response is not a claim");
  }
  const input = value["input"];
  if (!isRecord(input)) {
    throw new Error("bridge payload: input must be an object");
  }
  const operation = reqString(value, "operation") as WorkerOperation;
  if (!WORKER_OPERATIONS.includes(operation)) {
    throw new Error(`bridge payload: unknown operation ${operation}`);
  }
  if (input["schemaVersion"] !== WORKER_INPUT_SCHEMA_VERSION) {
    throw new Error("bridge payload: input.schemaVersion must be 1");
  }
  if (input["operation"] !== operation) {
    throw new Error("bridge payload: input.operation mismatch");
  }
  const prompt = reqString(input, "prompt");
  const constraintsRaw = input["constraints"];
  if (!isRecord(constraintsRaw)) {
    throw new Error("bridge payload: input.constraints must be an object");
  }
  const deadlineMs = reqInt(constraintsRaw, "deadlineMs");
  if (deadlineMs < 1000 || deadlineMs > 30 * 60_000) {
    throw new Error("bridge payload: deadlineMs out of bounds");
  }
  const constraints: WorkerInputConstraints = {
    deadlineMs,
    ...(typeof constraintsRaw["maxToolCalls"] === "number"
      ? { maxToolCalls: constraintsRaw["maxToolCalls"] }
      : {}),
    ...(typeof constraintsRaw["model"] === "string"
      ? { model: constraintsRaw["model"] }
      : {}),
  };
  const context =
    input["context"] === undefined
      ? undefined
      : parseContextBlocks(input["context"]);
  // Absent ⇒ no capabilities ⇒ every tool denied. Malformed ⇒ throw.
  const capabilities =
    value["capabilities"] === undefined
      ? []
      : parseCapabilities(value["capabilities"]);
  const session = input["session"];
  if (session !== undefined && !isRecord(session)) {
    throw new Error("bridge payload: input.session must be an object");
  }
  const sessionOut =
    isRecord(session)
      ? (() => {
          const codexThreadRef = optString(session, "codexThreadRef");
          return {
            scopeKey: reqString(session, "scopeKey"),
            ...(codexThreadRef !== undefined ? { codexThreadRef } : {}),
          };
        })()
      : undefined;
  return {
    workerRequestId: reqString(value, "workerRequestId"),
    runId: reqString(value, "runId"),
    generation: reqInt(value, "generation"),
    leaseToken: reqString(value, "leaseToken"),
    leaseExpiresAt: reqInt(value, "leaseExpiresAt"),
    operation,
    outputSchemaVersion: reqInt(value, "outputSchemaVersion"),
    capabilities,
    input: {
      schemaVersion: 1,
      operation,
      prompt,
      ...(context !== undefined ? { context } : {}),
      constraints,
      capabilities,
      outputSchema: input["outputSchema"],
      ...(sessionOut !== undefined ? { session: sessionOut } : {}),
    },
  };
}

/** Validate a claimed control-command payload. */
export function parseClaimedControl(value: unknown): ClaimedControl {
  if (!isRecord(value) || value["claimed"] !== true) {
    throw new Error("bridge payload: control claim response is not a claim");
  }
  const command = reqString(value, "command") as ControlCommand;
  if (
    ![
      "inspect_account",
      "start_login",
      "cancel_login",
      "logout",
      "interrupt_turn",
    ].includes(command)
  ) {
    throw new Error(`bridge payload: unknown control command ${command}`);
  }
  const loginId = optString(value, "loginId");
  const turnId = optString(value, "turnId");
  const threadId = optString(value, "threadId");
  return {
    controlRequestId: reqString(value, "controlRequestId"),
    command,
    expiresAt: reqInt(value, "expiresAt"),
    ...(loginId !== undefined ? { loginId } : {}),
    ...(turnId !== undefined ? { turnId } : {}),
    ...(threadId !== undefined ? { threadId } : {}),
  };
}

/**
 * Canonical JSON — identical key ordering to convex/lib/validators.ts so the
 * worker-computed `resultDigest` matches the server's recomputation.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** `sha256:<hex>` over the canonical result serialization. */
export function computeResultDigest(result: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(result), "utf8").digest("hex")}`;
}

/** Extract the final agent-message text from a `turn/completed` turn payload. */
export function extractFinalOutputText(turn: unknown): string | undefined {
  if (!isRecord(turn)) return undefined;
  const items = turn["items"];
  if (!Array.isArray(items)) return undefined;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (
      isRecord(item) &&
      item["type"] === "agentMessage" &&
      typeof item["text"] === "string" &&
      item["text"].length > 0
    ) {
      return item["text"];
    }
  }
  return undefined;
}

/**
 * Build the §4.5 result envelope: the model's structured output (validated
 * server-side) stamped with the contracted schemaVersion + operation.
 */
export function buildWorkerResult(
  operation: WorkerOperation,
  output: unknown,
): Record<string, unknown> {
  if (!isRecord(output)) {
    throw new Error("model output is not a JSON object");
  }
  // The worker owns the envelope: schemaVersion/operation are stamped AFTER
  // the model output so a stray key in the output cannot silently rewrite
  // the contracted discriminator (which would make the server reject the
  // result as an operation mismatch).
  return {
    ...output,
    schemaVersion: WORKER_RESULT_SCHEMA_VERSION,
    operation,
  };
}
