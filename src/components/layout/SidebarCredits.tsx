import { Coins01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { Skeleton } from "@/components/ui/skeleton"
import { useSidebar } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * "Credits · n remaining" — the one number the user sees (PLAN §6 layer 1).
 *
 * No refill date, no upgrade button, no price: there is one plan and no
 * billing surface, so the block states the balance and stops. Provider units
 * and provider names never reach this query.
 *
 * `null` from the balance query is NOT zero. Zero means the grant is spent;
 * `null` means the org never got one, which is a different sentence and
 * a different fix (PLAN §6 — no bucket, every paid call refuses).
 */
export function SidebarCredits({
  orgId,
}: {
  orgId: Id<"orgs"> | undefined
}) {
  const { state, isMobile } = useSidebar()
  const balance = useQuery(
    api.billing.credits.balance,
    orgId === undefined ? "skip" : { orgId },
  )
  const collapsed = state === "collapsed" && !isMobile

  // Before an org exists there is nothing to state — the block is absent
  // rather than showing a dash that reads as "none left".
  if (orgId === undefined) {
    return null
  }

  if (balance === undefined) {
    return collapsed ? (
      <Skeleton className="mx-auto size-8 rounded-lg" />
    ) : (
      <Skeleton className="h-14 w-full rounded-2xl" />
    )
  }

  if (collapsed) {
    const railLabel =
      balance === null ? "No credits granted" : `${balance.remaining} credits`
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              aria-label={railLabel}
              className="mx-auto flex flex-col items-center gap-0.5 text-muted-foreground"
            />
          }
        >
          <HugeiconsIcon icon={Coins01Icon} className="size-4" />
          <span aria-hidden="true" className="text-[11px] font-medium">
            {balance === null ? "—" : balance.remaining}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{railLabel}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="rounded-2xl border border-sidebar-border bg-sidebar-accent/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-eyebrow text-muted-foreground uppercase">
        <HugeiconsIcon icon={Coins01Icon} className="size-3.5" />
        Credits
      </div>
      {balance === null ? (
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          No credits granted yet. Finish setup and your trial credits appear
          here.
        </p>
      ) : (
        <p className="mt-1 text-sm text-foreground">
          <span className="text-xl font-semibold tracking-display">
            {balance.remaining}
          </span>{" "}
          <span className="text-xs text-muted-foreground">remaining</span>
        </p>
      )}
      {balance !== null && balance.pending > 0 ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {balance.pending} held by work in progress
        </p>
      ) : null}
    </div>
  )
}
