import { useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"

/**
 * The signed-in user's current workspace context.
 *
 * Returns `undefined` while loading, `null` when signed out or holding no
 * active membership, and `{ workspace, role, membershipId }` otherwise.
 * Callers must handle all three cases (V11 honest loading/empty states).
 */
export function useCurrentWorkspace() {
  return useQuery(api.workspaces.queries.getCurrent)
}
