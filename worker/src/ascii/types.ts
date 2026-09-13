// OpenSquad-owned domain types for the ASCII Box lifecycle adapter.
//
// These are the stable shapes the rest of OpenSquad persists; provider SDK
// objects are translated into them at the adapter boundary. Never persist
// secret-bearing provider fields (desktop/VNC URLs can contain access tokens).

import { createHash } from "node:crypto";

/** Lifecycle operations this adapter performs, mirroring
 * `runtimeLifecycleOperations.operation` in plan/architecture.md §4.4. */
export type BoxOperationKind =
  | "create"
  | "inspect"
  | "bootstrap"
  | "resume"
  | "extend_ttl"
  | "stop"
  | "delete";

/** Mirrors `runtimeLifecycleOperations.state`. `uncertain` means the provider
 * request was sent (or may have been sent) but the outcome is unknown — the
 * recorded idempotency/operation data is the only safe recovery path. */
export type BoxOperationState =
  | "pending"
  | "accepted"
  | "uncertain"
  | "completed"
  | "failed";

/** Explicit classification of a provider-reported Box state for control flow. */
export type BoxReadiness =
  | "provisioning" // init | provisioning | provisioned | cloning
  | "usable" // ready | idle | running (idle/running only reflect prompt-harness work)
  | "archiving" // archiving
  | "archived" // archived — resumable
  | "error" // error
  | "unknown"; // any unrecognised state — treated as not usable

/** Secret-free Box facts OpenSquad may persist. */
export type BoxFacts = {
  readonly boxId: string;
  readonly state: string;
  readonly readiness: BoxReadiness;
  readonly name?: string;
  readonly environment?: string;
  readonly environmentVersion?: number;
  readonly createdAt?: string;
  readonly archiveAfter?: string;
  readonly snapshotAvailable?: boolean;
  readonly setupStatus?: string;
  readonly setupError?: string;
};

/** Neutral create configuration — no credentials. `env` carries only the
 * worker's scoped provisioning names (OPENSQUAD_*), injected by the caller. */
export type BoxCreateConfig = {
  readonly noEnv: true;
  readonly ttlSeconds: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly from?: string;
  readonly type?: "small" | "default" | "large";
  readonly setupScript?: string;
};

export type BoxCommandSpec = {
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutSeconds?: number;
  readonly detached?: boolean;
};

/** Durable record for one provider operation attempt. `operationKey` is the
 * stable dedupe/idempotency key persisted BEFORE the provider call is made. */
export type BoxOperationRecord = {
  readonly operationKey: string;
  readonly operation: BoxOperationKind;
  readonly boxId?: string;
  readonly idempotencyKey?: string;
  /** SHA-256 of canonical request JSON; never persist provisioning secrets. */
  readonly requestFingerprint: string;
  state: BoxOperationState;
  attempts: number;
  providerOperationRef?: string;
  lastError?: string;
  readonly createdAt: number;
  updatedAt: number;
};

const BOX_READINESS_BY_STATE: Readonly<Record<string, BoxReadiness>> = {
  init: "provisioning",
  provisioning: "provisioning",
  provisioned: "provisioning",
  cloning: "provisioning",
  ready: "usable",
  idle: "usable",
  running: "usable",
  archiving: "archiving",
  archived: "archived",
  error: "error",
};

export function classifyBoxState(state: unknown): BoxReadiness {
  if (typeof state !== "string") return "unknown";
  return BOX_READINESS_BY_STATE[state] ?? "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Validate + sanitize a provider Box object into persistable facts.
 * Explicitly drops `url`, `desktopUrl` and `subdomain` — desktop/VNC URLs can
 * embed access tokens and must never be stored or logged by OpenSquad. */
export function sanitizeBox(input: unknown): BoxFacts {
  if (!isRecord(input)) throw new Error("box payload is not an object");
  const boxId = optString(input["id"]);
  const state = optString(input["state"]);
  if (boxId === undefined) throw new Error("box payload missing string id");
  if (state === undefined) throw new Error("box payload missing string state");
  const snapshotAvailable =
    typeof input["snapshotAvailable"] === "boolean"
      ? input["snapshotAvailable"]
      : undefined;
  const facts: BoxFacts = {
    boxId,
    state,
    readiness: classifyBoxState(state),
  };
  const name = optString(input["name"]);
  const environment = optString(input["environment"]);
  const environmentVersion = optNumber(input["environmentVersion"]);
  const createdAt = input["createdAt"];
  const archiveAfter = input["archiveAfter"];
  const setupStatus = optString(input["setupStatus"]);
  const setupError = optString(input["setupError"]);
  return {
    ...facts,
    ...(name !== undefined ? { name } : {}),
    ...(environment !== undefined ? { environment } : {}),
    ...(environmentVersion !== undefined ? { environmentVersion } : {}),
    ...(createdAt instanceof Date ? { createdAt: createdAt.toISOString() } : {}),
    ...(archiveAfter instanceof Date
      ? { archiveAfter: archiveAfter.toISOString() }
      : {}),
    ...(snapshotAvailable !== undefined ? { snapshotAvailable } : {}),
    ...(setupStatus !== undefined ? { setupStatus } : {}),
    ...(setupError !== undefined ? { setupError } : {}),
  };
}

/** Deterministic JSON for fingerprinting request configs. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`,
    );
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Compare requests without storing worker tokens, scripts or command bodies. */
export function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
