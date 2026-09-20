import type { FunctionReturnType } from "convex/server"
import type { api } from "../../convex/_generated/api"

/**
 * The caller's role in the current workspace.
 *
 * Derived from `workspaces.getCurrent` rather than re-declared, so a role
 * added to the backend union cannot silently fall through a check here. One
 * definition for the whole app.
 */
export type WorkspaceRole = NonNullable<
  FunctionReturnType<typeof api.workspaces.queries.getCurrent>
>["role"]

/**
 * Whether this role may write.
 *
 * `requireWorkspaceEditor` in `convex/lib/auth.ts` is `["owner", "operator"]`,
 * and every write mutation is gated by it. This mirrors that one list, so the UI
 * offers exactly what the server will accept — the server check is the
 * backstop, not the design (V23 step 2).
 */
export function canEdit(role: WorkspaceRole): boolean {
  return role === "owner" || role === "operator"
}
