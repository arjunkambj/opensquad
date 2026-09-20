/**
 * The Manage-inbox read, with its owner guard resolved.
 *
 * `inbox.connection.getInboxConnection` is owner-guarded, so calling it as
 * anyone else throws and takes the screen down with it. This hook answers the
 * role question first and skips the query when the answer is no, which is
 * what lets the connect flow, the settings tab and the "connect inbox" banner
 * all render an honest state instead of an error boundary.
 */
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import type { WorkspaceRole } from "@/lib/workspace-role"
import type { InboxConnectionView } from "./inbox-connection-model"

export type InboxConnectionAccess =
  | { state: "loading" }
  /** Signed in, but holding no membership on this workspace. */
  | { state: "no_workspace" }
  | { state: "forbidden"; role: WorkspaceRole }
  | { state: "ready"; view: InboxConnectionView }

export function useInboxConnection(
  workspaceId: Id<"workspaces">,
): InboxConnectionAccess {
  const current = useCurrentWorkspace()
  const isOwner =
    current !== undefined &&
    current !== null &&
    current.workspace._id === workspaceId &&
    current.role === "owner"
  const view = useQuery(
    api.inbox.connection.getInboxConnection,
    isOwner ? { workspaceId } : "skip",
  )

  if (current === undefined) {
    return { state: "loading" }
  }
  if (current === null || current.workspace._id !== workspaceId) {
    return { state: "no_workspace" }
  }
  if (!isOwner) {
    return { state: "forbidden", role: current.role }
  }
  if (view === undefined) {
    return { state: "loading" }
  }
  return { state: "ready", view }
}
