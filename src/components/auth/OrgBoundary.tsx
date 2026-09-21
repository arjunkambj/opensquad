/** Select the first organization when none is active, then wait for a refreshed token
 * before rendering tenant data. */
import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import type { CurrentUser } from "@hexclave/react"
import { refreshConvexIdentity } from "@/components/ConvexClientProvider"
import { EmptyState, ErrorState } from "@/components/states/states"
import { useMountedRef } from "@/hooks/use-mounted"

export function OrgBoundary({
  user,
  fallback,
  children,
}: {
  user: CurrentUser
  fallback: ReactNode
  children: ReactNode
}) {
  const teams = user.useTeams()
  const selected = user.selectedTeam
  const [failed, setFailed] = useState(false)
  // One selection request per mount: `setSelectedTeam` is a write, and the
  // re-render its own user refresh causes would otherwise fire a second.
  const requested = useRef(false)
  const mounted = useMountedRef()

  useEffect(() => {
    const first = teams[0]
    if (selected !== null || requested.current || first === undefined) {
      return
    }
    requested.current = true
    void user
      .setSelectedTeam(first)
      // The token is what carries the organization to Convex, so the switch
      // is not real until a new one is minted and installed.
      .then(refreshConvexIdentity)
      // The failure belongs to this mount: the selection outlives a boundary
      // the user navigated away from, and a refusal that lands afterwards has
      // no screen to explain itself on.
      .catch(() => {
        if (mounted.current) {
          setFailed(true)
        }
      })
  }, [mounted, selected, teams, user])

  if (selected !== null) {
    return <>{children}</>
  }

  if (teams.length === 0) {
    return (
      <EmptyState
        title="No organization on this account"
        description="Every account gets its own organization. This one has none, so there is nothing to open yet — create or join one from your account, then come back."
      />
    )
  }

  if (failed) {
    return (
      <ErrorState
        title="Could not open your organization"
        description="We could not select an organization for this session. Reload the page and we'll try again."
        onRetry={() => window.location.reload()}
        retryLabel="Reload"
      />
    )
  }

  return <>{fallback}</>
}
