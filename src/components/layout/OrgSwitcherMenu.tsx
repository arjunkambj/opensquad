import { Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useNavigate } from "@tanstack/react-router"
import type { CurrentUser, Team } from "@hexclave/react"
import { useState } from "react"
import { refreshConvexIdentity } from "@/components/ConvexClientProvider"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"

export function OrgSwitcherMenu({ user }: { user: CurrentUser }) {
  const navigate = useNavigate()
  const teams = user.useTeams()
  const selectedId = user.selectedTeam?.id ?? null
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)

  if (teams.length === 0) {
    return null
  }

  const pick = async (team: Team) => {
    if (team.id === selectedId || switchingTo !== null) {
      return
    }
    setSwitchingTo(team.id)
    try {
      await user.setSelectedTeam(team)
      // Convex authorises by the token's active-organization claim, so the
      // switch only reaches the data once a new token is installed.
      refreshConvexIdentity()
      await navigate({ to: "/dashboard" })
    } finally {
      setSwitchingTo(null)
    }
  }

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Organization</DropdownMenuLabel>
      {teams.map((team) => (
        <DropdownMenuItem
          key={team.id}
          closeOnClick={false}
          disabled={switchingTo !== null}
          onClick={() => void pick(team)}
        >
          <span className="min-w-0 flex-1 truncate">{team.displayName}</span>
          {switchingTo === team.id ? (
            <Spinner />
          ) : team.id === selectedId ? (
            <HugeiconsIcon
              aria-label="Active organization"
              icon={Tick02Icon}
              strokeWidth={2}
            />
          ) : null}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  )
}
