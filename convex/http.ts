import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpAction } from "./_generated/server";
import { components } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { agentmail } from "./integrations/agentmail";
import {
  ARTIFACT_MAX_BYTES,
  BRIDGE_BODY_MAX_BYTES,
  sha256Hex,
  sha256HexBytes,
} from "./lib/validators";
import type { BridgeErrorCode } from "./lib/validators";

const http = httpRouter();

// The component's RunMutationCtx.runMutation is typed with the
// (mutation, args, options?) ArgsAndOptions signature while convex 1.45's
// http-action ctx exposes the single-argument OptionalRestArgs form. The
// component only ever calls runMutation(mutation, argsObject) — verified in
// dist/client/index.js — so the adapter below drops the unused options
// element; runtime behavior is unchanged.
type WebhookCtx = Parameters<typeof agentmail.handleWebhook>[0];

// --- AgentMail (P05) ----------------------------------------------------------
// POST /agentmail/webhook — signed AgentMail receiver. `handleWebhook` verifies
// the svix-id / svix-timestamp / svix-signature headers over the raw request
// body against AGENTMAIL_WEBHOOK_SECRET before any state change; unsigned or
// badly signed requests get 401. This is the ONLY AgentMail HTTP route —
// outbound sending is never reachable over HTTP (internalAction only, see
// convex/integrations/agentmail.ts).
http.route({
  path: "/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) =>
    agentmail.handleWebhook(
      {
        runMutation: ((mutation, args) =>
          ctx.runMutation(mutation, args)) as WebhookCtx["runMutation"],
      },
      request,
    ),
  ),
});

// --- Worker bridge (P07) ------------------------------------------------------
//
// Authenticated `/worker/*` transport for the scoped workspace worker. Every
// route requires `Authorization: Bearer <worker token>`; the token is hashed
// here and only the hash crosses into mutations (plaintext tokens are never
// logged or stored). Bodies are bounded JSON; errors return the documented
// status table:
//   400 invalid argument / malformed body / unknown-or-foreign id
//   401 missing/revoked/retired credential
//   403 credential lacks the required scope
//   409 stale generation, expired lease, conflicting or already-applied result
//   413 body over the route's bound
//   429 poll/heartbeat/activity rate limit
//   503 temporary backend unavailability
// Claim routes return 204 when no work is claimable.

const BRIDGE_ERROR_STATUS: Record<BridgeErrorCode, number> = {
  INVALID: 400,
  NOT_FOUND: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  THROTTLED: 429,
  UNAVAILABLE: 503,
};

function bridgeFailure(code: BridgeErrorCode, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    {
      status: BRIDGE_ERROR_STATUS[code],
      headers: { "Content-Type": "application/json" },
    },
  );
}

function bridgeOk(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Map a thrown bridge/domain error (or defect) to its documented status. */
function bridgeErrorResponse(error: unknown): Response {
  // Mutation arg validation rejects a field with ArgumentValidationError —
  // a client shape problem, never a retryable backend failure.
  if (
    error instanceof Error &&
    (error.name === "ArgumentValidationError" ||
      error.name === "ValidatorError")
  ) {
    return bridgeFailure("INVALID", "request fields failed validation");
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof (error as { data?: unknown }).data === "object"
  ) {
    const data = (error as { data: { code?: unknown; message?: unknown } })
      .data;
    const code = data.code;
    // The backend also surfaces arg-validation failure inside error data.
    if (code === "ArgumentValidationError") {
      return bridgeFailure("INVALID", "request fields failed validation");
    }
    if (
      typeof code === "string" &&
      code in BRIDGE_ERROR_STATUS
    ) {
      return bridgeFailure(
        code as BridgeErrorCode,
        typeof data.message === "string" ? data.message : "request rejected",
      );
    }
  }
  // Unexpected defect — report temporary unavailability, not detail.
  return bridgeFailure("UNAVAILABLE", "temporary backend unavailability");
}

async function workerCredentialHash(request: Request): Promise<string> {
  const header = request.headers.get("authorization");
  if (header === null || !header.startsWith("Bearer ")) {
    throw bridgeFailure("UNAUTHENTICATED", "missing bearer token");
  }
  const token = header.slice("Bearer ".length).trim();
  if (token.length === 0 || token.length > 200) {
    throw bridgeFailure("UNAUTHENTICATED", "malformed bearer token");
  }
  return await sha256Hex(token);
}

/** Read a bounded JSON object body (Content-Length short-circuit + actual). */
async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > BRIDGE_BODY_MAX_BYTES) {
    throw bridgeFailure("PAYLOAD_TOO_LARGE", "body exceeds the bridge bound");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > BRIDGE_BODY_MAX_BYTES) {
    throw bridgeFailure("PAYLOAD_TOO_LARGE", "body exceeds the bridge bound");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw bridgeFailure("INVALID", "body is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw bridgeFailure("INVALID", "body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || value.length === 0) {
    throw bridgeFailure("INVALID", `${name} must be a non-empty string`);
  }
  return value;
}

