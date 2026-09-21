import {
  Logout03Icon,
  Moon02Icon,
  Settings02Icon,
  Sun03Icon,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  OrgSwitcherMenu,
  OrgSwitcherMenuSkeleton,
} from "@/components/layout/OrgSwitcherMenu"
import { useSidebar } from "@/components/ui/sidebar"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTheme } from "@/components/theme-provider"
import { Skeleton } from "@/components/ui/skeleton"
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

/** Only the account row waits on auth; the rest of the sidebar is static. */
export function SidebarUser() {
  return (
    <Suspense fallback={<SidebarUserSkeleton />}>
      <SidebarUserMenu />
    </Suspense>
  )
}

function SidebarUserSkeleton() {
  const { state, isMobile } = useSidebar()
  const collapsed = state === "collapsed" && !isMobile

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-2 py-1.5",
        collapsed && "justify-center p-1",
      )}
    >
      <Skeleton shape="full" className="size-6 shrink-0" />
      {collapsed ? null : <Skeleton shape="full" className="h-3.5 flex-1" />}
    </div>
  )
}

function SidebarUserMenu() {
  const navigate = useNavigate()
  const app = useHexclaveApp()
  const user = useUser({ or: "redirect" })
  const { theme, setTheme } = useTheme()
  const { state, isMobile } = useSidebar()
  const collapsed = state === "collapsed" && !isMobile
  const initials =
    getInitials(user.displayName) || getInitials(user.primaryEmail)

  const avatar = (size: "sm" | "default") => (
    <Avatar size={size}>
      {user.profileImageUrl ? (
        <AvatarImage alt={user.displayName ?? ""} src={user.profileImageUrl} />
      ) : null}
      <AvatarFallback>
        <span className="text-xs font-medium">{initials}</span>
      </AvatarFallback>
    </Avatar>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open account menu"
        render={
          <button
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left outline-hidden transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-sidebar-ring/40",
              collapsed && "justify-center p-1",
            )}
            type="button"
          />
        }
      >
        {avatar("sm")}
        {collapsed ? null : (
          <span className="min-w-0 flex-1 truncate text-sm text-sidebar-foreground">
            {user.primaryEmail ?? user.displayName}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <div className="flex items-center gap-2.5 px-2.5 py-2">
          {avatar("default")}
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
        {/* The suspending organization hook must not replace the whole shell while this menu opens. */}
        <Suspense fallback={<OrgSwitcherMenuSkeleton />}>
          <OrgSwitcherMenu user={user} />
        </Suspense>
        <DropdownMenuSeparator />
        <div className="flex min-h-7.5 items-center gap-2 px-2.5 py-0.5">
          <span className="flex items-center gap-2 text-sm [&_svg]:size-4">
            <HugeiconsIcon icon={Sun03Icon} />
            Theme
          </span>
          <Tabs
            className="ml-auto"
            onValueChange={(value) => setTheme(value as "light" | "dark")}
            value={theme}
          >
            <TabsList aria-label="Theme" className="h-6.5 justify-between">
              <TabsTrigger
                aria-label="Light mode"
                className="flex-none"
                size="sm"
                value="light"
              >
                <HugeiconsIcon icon={Sun03Icon} />
              </TabsTrigger>
              <TabsTrigger
                aria-label="Dark mode"
                className="flex-none"
                size="sm"
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
