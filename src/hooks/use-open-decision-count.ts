import { useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { boundedCount } from "@/lib/bounded-count"

/**
 * One page of open decisions, and exactly one arg shape.
 *
 * The sidebar badge and the `/leads` attention block must read the **same
 * call**: two numbers for one thing is a defect (`plan/ux.md` §3), and Convex
 * serves one subscription only when the arguments match byte for byte. That
 * is why this is a hook rather than two call sites agreeing to use the same
 * literal.
 *
 * It counts **open decisions of every kind, required or not**. `listOpen`
 * filters on state only and has no `required` argument, and filtering a
 * truncated page client-side would present a subset of one page as a filtered
 * total — which `plan/ux.md` §6 forbids. So the number is labelled for what
 * it actually is.
 */
export function useOpenDecisionCount(
  workspaceId: Id<"workspaces"> | undefined,
): string | undefined {
  const page = useQuery(
    api.decisions.listOpen,
    workspaceId === undefined ? "skip" : { workspaceId, limit: 25 },
  )
  return page === undefined
    ? undefined
    : boundedCount(page.items.length, page.hasMore)
}