function numberField(body: Record<string, unknown>, name: string): number {
  const value = body[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw bridgeFailure("INVALID", `${name} must be an integer`);
  }
  return value;
}

function optionalStringField(
  body: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = body[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Shared route driver: authenticate → parse → invoke the internal mutation →
 * serialize. `credentialHash` is injected; the handler only maps body fields.
 */
function workerRoute(
  invoke: (
    ctx: ActionCtx,
    credentialHash: string,
    body: Record<string, unknown>,
  ) => Promise<unknown>,
): ReturnType<typeof httpAction> {
  return httpAction(async (ctx, request) => {
    try {
      const credentialHash = await workerCredentialHash(request);
      const body = await boundedJson(request);
      const payload = await invoke(ctx, credentialHash, body);
      if (payload === null) {
        return new Response(null, { status: 204 });
      }
      return bridgeOk(payload);
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }
      return bridgeErrorResponse(error);
    }
  });
}

// POST /worker/claim — acquire the workspace slot + lease the next request.
http.route({
  path: "/worker/claim",
  method: "POST",
  handler: workerRoute(async (ctx, credentialHash, body) => {
    const result = (await ctx.runMutation(internal.workerBridge.claimWork, {
      credentialHash,
      requestId: stringField(body, "requestId"),
      runtimeGeneration: numberField(body, "runtimeGeneration"),
      protocolVersion: stringField(body, "protocolVersion"),
    })) as { claimed: boolean } & Record<string, unknown>;
    if (!result.claimed) {
      return null; // → 204
    }
    return result;
  }),
});

// POST /worker/control/claim — separate path for owner control commands.
http.route({
  path: "/worker/control/claim",
  method: "POST",
  handler: workerRoute(async (ctx, credentialHash, body) => {
    const result = (await ctx.runMutation(
      internal.workerBridge.claimControl,
      {
        credentialHash,
        requestId: stringField(body, "requestId"),
        runtimeGeneration: numberField(body, "runtimeGeneration"),
        protocolVersion: stringField(body, "protocolVersion"),
      },
    )) as { claimed: boolean } & Record<string, unknown>;
    if (!result.claimed) {
      return null;
    }
    return result;
  }),
});

// POST /worker/control/result — accept-once control outcome + the optional
// login challenge (validated + stored separately from activity/feeds).
http.route({
  path: "/worker/control/result",
  method: "POST",
  handler: workerRoute(async (ctx, credentialHash, body) => {
    return await ctx.runMutation(internal.workerBridge.applyControlResult, {
      credentialHash,
      controlRequestId: stringField(body, "controlRequestId"),
      runtimeGeneration: numberField(body, "runtimeGeneration"),
      resultId: stringField(body, "resultId"),
      status: stringField(body, "status") as
        | "challenge_issued"
        | "completed"
        | "failed",
      safeResult: body.safeResult ?? {},
    });
  }),
});

// POST /worker/runtime-heartbeat — liveness only; grants or renews nothing.
http.route({
  path: "/worker/runtime-heartbeat",
  method: "POST",
  handler: workerRoute(async (ctx, credentialHash, body) => {
    return await ctx.runMutation(
      internal.workerBridge.runtimeHeartbeat,
      {
        credentialHash,
        runtimeGeneration: numberField(body, "runtimeGeneration"),
        workerVersion: stringField(body, "workerVersion"),
        protocolVersion: stringField(body, "protocolVersion"),
        phase: stringField(body, "phase") as
          | "boot"
          | "ready"
          | "running"
          | "degraded"
          | "stopping",
        ...(optionalStringField(body, "currentRunId") !== undefined
          ? {
              currentRunId: stringField(body, "currentRunId") as Id<"runs">,
            }
          : {}),
        ...(optionalStringField(body, "currentCodexTurnRef") !== undefined
          ? { currentCodexTurnRef: stringField(body, "currentCodexTurnRef") }
          : {}),
      },
    );
  }),
});

// POST /worker/heartbeat — renew the live lease; may order a stop.
http.route({
  path: "/worker/heartbeat",
  method: "POST",
  handler: workerRoute(async (ctx, credentialHash, body) => {
    return await ctx.runMutation(internal.workerBridge.heartbeat, {
      credentialHash,
      workerRequestId: stringField(body, "workerRequestId"),
      generation: numberField(body, "generation"),
      leaseToken: stringField(body, "leaseToken"),
      runtimeGeneration: numberField(body, "runtimeGeneration"),
      phase: stringField(body, "phase") as
        | "boot"
        | "ready"
        | "running"
        | "degraded"
        | "stopping",
    });
  }),
});

// POST /worker/activity — deduped allowlisted progress (one update / 5s).
http.route({
  path: "/worker/activity",
  method: "POST",
  handler: workerRoute(async (ctx, credentialHash, body) => {
    return await ctx.runMutation(
      internal.workerBridge.recordWorkerActivity,
      {
        credentialHash,
        workerRequestId: stringField(body, "workerRequestId"),
        generation: numberField(body, "generation"),
        leaseToken: stringField(body, "leaseToken"),
        runtimeGeneration: numberField(body, "runtimeGeneration"),
        eventId: stringField(body, "eventId"),
        kind: stringField(body, "kind"),
        summary: stringField(body, "summary"),
        ...(optionalStringField(body, "phase") !== undefined
          ? {
              phase: stringField(body, "phase") as
                | "boot"
                | "ready"
                | "running"
                | "degraded"
                | "stopping",
            }
          : {}),
      },
    );
  }),
});

// POST /worker/result — schemaVersion-1 result, applied exactly once.
http.route({
  path: "/worker/result",
  method: "POST",
  handler: workerRoute(async (ctx, credentialHash, body) => {
    return await ctx.runMutation(internal.workerBridge.applyResult, {
      credentialHash,
      workerRequestId: stringField(body, "workerRequestId"),
      generation: numberField(body, "generation"),
      leaseToken: stringField(body, "leaseToken"),
      runtimeGeneration: numberField(body, "runtimeGeneration"),
      resultId: stringField(body, "resultId"),
      resultDigest: stringField(body, "resultDigest"),
      result: body.result,
    });
  }),
});

// POST /worker/failure — bounded failure record; Workflow decides retry.
http.route({
  path: "/worker/failure",
  method: "POST",
  handler: workerRoute(async (ctx, credentialHash, body) => {
    return await ctx.runMutation(internal.workerBridge.applyFailure, {
      credentialHash,
      workerRequestId: stringField(body, "workerRequestId"),
      generation: numberField(body, "generation"),
      leaseToken: stringField(body, "leaseToken"),
      runtimeGeneration: numberField(body, "runtimeGeneration"),
      failureId: stringField(body, "failureId"),
      code: stringField(body, "code"),
      retrySafety: stringField(body, "retrySafety") as
        | "safe"
        | "unsafe"
        | "unknown",
      summary: stringField(body, "summary"),
    });
  }),
});

// POST /worker/tool — the lease-bound capability tool channel (P21).
//
// Its own httpAction rather than `workerRoute`, because `workerRoute` runs
// exactly one mutation and this is mutation → action → mutation: the
// authorizing transaction must consume the tool-call budget BEFORE the paid
// retrieval, and the receipt must be written after it. Modelled on
// /worker/artifact, which already has that shape.
//
// Every refusal is a status, never a leak: an unknown or foreign
// workerRequestId, an unknown or foreign prospectId and an unknown tool name
// are all 400 with no existence signal; a request that does not carry the
// capability is 403; a spent tool budget or a dead lease is 409.
http.route({
  path: "/worker/tool",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const credentialHash = await workerCredentialHash(request);
      const body = await boundedJson(request);
      const common = {
        credentialHash,
        workerRequestId: stringField(body, "workerRequestId"),
        generation: numberField(body, "generation"),
        leaseToken: stringField(body, "leaseToken"),
        runtimeGeneration: numberField(body, "runtimeGeneration"),
        callId: stringField(body, "callId"),
        tool: stringField(body, "tool"),
        prospectId: stringField(body, "prospectId"),
      };
      const url = optionalStringField(body, "url");
      const begin = (await ctx.runMutation(
        internal.workerBridge.beginWorkerToolCall,
        { ...common, ...(url !== undefined ? { url } : {}) },
      )) as
        | {
            decision: "retrieve";
            missionId: Id<"missions">;
            prospectId: Id<"prospects">;
            runId: Id<"runs">;
            url: string;
          }
        | { decision: "answer"; payload: string };

      let payload: string;
      let outcome: "result" | "unavailable";
      let detail: string | undefined;
      if (begin.decision === "answer") {
        payload = begin.payload;
        outcome = "result";
      } else {
        const retrieved = (await ctx.runAction(
          internal.integrations.firecrawl.retrieveProspectPage,
          {
            missionId: begin.missionId,
            prospectId: begin.prospectId,
            runId: begin.runId,
            url: begin.url,
          },
        )) as {
          state: string;
          page?: { url: string; retrievedAt: number; excerpt: string; statusCode?: number; truncated: boolean };
          error?: { code: string; message: string };
        };
        if (retrieved.page === undefined) {
          // A permitted tool whose backend call did not produce a page. The
          // model is told the content is UNKNOWN rather than being left to
          // fill the gap by guessing — that is §G2's "missing or truncated
          // content stays explicitly unknown", not a policy denial.
          outcome = "unavailable";
          detail = retrieved.error?.code ?? retrieved.state;
          payload = JSON.stringify({
            status: "unavailable",
            reason: detail,
          });
        } else {
          outcome = "result";
          payload = JSON.stringify({
            status: "ok",
            page: {
              url: retrieved.page.url,
              retrievedAt: retrieved.page.retrievedAt,
              statusCode: retrieved.page.statusCode ?? null,
              truncated: retrieved.page.truncated,
              excerpt: retrieved.page.excerpt.slice(0, TOOL_EXCERPT_MAX_LENGTH),
            },
          });
        }
      }

      await ctx.runMutation(internal.workerBridge.settleWorkerToolCall, {
        ...common,
        outcome,
        ...(detail !== undefined ? { detail } : {}),
      });
      return bridgeOk({ status: outcome, payload });
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }
      return bridgeErrorResponse(error);
    }
  }),
});

