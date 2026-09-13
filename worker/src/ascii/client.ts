// Thin typed client over the pinned @asciidev/box-sdk (0.0.34) REST v1 surface.
//
// Verified against the installed package (see plan/evidence/P03.md):
//   - `new BoxApi(new Configuration({ accessToken }))` sends
//     `Authorization: Bearer <key>` against `https://ascii.dev/api/box/v1`.
//   - `create({ idempotencyKey, createBoxRequest })` maps `idempotencyKey` to
//     the `Idempotency-Key` HTTP header; `createBoxRequest` carries `noEnv`,
//     `ttlSeconds`, `env`, `from`, `type`, `setupScript`.
//   - `deleteBox({ boxId, xAsciiConfirmDelete })` requires the
//     `X-Ascii-Confirm-Delete` header to equal the target `boxId` exactly.
//   - `command` / `commandStatus` cover the bootstrap contract
//     (`POST /boxes/{id}/commands`, sync or `detached` + status polling).
//   - `stop` archives (pause); `resume` accepts `noEnv`/`ttlSeconds`;
//     `update` (`PATCH /boxes/{id}`) extends TTL via `ttlSeconds`.
// If a future operation is missing from the SDK, call the documented REST
// endpoint directly — never guess a wrapper signature.

import {
  BoxApi,
  Configuration,
  FetchError,
  ResponseError,
  type Box,
  type BoxActionResponse,
  type BoxInfoResponse,
  type Command200Response,
  type CommandStatusResponse,
  type CreateBoxResponse,
  type DeletionOperationResponse,
} from "@asciidev/box-sdk";

import type { BoxCommandSpec, BoxCreateConfig } from "./types.js";

/** Structured failure surfaced to the adapter; no secrets may be embedded. */
export type AsciiCallError = {
  readonly kind: "http" | "transport" | "validation";
  readonly status?: number;
  /** Provider error code from the `box.error` envelope when present. */
  readonly code?: string;
  readonly message: string;
  readonly requestId?: string;
};

export type AsciiCallResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AsciiCallError };

const ERROR_BODY_LIMIT = 4096;

