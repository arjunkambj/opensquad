import { HugeiconsIcon } from "@hugeicons/react"
import { Link, useRouterState } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import type { ReactNode } from "react"
import { api } from "../../../convex/_generated/api"
import { SidebarCollapseButton } from "@/components/layout/SidebarCollapseButton"
import { SidebarUser } from "@/components/layout/SidebarUser"
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
import {
  sidebarFooterItems,
  sidebarOverviewItem,
  sidebarSections,
} from "@/constants/sidebar-menu"
import { useCurrentOrgId } from "@/hooks/use-current-org"
import { useInboxAttention } from "@/hooks/use-inbox-attention"
import { boundedCount } from "@/lib/bounded-count"

/**
 * The app's one navigation surface (reference 20 expanded, 24 collapsed):
 * logo and collapse control at the top, Overview above the labelled
 * sections, then Team, Integrations, Billing and Settings above the user
 * block at the bottom.
 *
 * Nothing here is decoration: every row leads to a page that works, and both
 * numbers on it — the inbox count and the credit balance — come from a query
 * over real records.
 */
export function AppSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { setOpenMobile } = useSidebar()

  // The nav lives outside the `_org` gate too — `/settings` and
  // `/onboarding` are deliberately reachable without a finished setup — so a
  // missing org skips the query and renders no badge at all, rather
  // than a zero that would claim the queue is empty.
  const orgId = useCurrentOrgId()
  // The same call the inbox attention surfaces make, with byte-identical
  // arguments, so Convex serves one subscription and the two numbers cannot
  // disagree.
  const inboxAttention = useInboxAttention(orgId)
  const credits = useQuery(
    api.billing.credits.balance,
    orgId === undefined ? "skip" : { orgId },
  )

  // Prefix match, so a nested route keeps its parent lit. The boundary check
  // stops `/settings` matching a future `/settings-export`.
  const isActive = (item: MenuItem) =>
    pathname === item.href || pathname.startsWith(`${item.href}/`)

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="gap-3 px-2.5 pt-2 pb-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2">
          <Link
            aria-label="OpenIntent"
            className="mr-auto flex min-w-0 items-center group-data-[collapsible=icon]:mr-0"
            to="/overview"
            onClick={() => setOpenMobile(false)}
          >
            <Logo
              markClassName="size-6"
              className="group-data-[collapsible=icon]:gap-0"
              labelClassName="group-data-[collapsible=icon]:hidden"
            />
          </Link>
          <SidebarCollapseButton />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        <SidebarGroup className="px-1 py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem
                item={sidebarOverviewItem}
                active={isActive(sidebarOverviewItem)}
                onNavigate={() => setOpenMobile(false)}
                badge={null}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {sidebarSections.map((section) => (
          <SidebarGroup key={section.label} className="px-1 py-1">
            <p className="px-2.5 pt-3 pb-1.5 text-2xs font-normal tracking-wide text-muted-foreground/70 uppercase group-data-[collapsible=icon]:hidden">
              {section.label}
            </p>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <NavItem
                    key={item.name}
                    item={item}
                    active={isActive(item)}
                    onNavigate={() => setOpenMobile(false)}
                    badge={
                      item.href === "/inbox" && inboxAttention !== undefined ? (
                        <>
                          {boundedCount(
                            inboxAttention.needsAttention,
                            inboxAttention.needsAttentionHasMore,
                          )}
                          <span className="sr-only"> threads need attention</span>
                        </>
                      ) : null
                    }
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="gap-0 px-1 pb-1">
        <div className="py-2">
          <SidebarMenu>
            {sidebarFooterItems.map((item) => (
              <NavItem
                key={item.name}
                item={item}
                active={isActive(item)}
                onNavigate={() => setOpenMobile(false)}
                badge={
                  item.href === "/billing" &&
                  credits !== undefined &&
                  credits !== null ? (
                    <>
                      {credits.remaining}
                      <span className="sr-only"> credits remaining</span>
                    </>
                  ) : null
                }
              />
            ))}
          </SidebarMenu>
        </div>
        <div className="mx-2.5 h-px bg-sidebar-border/60" />
        <div className="pt-2">
          <SidebarUser />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function NavItem({
  item,
  active,
  onNavigate,
  badge,
}: {
  item: MenuItem
  active: boolean
  onNavigate: () => void
  badge: ReactNode
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        render={<Link to={item.href} />}
        tooltip={item.name}
      >
        <HugeiconsIcon icon={item.icon} />
        <span>{item.name}</span>
      </SidebarMenuButton>
      {/* A generic div ignores aria-label; keep the badge description in the DOM. */}
      {badge === null ? null : <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  )
}
