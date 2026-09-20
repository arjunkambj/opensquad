import { HugeiconsIcon } from "@hugeicons/react"
import { Link, useRouterState } from "@tanstack/react-router"
import { NotificationsBell } from "@/components/layout/NotificationsBell"
import { SidebarCollapseButton } from "@/components/layout/SidebarCollapseButton"
import { SidebarCredits } from "@/components/layout/SidebarCredits"
import { SidebarUser } from "@/components/layout/SidebarUser"
import type { ProfileUser } from "@/components/layout/SidebarUser"
import Logo from "@/components/layout/Logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import type { MenuItem } from "@/constants/sidebar-menu"
import { sidebarMainItems } from "@/constants/sidebar-menu"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { useInboxAttention } from "@/hooks/use-inbox-attention"
import { boundedCount } from "@/lib/bounded-count"

/**
 * The app's one navigation surface (reference 20 expanded, 24 collapsed):
 * logo, bell and collapse control at the top, the five pages, then the
 * credits block and the user block at the bottom.
 *
 * Nothing here is decoration: every row leads to a page that works, and both
 * numbers on it — the inbox count and the credit balance — come from a query
 * over real records.
 */
export function AppSidebar({ user }: { user: ProfileUser }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { setOpenMobile } = useSidebar()

  // The nav lives outside the `_workspace` gate too — `/settings` and
  // `/onboarding` are deliberately reachable without a finished setup — so a
  // missing workspace skips the query and renders no badge at all, rather
  // than a zero that would claim the queue is empty.
  const current = useCurrentWorkspace()
  const workspaceId =
    current !== undefined && current !== null
      ? current.workspace._id
      : undefined
  // The same call the inbox attention surfaces make, with byte-identical
  // arguments, so Convex serves one subscription and the two numbers cannot
  // disagree.
  const inboxAttention = useInboxAttention(workspaceId)

  // Prefix match, so a nested route keeps its parent lit. The boundary check
  // stops `/settings` matching a future `/settings-export`.
  const isActive = (item: MenuItem) =>
    pathname === item.href || pathname.startsWith(`${item.href}/`)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-3 py-4 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2">
        {/* One row when expanded; the rail of reference 24 stacks the same
            three controls instead, because 3rem cannot hold them side by
            side. */}
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2">
          <Link
            aria-label="OpenIntent"
            className="mr-auto flex min-w-0 items-center group-data-[collapsible=icon]:mr-0"
            to="/dashboard"
            onClick={() => setOpenMobile(false)}
          >
            <Logo
              markClassName="size-8"
              className="group-data-[collapsible=icon]:gap-0"
              labelClassName="group-data-[collapsible=icon]:hidden"
            />
          </Link>
          <NotificationsBell workspaceId={workspaceId} />
          <SidebarCollapseButton />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-3 group-data-[collapsible=icon]:px-2">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {sidebarMainItems.map((item) => {
                const active = isActive(item)
                return (
                  <SidebarMenuItem key={item.name} className="relative">
                    {/* The left accent bar of reference 20. It is drawn
                        beside the pill rather than inside it so the collapsed
                        rail keeps the same mark at the same x position. */}
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1.5 -left-3 w-1 rounded-r-full bg-sidebar-primary group-data-[collapsible=icon]:-left-2"
                      />
                    ) : null}
                    <SidebarMenuButton
                      isActive={active}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpenMobile(false)}
                      render={<Link to={item.href} />}
                      tooltip={item.name}
                    >
                      <HugeiconsIcon icon={item.icon} />
                      <span>{item.name}</span>
                    </SidebarMenuButton>
                    {/* The wording is in the DOM, not in an attribute:
                        `SidebarMenuBadge` is a bare `<div>` with no role, and
                        ARIA does not name a generic element, so an
                        `aria-label` there reaches a screen reader as a bare
                        number stripped of what it counts. */}
                    {item.href === "/inbox" && inboxAttention !== undefined ? (
                      <SidebarMenuBadge>
                        {/* `attentionCounts` caps at MAX_LIST_LIMIT — render
                            the bounded form, never an exact-looking "50" that
                            is really "50+". */}
                        {boundedCount(
                          inboxAttention.needsAttention,
                          inboxAttention.needsAttentionHasMore,
                        )}
                        <span className="sr-only"> threads need attention</span>
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-3 px-3 pb-4 group-data-[collapsible=icon]:px-2">
        <SidebarCredits workspaceId={workspaceId} />
        <SidebarUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