async function describeResponseError(
  err: ResponseError,
): Promise<AsciiCallError> {
  const status = err.response.status;
  let code: string | undefined;
  let requestId: string | undefined;
  let message = `HTTP ${status}`;
  try {
    const text = await err.response.text();
    const parsed: unknown = JSON.parse(text.slice(0, ERROR_BODY_LIMIT));
    if (typeof parsed === "object" && parsed !== null) {
      const envelope = parsed as Record<string, unknown>;
      const inner = envelope["error"];
      if (typeof inner === "object" && inner !== null) {
        const innerRecord = inner as Record<string, unknown>;
        if (typeof innerRecord["code"] === "string") {
          code = innerRecord["code"];
        }
        if (typeof innerRecord["message"] === "string") {
          message = innerRecord["message"];
        }
      }
      if (typeof envelope["code"] === "string" && code === undefined) {
        code = envelope["code"];
      }
      if (typeof envelope["requestId"] === "string") {
        requestId = envelope["requestId"];
      }
    }
  } catch {
    // Non-JSON or unreadable body — status is still authoritative.
  }
  return {
    kind: "http",
    status,
    message,
    ...(code !== undefined ? { code } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

async function call<T>(
  op: () => Promise<T>,
): Promise<AsciiCallResult<T>> {
  try {
    return { ok: true, value: await op() };
  } catch (err) {
    if (err instanceof ResponseError) {
      return { ok: false, error: await describeResponseError(err) };
    }
    if (err instanceof FetchError) {
      // The request may or may not have reached the provider.
      return {
        ok: false,
        error: {
          kind: "transport",
          message: err.message.slice(0, 500),
        },
      };
    }
    if (err instanceof Error) {
      return {
        ok: false,
        error: {
          kind: "validation",
          message: err.message.slice(0, 500),
        },
      };
    }
    return {
      ok: false,
      error: { kind: "transport", message: "unknown transport failure" },
    };
  }
}

/** Typed access to the subset of `https://ascii.dev/api/box/v1` OpenSquad uses. */
export class AsciiBoxClient {
  readonly #api: BoxApi;

  constructor(apiKey: string, basePath?: string) {
    const params: { accessToken: string; basePath?: string } = {
      accessToken: apiKey,
    };
    if (basePath !== undefined) params.basePath = basePath;
    this.#api = new BoxApi(new Configuration(params));
  }

  /** POST /boxes with `Idempotency-Key`. Retry safety comes from the caller
   * persisting `idempotencyKey` + an identical body before the first call. */
  createBox(
    idempotencyKey: string,
    config: BoxCreateConfig,
  ): Promise<AsciiCallResult<CreateBoxResponse>> {
    return call(() =>
      this.#api.create({
        idempotencyKey,
        createBoxRequest: {
          noEnv: config.noEnv,
          ttlSeconds: config.ttlSeconds,
          ...(config.env !== undefined ? { env: { ...config.env } } : {}),
          ...(config.from !== undefined ? { from: config.from } : {}),
          ...(config.type !== undefined ? { type: config.type } : {}),
          ...(config.setupScript !== undefined
            ? { setupScript: config.setupScript }
            : {}),
        },
      }),
    );
  }

  /** GET /boxes/{boxId} — provisioning/readiness/state inspection. */
  inspectBox(boxId: string): Promise<AsciiCallResult<BoxInfoResponse>> {
    return call(() => this.#api.get({ boxId }));
  }

  /** POST /boxes/{boxId}/commands — bootstrap commands. `detached: true`
   * returns a processId immediately; poll `commandStatus` for completion. */
  runCommand(
    boxId: string,
    spec: BoxCommandSpec,
  ): Promise<AsciiCallResult<Command200Response>> {
    return call(() =>
      this.#api.command({
        boxId,
        commandRequest: {
          command: spec.command,
          ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}),
          ...(spec.timeoutSeconds !== undefined
            ? { timeoutSeconds: spec.timeoutSeconds }
            : {}),
          ...(spec.detached !== undefined ? { detached: spec.detached } : {}),
        },
      }),
    );
  }

  /** GET /boxes/{boxId}/commands/{processId} — detached command status/logs. */
  commandStatus(
    boxId: string,
    processId: number,
    tailBytes?: number,
  ): Promise<AsciiCallResult<CommandStatusResponse>> {
    return call(() =>
      this.#api.commandStatus({
        boxId,
        processId,
        ...(tailBytes !== undefined ? { tailBytes } : {}),
      }),
    );
  }

  /** POST /boxes/{boxId}/resume — resume the same archived Box. */
  resumeBox(
    boxId: string,
    options?: { ttlSeconds?: number; noEnv?: boolean },
  ): Promise<AsciiCallResult<BoxActionResponse>> {
    return call(() =>
      this.#api.resume({
        boxId,
        resumeRequest: {
          ...(options?.ttlSeconds !== undefined
            ? { ttlSeconds: options.ttlSeconds }
            : {}),
          ...(options?.noEnv !== undefined ? { noEnv: options.noEnv } : {}),
        },
      }),
    );
  }

  /** PATCH /boxes/{boxId} — set an explicit remaining TTL in seconds. */
  extendTtl(
    boxId: string,
    ttlSeconds: number,
  ): Promise<AsciiCallResult<BoxInfoResponse>> {
    return call(() =>
      this.#api.update({ boxId, updateBoxRequest: { ttlSeconds } }),
    );
  }

  /** POST /boxes/{boxId}/stop — drain, snapshot and archive (pause). */
  stopBox(
    boxId: string,
    options?: { force?: boolean },
  ): Promise<AsciiCallResult<BoxActionResponse>> {
    return call(() =>
      this.#api.stop({
        boxId,
        ...(options?.force !== undefined
          ? { stopRequest: { force: options.force } }
          : {}),
      }),
    );
  }

  /** DELETE /boxes/{boxId} — permanent deletion. The API requires the
   * `X-Ascii-Confirm-Delete` header to equal the target boxId; a mismatch
   * returns 409 without accepting deletion. Irreversible. */
  deleteBox(boxId: string): Promise<AsciiCallResult<DeletionOperationResponse>> {
    return call(() =>
      this.#api.deleteBox({ boxId, xAsciiConfirmDelete: boxId }),
    );
  }

  /** GET /deletion-operations/{operationId} — poll a deletion operation. */
  getDeletionOperation(
    operationId: string,
  ): Promise<AsciiCallResult<DeletionOperationResponse>> {
    return call(() => this.#api.getDeletionOperation({ operationId }));
  }
}

export type { Box };
