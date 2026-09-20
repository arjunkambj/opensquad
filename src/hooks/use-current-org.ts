import { useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { OrgView } from "@/lib/org-view"

/**
 * The organization the caller is working in, as five states the UI renders
 * differently. The tenant is whichever organization is active in the auth
 * provider, so none of these is a choice this app asks the user to make:
 *
 *   `loading`         the query has not answered yet
 *   `signed_out`      no session, or an anonymous one
 *   `no_active_org`   signed in with no organization selected — `OrgBoundary`
 *                     selects the first one and the token refreshes
 *   `not_initialised` the active organization has never entered the app;
 *                     `/onboarding` gives it its row
 *   `ready`           the row, as the browser is allowed to see it
 */
export type CurrentOrg =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "no_active_org" }
  | { status: "not_initialised" }
  | { status: "ready"; org: OrgView }

export function useCurrentOrg(): CurrentOrg {
  const current = useQuery(api.orgs.queries.getCurrent)
  if (current === undefined) {
    return { status: "loading" }
  }
  if (current === null) {
    return { status: "signed_out" }
  }
  if (current.org !== undefined) {
    return { status: "ready", org: current.org }
  }
  return { status: current.reason }
}

/**
 * The active organization's id once it is known, else `undefined` — the shape
 * a dependent `useQuery` skips on.
 */
export function useCurrentOrgId(): Id<"orgs"> | undefined {
  const current = useCurrentOrg()
  return current.status === "ready" ? current.org._id : undefined
}