/** Excerpt length handed to a model turn — mirrors the bridge's own bound. */
const TOOL_EXCERPT_MAX_LENGTH = 1_200;

// POST /worker/artifact — raw bounded bytes with metadata headers; the server
// scopes, verifies the digest/type, stores the blob and links its own
// storage ID (the worker never supplies a storage reference).
//
//   Authorization: Bearer <token>          X-Worker-Request-Id: <id>
//   X-Runtime-Generation: <n>              X-Lease-Token: <token>
//   X-Artifact-Operation-Key: <key>        X-Artifact-Kind: <kind>
//   X-Artifact-Digest: sha256:<hex>        Content-Type: <declared mime>
//   X-Prospect-Id: <id> (optional)
http.route({
  path: "/worker/artifact",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let storageId: string | undefined;
    try {
      const credentialHash = await workerCredentialHash(request);
      const mimeType = request.headers.get("content-type") ?? "";
      const workerRequestId = headerField(request, "x-worker-request-id");
      const runtimeGeneration = Number(
        headerField(request, "x-runtime-generation"),
      );
      const leaseToken = headerField(request, "x-lease-token");
      const operationKey = headerField(request, "x-artifact-operation-key");
      const kind = headerField(request, "x-artifact-kind");
      const digest = headerField(request, "x-artifact-digest");
      const prospectId = request.headers.get("x-prospect-id") ?? undefined;

      const declaredLength = request.headers.get("content-length");
      if (
        declaredLength !== null &&
        Number(declaredLength) > ARTIFACT_MAX_BYTES
      ) {
        throw bridgeFailure("PAYLOAD_TOO_LARGE", "artifact exceeds 5 MiB");
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length === 0 || bytes.length > ARTIFACT_MAX_BYTES) {
        throw bridgeFailure(
          "PAYLOAD_TOO_LARGE",
          `artifact must be 1..${ARTIFACT_MAX_BYTES} bytes`,
        );
      }
      const actualDigest = `sha256:${await sha256HexBytes(bytes)}`;
      if (actualDigest !== digest) {
        throw bridgeFailure("INVALID", "content does not match the declared digest");
      }
      const sniffed = sniffMimeType(bytes);
      // JSON-looking bytes are still valid text — a declared text/* artifact
      // starting with '{' or '[' is markdown/plain text, not a type lie.
      if (
        sniffed !== null &&
        sniffed !== mimeType &&
        !(sniffed === "application/json" && mimeType.startsWith("text/"))
      ) {
        throw bridgeFailure(
          "INVALID",
          `bytes look like ${sniffed}, not declared ${mimeType}`,
        );
      }

      const grant = (await ctx.runMutation(
        internal.workerBridge.checkArtifactGrant,
        {
          credentialHash,
          workerRequestId,
          runtimeGeneration,
          leaseToken,
          operationKey,
          mimeType,
          byteSize: bytes.length,
          digest,
        },
      )) as { deduplicated: boolean; artifactId?: string };
      if (grant.deduplicated) {
        return bridgeOk({
          artifactId: grant.artifactId,
          deduplicated: true,
        });
      }
      storageId = (await ctx.storage.store(
        new Blob([new Uint8Array(bytes)], { type: mimeType }),
      )) as string;
      const linked = (await ctx.runMutation(
        internal.workerBridge.linkArtifact,
        {
          credentialHash,
          workerRequestId,
          runtimeGeneration,
          leaseToken,
          operationKey,
          mimeType,
          byteSize: bytes.length,
          digest,
          kind,
          storageId: storageId as never,
          ...(prospectId !== undefined ? { prospectId } : {}),
        },
      )) as { artifactId: string };
      return bridgeOk({ artifactId: linked.artifactId, deduplicated: false });
    } catch (error) {
      // The lease may have expired between grant and link — drop the blob so
      // storage never holds a row-less object (the reverse direction is
      // reconciled by sweepOrphanArtifacts).
      if (storageId !== undefined) {
        try {
          await ctx.storage.delete(storageId as Id<"_storage">);
        } catch {
          // best-effort cleanup
        }
      }
      if (error instanceof Response) {
        return error;
      }
      return bridgeErrorResponse(error);
    }
  }),
});

