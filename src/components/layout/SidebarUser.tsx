import {
  Logout03Icon,
  Moon02Icon,
  Settings02Icon,
  Sun03Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useHexclaveApp, useUser } from "@hexclave/react"
import { useNavigate } from "@tanstack/react-router"
import { Suspense } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { OrgSwitcherMenu } from "@/components/layout/OrgSwitcherMenu"
import { useSidebar } from "@/components/ui/sidebar"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

export type ProfileUser = {
  displayName: string | null
  primaryEmail: string | null
  profileImageUrl: string | null
}

const getInitials = (value: string | null) =>
  value
    ?.split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")

export function SidebarUser({ user }: { user: ProfileUser }) {
  const navigate = useNavigate()
  const app = useHexclaveApp()
  // The account in the auth provider, which owns the organizations this
  // switches between. `user` above is the display copy the shell passes down.
  const account = useUser()
  const { theme, setTheme } = useTheme()
  const { state, isMobile } = useSidebar()
  const collapsed = state === "collapsed" && !isMobile
  const initials =
    getInitials(user.displayName) || getInitials(user.primaryEmail)

  const avatar = (
    <Avatar className="size-8">
      {user.profileImageUrl ? (
        <AvatarImage alt={user.displayName ?? ""} src={user.profileImageUrl} />
      ) : null}
      <AvatarFallback className="text-xs font-medium">
        {initials}
      </AvatarFallback>
    </Avatar>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open account menu"
        className={cn(
          "flex w-full items-center gap-2 rounded-2xl p-1.5 text-left outline-hidden transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-sidebar-ring/40",
          collapsed && "justify-center p-1",
        )}
      >
        {avatar}
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              {user.displayName ? (
                <span className="block truncate text-sm font-medium text-sidebar-foreground">
                  {user.displayName}
                </span>
              ) : null}
              {user.primaryEmail ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {user.primaryEmail}
                </span>
              ) : null}
            </span>
            <HugeiconsIcon
              icon={UnfoldMoreIcon}
              className="size-4 shrink-0 text-muted-foreground"
            />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <div className="flex items-center gap-2 px-2 py-1.5">
          {avatar}
          <div className="min-w-0">
            {user.displayName ? (
              <div className="truncate text-sm font-semibold">
                {user.displayName}
              </div>
            ) : null}
            {user.primaryEmail ? (
              <div className="truncate text-xs text-muted-foreground">
                {user.primaryEmail}
              </div>
            ) : null}
          </div>
        </div>
        <DropdownMenuSeparator />
        {account === null ? null : (
          <>
            {/* The suspending organization hook must not replace the whole shell while this menu opens. */}
            <Suspense
              fallback={<DropdownMenuLabel>Organization</DropdownMenuLabel>}
            >
              <OrgSwitcherMenu user={account} />
            </Suspense>
            <DropdownMenuSeparator />
          </>
        )}
        <div className="flex items-center gap-2 px-2 py-1">
          <span className="flex items-center gap-2 text-sm [&_svg]:size-4">
            <HugeiconsIcon icon={Sun03Icon} />
            Theme
          </span>
          <Tabs
            className="ml-auto"
            onValueChange={(value) => setTheme(value as "light" | "dark")}
            value={theme}
          >
            <TabsList aria-label="Theme" className="h-7 justify-between">
              <TabsTrigger
                aria-label="Light mode"
                className="flex-none px-1.5"
                title="Light mode"
                value="light"
              >
                <HugeiconsIcon icon={Sun03Icon} />
              </TabsTrigger>
              <TabsTrigger
                aria-label="Dark mode"
                className="flex-none px-1.5"
                title="Dark mode"
                value="dark"
              >
                <HugeiconsIcon icon={Moon02Icon} />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() =>
              void navigate({ to: "/settings", search: { tab: "account" } })
            }
          >
            <HugeiconsIcon icon={Settings02Icon} />
            Account settings
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => void app.signOut()}
          >
            <HugeiconsIcon icon={Logout03Icon} />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
