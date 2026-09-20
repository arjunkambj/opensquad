/**
 * Settings → Account (reference 26, PLAN §2 — members, security, billing, API
 * and MCP are cut).
 *
 * The sign-in identity, presented AS identity. The email is the canonical row
 * (a membership's `identityKey` is `iss|sub`, never an email) and the display
 * name is a label, not a credential.
 *
 * Nothing here is an editable field: the auth provider owns profile edits
 * through its own handler, and a read-only input pretending otherwise is the
 * lie this card exists to avoid. The control goes where the change can
 * actually be made.
 */
import { Logout03Icon, UserCircleIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useHexclaveApp } from "@hexclave/react"
import { Link } from "@tanstack/react-router"
import { SectionHeaderCard } from "@/components/settings/SectionHeaderCard"
import type { ProfileUser } from "@/components/layout/SidebarUser"
import { DetailRow } from "@/components/shared/presentation"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function AccountTab({ user }: { user: ProfileUser }) {
  const app = useHexclaveApp()

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <SectionHeaderCard
        icon={UserCircleIcon}
        title="Account"
        description="Who you are signed in as. Your name and email are changed with your sign-in provider, not here."
        action={
          <Button
            render={
              <Link params={{ _splat: "account-settings" }} to="/handler/$" />
            }
            variant="outline"
          >
            Manage account
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3">
          <DetailRow
            label="Email"
            value={user.primaryEmail ?? "No email on this account"}
          />
          <DetailRow
            label="Name"
            value={user.displayName ?? "No display name set"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sign out</CardTitle>
          <CardDescription>
            Ends this session in this browser. Your agent keeps running on its
            own schedule — pause it in Sending if you want it to stop.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => void app.signOut()}
            type="button"
            variant="destructive"
          >
            <HugeiconsIcon
              aria-hidden="true"
              data-icon="inline-start"
              icon={Logout03Icon}
              strokeWidth={2}
            />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
