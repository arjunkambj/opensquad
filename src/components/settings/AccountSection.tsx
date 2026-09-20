import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { ProfileUser } from "@/components/Layout/UserProfileMenu"
import { DetailRow } from "@/components/shared/presentation"

/**
 * The sign-in identity, presented AS identity — the email is the canonical
 * row (a workspace member's `identityKey` is `iss|sub`, never an email), and
 * the display name is a label, not a credential.
 *
 * Nothing here is an editable field. Hexclave owns profile edits through its
 * own handler (`/handler/*`), and a read-only input pretending otherwise is
 * the lie this card was rewritten to remove: the control goes where the
 * change can actually be made.
 */
export function AccountSection({ user }: { user: ProfileUser }) {
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>
          Your sign-in identity, managed by Hexclave — changed there, not
          here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <DetailRow
          label="Email"
          value={user.primaryEmail ?? "No email on this account"}
        />
        <DetailRow
          label="Name"
          value={user.displayName ?? "No display name set"}
        />
        <div>
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                to="/handler/$"
                params={{ _splat: "account-settings" }}
              />
            }
          >
            Manage account
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
