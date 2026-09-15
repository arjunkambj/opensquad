import { Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { MetaKbd } from "@/components/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MenuItem } from "@/constants/sidebar-menu"
import {
  sidebarCategories,
  sidebarFooterItems,
  sidebarMainItems,
} from "@/constants/sidebar-menu"
import Logo from "./Logo"

/**
 * Palette groups. The footer items fold into the LAST category rather than
 * opening a second group: the footer's only member is Settings, and a group of
 * its own was headed "Workspace" too — so the palette showed two identical
 * headings and React saw two children with the same key.
 */
const searchGroups: { heading: string | undefined; items: MenuItem[] }[] = [
  { heading: undefined, items: sidebarMainItems },
  ...sidebarCategories.map((category, index) => ({
    heading: category.name,
    items:
      index === sidebarCategories.length - 1
        ? [...category.items, ...sidebarFooterItems]
        : category.items,
  })),
]

const SEARCH_SHORTCUT = "k"

export function AppSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const navigate = useNavigate()
  const { setOpenMobile } = useSidebar()
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === SEARCH_SHORTCUT
      ) {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // Prefix match, so a nested route keeps its parent lit — `/overview` must
  // stay the active item while a mission detail is open under it. The
  // boundary check stops `/settings` matching a future `/settings-export`.
  const isActive = (item: MenuItem) =>
    pathname === item.href || pathname.startsWith(`${item.href}/`)

  const goTo = (href: MenuItem["href"]) => {
    setSearchOpen(false)
    setOpenMobile(false)
    void navigate({ to: href })
  }

  const renderItems = (items: MenuItem[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.name}>
        <SidebarMenuButton
          isActive={isActive(item)}
          aria-current={isActive(item) ? "page" : undefined}
          onClick={() => setOpenMobile(false)}
          render={<Link to={item.href} />}
          tooltip={item.name}
        >
          <HugeiconsIcon icon={item.icon} />
          <span>{item.name}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ))

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="group-data-[collapsible=icon]:items-center">
        <Link
          aria-label="OpenSquad"
          className="flex items-center px-1 py-1 group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
          to="/overview"
          onClick={() => setOpenMobile(false)}
        >
          <Logo markOnly markClassName="size-7" />
        </Link>
        <Button
          variant="secondary"
          aria-haspopup="dialog"
          aria-expanded={searchOpen}
          className="w-full min-w-0 justify-start group-data-[collapsible=icon]:hidden"
          onClick={() => setSearchOpen(true)}
        >
          <HugeiconsIcon icon={Search01Icon} data-icon="inline-start" />
          Search
          <span className="ml-auto">
            <MetaKbd shortcut={SEARCH_SHORTCUT} />
          </span>
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Search"
                className="hidden group-data-[collapsible=icon]:flex"
                size="icon-lg"
                variant="ghost"
                onClick={() => setSearchOpen(true)}
              />
            }
          >
            <HugeiconsIcon icon={Search01Icon} />
          </TooltipTrigger>
          <TooltipContent side="right">
            Search
            <MetaKbd shortcut={SEARCH_SHORTCUT} />
          </TooltipContent>
        </Tooltip>
      </SidebarHeader>

      <CommandDialog
        description="Jump to a page in OpenSquad."
        open={searchOpen}
        title="Search"
        onOpenChange={setSearchOpen}
      >
        <Command>
          <CommandInput aria-label="Search pages" placeholder="Search" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            {searchGroups.map((group) => (
              <CommandGroup
                heading={group.heading}
                key={group.heading ?? "main"}
              >
                {group.items.map((item) => (
                  <CommandItem
                    key={item.href}
                    value={`${item.name} ${group.heading ?? ""}`}
                    onSelect={() => goTo(item.href)}
                  >
                    <HugeiconsIcon icon={item.icon} />
                    {item.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(sidebarMainItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {sidebarCategories.map((category) => (
          <SidebarGroup key={category.name}>
            <SidebarGroupLabel>{category.name}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(category.items)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>{renderItems(sidebarFooterItems)}</SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
