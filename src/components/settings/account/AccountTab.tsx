import { Logout03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useHexclaveApp } from "@hexclave/react"
import { Link } from "@tanstack/react-router"
import { OrgResetCard } from "@/components/settings/account/OrgResetCard"
import type { ProfileUser } from "@/components/layout/SidebarUser"
import { DetailRow } from "@/components/kit/DetailRow"
import { PageSection } from "@/components/kit/PageSection"
import { Button } from "@/components/ui/button"

export function AccountTab({ user }: { user: ProfileUser }) {
  const app = useHexclaveApp()

  return (
    <div className="flex flex-col gap-6">
      <PageSection
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
      >
        <div className="flex flex-col gap-3">
          <DetailRow
            label="Email"
            value={user.primaryEmail ?? "No email on this account"}
          />
          <DetailRow
            label="Name"
            value={user.displayName ?? "No display name set"}
          />
        </div>
      </PageSection>

      <PageSection
        title="Sign out"
        description="Your agent keeps running after you sign out."
      >
        <div>
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
        </div>
      </PageSection>

      <OrgResetCard />
    </div>
  )
}
