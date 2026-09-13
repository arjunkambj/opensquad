import {
  Logout03Icon,
  Moon02Icon,
  Settings02Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useHexclaveApp } from "@hexclave/react"
import { useNavigate } from "@tanstack/react-router"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTheme } from "@/components/theme-provider"

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

export function UserProfileMenu({ user }: { user: ProfileUser }) {
  const navigate = useNavigate()
  const app = useHexclaveApp()
  const { theme, setTheme } = useTheme()
  const initials =
    getInitials(user.displayName) || getInitials(user.primaryEmail)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open user profile"
        render={<Button size="icon-lg" variant="ghost" />}
      >
        <Avatar className="size-8">
          {user.profileImageUrl ? (
            <AvatarImage
              alt={user.displayName ?? ""}
              src={user.profileImageUrl}
            />
          ) : null}
          <AvatarFallback className="text-xs font-medium">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Avatar className="size-9">
            {user.profileImageUrl ? (
              <AvatarImage
                alt={user.displayName ?? ""}
                src={user.profileImageUrl}
              />
            ) : null}
            <AvatarFallback className="text-sm font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
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
          <DropdownMenuItem onClick={() => void navigate({ to: "/settings" })}>
            <HugeiconsIcon icon={Settings02Icon} />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => void app.signOut()}
          >
            <HugeiconsIcon icon={Logout03Icon} />
            Logout
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