function headerField(request: Request, name: string): string {
  const value = request.headers.get(name);
  if (value === null || value.length === 0 || value.length > 300) {
    throw bridgeFailure("INVALID", `${name} header is missing or malformed`);
  }
  return value;
}

/** Magic-byte sniffing for the allowlisted artifact types. */
function sniffMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length > 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length > 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length > 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "application/pdf";
  }
  if (
    bytes.length > 0 &&
    (bytes[0] === 0x7b || bytes[0] === 0x5b) // '{' or '['
  ) {
    return "application/json";
  }
  // text/* has no reliable signature — accept the declared type.
  return null;
}

// --- Reserved-path method guards (P16) ----------------------------------------
// Convex route lookup checks exact (path, method) pairs BEFORE prefix routes.
// The static catch-all registered below is GET-only, so a bare GET on a
// reserved webhook/bridge path would still fall through to it and render
// index.html — a misleading 200 on an API path, and exactly the "swallowed
// route" failure G4 forbids. Pin every reserved path to an app-owned 405 for
// GET so NO method on these paths can ever serve the SPA. (POST keeps its
// exact handlers above; other methods have no prefix route to fall into and
// already 404.) `/firecrawl/webhook` is component-mounted for POST; the guard
// only claims the unused GET method on the same path.
const RESERVED_GET_PATHS = [
  "/agentmail/webhook",
  "/firecrawl/webhook",
  "/worker/claim",
  "/worker/control/claim",
  "/worker/control/result",
  "/worker/runtime-heartbeat",
  "/worker/heartbeat",
  "/worker/activity",
  "/worker/result",
  "/worker/failure",
  "/worker/tool",
  "/worker/artifact",
] as const;

for (const path of RESERVED_GET_PATHS) {
  http.route({
    path,
    method: "GET",
    handler: httpAction(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "METHOD_NOT_ALLOWED",
              message: "this endpoint accepts POST only",
            },
          }),
          {
            status: 405,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ),
  });
}

// --- Static hosting SPA fallback (P16) ----------------------------------------
// App-owned root routing (integrations.md §G4): registered LAST, after every
// app route and method guard above. `registerStaticRoutes` adds a single GET
// prefix route at "/" that resolves uploaded Vite `dist` assets from the
// staticHosting component (with SPA fallback to index.html). It cannot shadow
// the exact POST routes for /worker/*, /agentmail/webhook or the
// component-mounted /firecrawl/* prefix — the router prefers exact matches
// and the reserved-path guards above close the remaining GET gap.
registerStaticRoutes(http, components.staticHosting);

export default http;
