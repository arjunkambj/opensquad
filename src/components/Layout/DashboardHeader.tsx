import {
  UserProfileMenu,
  type ProfileUser,
} from "@/components/Layout/UserProfileMenu"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function DashboardHeader({ user }: { user: ProfileUser }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 sm:px-6">
      <SidebarTrigger />
      <div className="ml-auto flex items-center justify-end">
        <UserProfileMenu user={user} />
      </div>
    </header>
  )
}
