import {
  SidebarLeft01Icon,
  SidebarRight01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * The collapse control of reference 20, which becomes the expand control on
 * the icon rail of reference 24.
 *
 * Desktop only: at phone width the sidebar is a sheet, and collapsing a sheet
 * to a rail is meaningless — the header's trigger opens and closes it there.
 */
export function SidebarCollapseButton() {
  const { state, toggleSidebar, isMobile } = useSidebar()

  if (isMobile) {
    return null
  }

  const collapsed = state === "collapsed"
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar"

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className="text-muted-foreground"
            size="icon"
            variant="ghost"
            onClick={toggleSidebar}
          />
        }
      >
        <HugeiconsIcon
          icon={collapsed ? SidebarRight01Icon : SidebarLeft01Icon}
        />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
