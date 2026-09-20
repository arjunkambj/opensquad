import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

/**
 * The workspace as the browser receives it. Not `Doc<"workspaces">`: the
 * server keeps the inbound-mail path token and the provider's webhook id to
 * itself, so components type against what the query actually returns.
 */
export type WorkspaceView = FunctionReturnType<
  typeof api.workspaces.queries.get
>;
