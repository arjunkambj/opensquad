/**
 * The Manage-inbox read, resolved against the active organization.
 *
 * `inbox.connection.getInboxConnection` refuses a request whose active
 * organization is not the one being asked about, so the query is skipped
 * until the two agree. That is what lets the connect flow, the settings tab
 * and the "connect inbox" banner all render an honest state instead of an
 * error boundary.
 */
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { useCurrentOrg } from "@/hooks/use-current-org"
import type { InboxConnectionView } from "./inbox-connection-model"

export type InboxConnectionAccess =
  | { state: "loading" }
  /** Signed in, but this organization is not the caller's active one. */
  | { state: "no_org" }
  | { state: "ready"; view: InboxConnectionView }

export function useInboxConnection(orgId: Id<"orgs">): InboxConnectionAccess {
  const current = useCurrentOrg()
  const active = current.status === "ready" && current.org._id === orgId
  const view = useQuery(
    api.inbox.connection.getInboxConnection,
    active ? { orgId } : "skip",
  )

  if (current.status === "loading") {
    return { state: "loading" }
  }
  if (!active) {
    return { state: "no_org" }
  }
  if (view === undefined) {
    return { state: "loading" }
  }
  return { state: "ready", view }
}
