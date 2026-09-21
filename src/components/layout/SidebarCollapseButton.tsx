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
            size="icon"
            variant="muted"
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
