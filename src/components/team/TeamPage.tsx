/** Members and invitations live in the auth provider: the active organization is the tenant, so nothing here touches Convex. */
import { Cancel01Icon, Delete02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useUser } from "@hexclave/react"
import type { CurrentUser, Team } from "@hexclave/react"
import { Suspense, useState } from "react"
import { Chip } from "@/components/kit/Chip"
import { TableFrame } from "@/components/kit/PageSection"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { InviteMemberButton } from "@/components/team/InviteMemberDialog"
import { RemoveMemberDialog } from "@/components/team/RemoveMemberDialog"
import type { MemberToRemove } from "@/components/team/RemoveMemberDialog"
import { MembersTableHeader } from "@/components/team/MembersTableHeader"
import {
  MembersTableSkeleton,
  TeamPageSkeleton,
} from "@/components/team/TeamPageSkeleton"
import { SkeletonRegion } from "@/components/states/skeletons"
import { EmptyState } from "@/components/states/states"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"

export function TeamPage() {
  const user = useUser()

  if (!user) {
    return <TeamPageSkeleton />
  }

  const team = user.selectedTeam

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Team"
        description="The people who share this organization's agent, leads and inbox."
        actions={
          team === null ? null : (
            <Suspense fallback={<Skeleton shape="xl" className="h-8 w-36" />}>
              <InviteMemberButton key={team.id} team={team} user={user} />
            </Suspense>
          )
        }
      />
      {team === null ? (
        <EmptyState
          title="No organization selected"
          description="Pick an organization from the account menu to see who is in it."
        />
      ) : (
        /* The member and invitation hooks suspend; keep the page title up while they load. */
        <Suspense
          fallback={
            <SkeletonRegion label="Loading members">
              <MembersTableSkeleton />
            </SkeletonRegion>
          }
        >
          <MembersTable key={team.id} team={team} user={user} />
        </Suspense>
      )}
    </div>
  )
}

function MembersTable({ team, user }: { team: Team; user: CurrentUser }) {
  const canInvite = user.usePermission(team, "$invite_members") !== null
  const canRemove = user.usePermission(team, "$remove_members") !== null
  const members = team.useUsers()
  const [removing, setRemoving] = useState<MemberToRemove | null>(null)

  return (
    <TableFrame>
      <Table>
        <MembersTableHeader />
        <TableBody>
          {members.map((member) => {
            const name = member.teamProfile.displayName ?? "Unnamed member"
            const isSelf = member.id === user.id
            return (
              <TableRow key={member.id}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="size-8">
                      {member.teamProfile.profileImageUrl ? (
                        <AvatarImage alt={name} src={member.teamProfile.profileImageUrl} />
                      ) : null}
                      <AvatarFallback>
                        <span className="text-xs font-medium">
                          {name.slice(0, 1).toUpperCase()}
                        </span>
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate text-foreground">{name}</span>
                    {isSelf ? <Chip variant="accent">You</Chip> : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">Active</TableCell>
                <TableCell className="text-right">
                  {canRemove && !isSelf ? (
                    <Button
                      aria-label={`Remove ${name}`}
                      onClick={() =>
                        setRemoving({ name, remove: () => team.removeUser(member.id) })
                      }
                      size="icon-sm"
                      type="button"
                      variant="destructive"
                    >
                      <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} strokeWidth={2} />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            )
          })}
          {canInvite ? <InvitationRows team={team} /> : null}
        </TableBody>
      </Table>
      <RemoveMemberDialog member={removing} onClose={() => setRemoving(null)} />
    </TableFrame>
  )
}

function InvitationRows({ team }: { team: Team }) {
  const invitations = team.useInvitations()
  const [revoking, setRevoking] = useState<string | null>(null)

  return invitations.map((invitation) => {
    const recipient = invitation.recipientEmail ?? "Unknown recipient"
    return (
      <TableRow key={invitation.id}>
        <TableCell>
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-8">
              <AvatarFallback>
                <span className="text-xs font-medium">
                  {recipient.slice(0, 1).toUpperCase()}
                </span>
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-muted-foreground">{recipient}</span>
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">
          Invited · expires {invitation.expiresAt.toLocaleDateString()}
        </TableCell>
        <TableCell className="text-right">
          <Button
            aria-label={`Revoke the invitation to ${recipient}`}
            disabled={revoking !== null}
            onClick={() => {
              setRevoking(invitation.id)
              void invitation
                .revoke()
                .then(() => toast.add({ title: `Invitation to ${recipient} revoked`, type: "success" }))
                .catch(() =>
                  toast.add({ title: "Could not revoke the invitation", type: "error" }),
                )
                .finally(() => setRevoking(null))
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} strokeWidth={2} />
          </Button>
        </TableCell>
      </TableRow>
    )
  })
}
