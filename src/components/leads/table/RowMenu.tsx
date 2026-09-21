import {
  LinkSquare02Icon,
  Mail01Icon,
  MoreVerticalIcon,
  Target02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Hint } from "@/components/kit/Hint"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type RowMenuAction = {
  label: string
  disabledReason: string | null
  run: () => void
}

export function RowMenu({
  name,
  open,
  profileUrl,
  email,
  research,
  approve,
  reject,
}: {
  name: string
  open: () => void
  profileUrl?: string
  email: RowMenuAction
  research: RowMenuAction
  approve: RowMenuAction
  reject: RowMenuAction
}) {
  const items: { icon: typeof Mail01Icon; action: RowMenuAction }[] = [
    { icon: Mail01Icon, action: email },
    { icon: Target02Icon, action: research },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Actions for ${name}`}
            size="icon-sm"
            variant="muted"
          />
        }
      >
        <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={open}>
          <HugeiconsIcon icon={UserGroupIcon} strokeWidth={2} />
          Open details
        </DropdownMenuItem>
        {profileUrl === undefined ? null : (
          <DropdownMenuItem
            onClick={() => window.open(profileUrl, "_blank", "noopener")}
          >
            <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} />
            Open profile
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {items.map(({ icon, action }) => (
          <Hint key={action.label} content={action.disabledReason} side="left">
            <DropdownMenuItem
              disabled={action.disabledReason !== null}
              onClick={action.run}
            >
              <HugeiconsIcon icon={icon} strokeWidth={2} />
              {action.label}
            </DropdownMenuItem>
          </Hint>
        ))}
        <DropdownMenuSeparator />
        <Hint content={approve.disabledReason} side="left">
          <DropdownMenuItem
            disabled={approve.disabledReason !== null}
            onClick={approve.run}
          >
            {approve.label}
          </DropdownMenuItem>
        </Hint>
        <Hint content={reject.disabledReason} side="left">
          <DropdownMenuItem
            variant="destructive"
            disabled={reject.disabledReason !== null}
            onClick={reject.run}
          >
            {reject.label}
          </DropdownMenuItem>
        </Hint>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
