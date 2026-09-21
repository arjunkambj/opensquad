import { useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { OrgView } from "@/lib/org-view"

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

export function useCurrentOrgId(): Id<"orgs"> | undefined {
  const current = useCurrentOrg()
  return current.status === "ready" ? current.org._id : undefined
}
