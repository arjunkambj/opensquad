// Host-side filtered tool router (P21 — architecture §9, integrations §G2
// gateway contract items 1, 2 and 6).
//
// This replaces ONE branch of `decliningServerRequestHandler`: `item/tool/call`,
// the app-server's dynamic-tool channel. Every other refusal it makes is
// reproduced here unchanged, including the `-32601` default — the worker
// still holds no tokens to refresh and still cannot mint attestations.
//
// Three properties this file is responsible for:
//
//   1. DEFAULT DENY BY CONSTRUCTION. `TOOL_CAPABILITY` is an allowlist, not a
//      blocklist, and has no wildcard. A tool name that is not a key maps to
//      `undefined` and is refused. There is no path that reaches a backend
//      call without first naming a capability.
//   2. THE CAPABILITY SET IS THE REQUEST'S, NOT THE MODEL'S. The set comes
//      from `ClaimedWork.capabilities`, which the bridge issued and which the
//      backend re-checks again on the route itself. Nothing a website, an
//      email or a model turn says can widen it, because nothing in this file
//      reads model text to decide.
//   3. A DENIAL LOOKS LIKE A TOOL FAILURE, NOT A PROTOCOL FAULT. The reply is
//      a SUCCESSFUL JSON-RPC response carrying `success: false` — the same
//      shape the blanket refusal used. `{ok:false, error}` would be read by
//      the app-server as a transport problem rather than a refused tool.
//
// There is deliberately no send tool, in any form, on this surface.
import type { ServerRequestHandler } from "./appserver.js";
import type { CapabilityId, ClaimedWork } from "../contracts.js";

/** The bounded research tools the backend is willing to execute on the
 *  employee's behalf. Both require the same capability; both are executed
 *  Convex-side, because no provider credential may enter the Box. */
export const RESEARCH_READ_PAGES_TOOL = "opensquad.research.read_pages";
export const RESEARCH_REQUEST_PAGE_TOOL = "opensquad.research.request_page";

/**
 * The allowlist. Every entry is a typed domain operation, never a Convex
 * function name, table name or record patch (architecture §9). An unlisted
 * tool is refused — that is the whole mechanism, and it has no exceptions.
 */
export const TOOL_CAPABILITY: Readonly<Record<string, CapabilityId>> = {
  [RESEARCH_READ_PAGES_TOOL]: "opensquad.web_research",
  [RESEARCH_REQUEST_PAGE_TOOL]: "opensquad.web_research",
};

/** A refused tool call: a successful reply carrying a tool failure, with no
 *  content at all. Policy denials say nothing about why. */
const DENIED: { ok: true; result: unknown } = Object.freeze({
  ok: true as const,
  result: Object.freeze({ contentItems: [], success: false }),
});

export type ParsedToolCall = {
  readonly threadId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly namespace: string | null;
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
};

export type ToolCallOutcome =
  /** The backend executed the call; `text` is the bounded scoped result. */
  | { readonly kind: "result"; readonly text: string }
  /**
   * The tool was PERMITTED but the backend could not produce a result. This
   * is not a policy denial: the model is told, in bounded text, that the
   * content is unknown — which is how "missing or truncated content stays
   * explicitly unknown" reaches the turn instead of becoming a silent gap
   * the model fills by guessing.
   */
  | { readonly kind: "unavailable"; readonly text: string };

export type ToolRouterDeps = {
  /** Read at call time, never captured: always the lease the daemon holds
   *  right now, or `null`, which denies. */
  readonly currentWork: () => ClaimedWork | null;
  /** `threadId:turnId` of the turn currently executing, or `null`. */
  readonly currentTurnRef: () => string | null;
  /** Local `maxToolCalls` counter; `false` means the budget is spent. */
  readonly consumeToolCall: () => boolean;
  readonly invokeTool: (
    work: ClaimedWork,
    call: ParsedToolCall,
  ) => Promise<ToolCallOutcome>;
  readonly log: (event: string, fields: Record<string, unknown>) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Fail-closed parse of `DynamicToolCallParams`. Anything unexpected is
 *  `null`, which the caller turns into a denial. */
export function parseDynamicToolCall(params: unknown): ParsedToolCall | null {
  if (!isRecord(params)) return null;
  const threadId = params["threadId"];
  const turnId = params["turnId"];
  const callId = params["callId"];
  const tool = params["tool"];
  const namespace = params["namespace"];
  const args = params["arguments"];
  if (
    typeof threadId !== "string" ||
    threadId.length === 0 ||
    typeof turnId !== "string" ||
    turnId.length === 0 ||
    typeof callId !== "string" ||
    callId.length === 0 ||
    typeof tool !== "string" ||
    tool.length === 0 ||
    tool.length > 200
  ) {
    return null;
  }
  if (namespace !== null && typeof namespace !== "string") return null;
  if (!isRecord(args)) return null;
  return {
    threadId,
    turnId,
    callId,
    namespace: typeof namespace === "string" ? namespace : null,
    tool,
    arguments: args,
  };
}

/**
 * The stable server-request handler. Installed ONCE at boot and closed over
 * accessor functions rather than over a work item: the control loop runs
 * concurrently with a turn through the same `CodexAppServer`, which holds
 * exactly one handler with no stacking, so swapping a handler per turn races
 * both that loop and any `item/tool/call` already dispatched by the stdout
 * reader.
 */
export function workerServerRequestHandler(
  deps: ToolRouterDeps,
): ServerRequestHandler {
  return (method, params) => {
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
        return routeToolCall(deps, params);
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

async function routeToolCall(
  deps: ToolRouterDeps,
  params: unknown,
): Promise<{ ok: true; result: unknown }> {
  const work = deps.currentWork();
  if (work === null) {
    // No lease means no authority of any kind — including for a call that
    // arrives after a turn has already been reported terminal.
    deps.log("tool_denied", { reason: "no_lease" });
    return DENIED;
  }
  const call = parseDynamicToolCall(params);
  if (call === null) {
    deps.log("tool_denied", { reason: "malformed_params" });
    return DENIED;
  }
  if (`${call.threadId}:${call.turnId}` !== deps.currentTurnRef()) {
    deps.log("tool_denied", { reason: "foreign_turn", tool: call.tool });
    return DENIED;
  }
  const capability = TOOL_CAPABILITY[call.tool];
  if (capability === undefined) {
    deps.log("tool_denied", { reason: "unknown_tool", tool: call.tool });
    return DENIED;
  }
  if (!work.capabilities.includes(capability)) {
    deps.log("tool_denied", {
      reason: "capability_not_granted",
      tool: call.tool,
      capability,
    });
    return DENIED;
  }
  if (!deps.consumeToolCall()) {
    deps.log("tool_denied", { reason: "tool_budget_exhausted", tool: call.tool });
    return DENIED;
  }
  const outcome = await deps.invokeTool(work, call);
  return {
    ok: true,
    result: {
      contentItems: [{ type: "inputText", text: outcome.text }],
      success: outcome.kind === "result",
    },
  };
}
