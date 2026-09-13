import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { FormError, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { NativeSelect } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"

type Role = "owner" | "operator" | "viewer"

const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  operator: "Operator",
  viewer: "Viewer",
}

/** `iss|sub` identity key → readable member label (never a fake name). */
function memberLabel(identityKey: string): string {
  const subject = identityKey.split("|").pop() ?? identityKey
  return subject.length > 28 ? `${subject.slice(0, 25)}…` : subject
}

/**
 * Members and roles (owner-only writes). `setMemberRole`/`revokeMembership`
 * enforce last-owner protection server-side; CONFLICT errors are surfaced
 * inline. There is deliberately no invite flow — a verified invitation
 * mechanism is a later task, and no public join mutation exists.
 */
export function MembersSection({
  workspaceId,
  isOwner,
  selfMembershipId,
}: {
  workspaceId: Id<"workspaces">
  isOwner: boolean
  selfMembershipId: Id<"memberships">
}) {
  const members = useQuery(api.workspaces.listMembers, { workspaceId })
  const setMemberRole = useMutation(api.workspaces.setMemberRole)
  const revokeMembership = useMutation(api.workspaces.revokeMembership)

  const [pendingId, setPendingId] = useState<Id<"memberships"> | null>(null)
  const [confirmRevokeId, setConfirmRevokeId] =
    useState<Id<"memberships"> | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (members === undefined) {
    return <LoadingState title="Loading members" />
  }

  const changeRole = async (
    membership: Doc<"memberships">,
    role: Role,
  ) => {
    setPendingId(membership._id)
    setError(null)
    try {
      await setMemberRole({ workspaceId, membershipId: membership._id, role })
      toast.add({ title: "Role updated", type: "success" })
    } catch (cause) {
      setError(errorMessage(cause, "Could not change the role."))
    } finally {
      setPendingId(null)
    }
  }

  const revoke = async (membership: Doc<"memberships">) => {
    setPendingId(membership._id)
    setError(null)
    try {
      await revokeMembership({ workspaceId, membershipId: membership._id })
      setConfirmRevokeId(null)
      toast.add({ title: "Member removed", type: "success" })
    } catch (cause) {
      setError(errorMessage(cause, "Could not remove the member."))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members and roles</CardTitle>
        <CardDescription>
          Who can use this workspace. Owners manage members, operators edit
          campaigns and employees, viewers read. The last owner can never be
          demoted or removed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              {isOwner ? <TableHead className="text-right" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const isSelf = member._id === selfMembershipId
              const active = member.status === "active"
              const busy = pendingId === member._id
              return (
                <TableRow key={member._id}>
                  <TableCell>
                    <span
                      title={member.identityKey}
                      className="font-mono text-xs"
                    >
                      {memberLabel(member.identityKey)}
                    </span>
                    {isSelf ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (you)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {isOwner && active && !isSelf ? (
                      <NativeSelect
                        aria-label="Member role"
                        className="h-7 w-32"
                        disabled={busy}
                        value={member.role}
                        onChange={(event) =>
                          void changeRole(member, event.target.value as Role)
                        }
                      >
                        {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      ROLE_LABELS[member.role]
                    )}
                  </TableCell>
                  <TableCell>{active ? "Active" : "Revoked"}</TableCell>
                  {isOwner ? (
                    <TableCell className="text-right">
                      {active && !isSelf ? (
                        confirmRevokeId === member._id ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              Remove this member?
                            </span>
                            <Button
                              variant="destructive"
                              size="xs"
                              disabled={busy}
                              onClick={() => void revoke(member)}
                            >
                              {busy ? <Spinner data-icon="inline-start" /> : null}
                              Confirm
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={busy}
                              onClick={() => setConfirmRevokeId(null)}
                            >
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={busy}
                            onClick={() => setConfirmRevokeId(member._id)}
                          >
                            Revoke
                          </Button>
                        )
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <FormError message={error} />
        {isOwner ? (
          <p className="text-sm text-muted-foreground">
            Inviting new members needs a verified invitation flow — not
            available yet. Do not share sign-ins.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only the workspace owner can change roles or remove members.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
