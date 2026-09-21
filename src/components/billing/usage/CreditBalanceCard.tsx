/**
 * The credit balance as one reading: what is left, out of what was granted,
 * with a bar that splits the grant into spent, held and left.
 *
 * Held credits are reserved by steps still running; they come back if the
 * step does not charge, so they sit between spent and left rather than in
 * either.
 */
import { ArrowRight01Icon, Coins01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import type { CSSProperties } from "react"
import { FramedPanel } from "@/components/kit/FramedPanel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type Balance = { granted: number; remaining: number; pending: number }

export function CreditBalanceCard({ balance }: { balance: Balance | undefined }) {
  const granted = balance?.granted ?? 0
  const remaining = balance?.remaining ?? 0
  const pending = balance?.pending ?? 0
  const spent = Math.max(0, granted - remaining - pending)
  const share = (part: number) => (granted > 0 ? (part / granted) * 100 : 0)

  const segments = [
    { key: "spent", label: "Spent", value: spent, tone: "bg-foreground" },
    { key: "held", label: "Held", value: pending, tone: "bg-illustration-accent" },
    { key: "left", label: "Left", value: remaining, tone: "bg-muted-foreground/25" },
  ]

  return (
    <FramedPanel
      title="Credits"
      icon={Coins01Icon}
      action={
        <Button
          variant="ghost"
          size="xs"
          render={<Link to="/billing" search={{ tab: "plans" }} />}
        >
          Get more
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            data-icon="inline-end"
            aria-hidden="true"
          />
        </Button>
      }
      bodyClassName="gap-4"
    >
      {balance === undefined ? (
        <>
          <div className="flex items-end gap-2">
            <Skeleton shape="xl" className="h-9 w-24" />
            <Skeleton shape="full" className="mb-0.5 h-3.5 w-36" />
          </div>
          <Skeleton shape="full" className="h-2 w-full" />
          <div className="grid grid-cols-3 gap-4">
            {segments.map((segment) => (
              <div key={segment.key} className="flex flex-col gap-1">
                <div className="flex h-4 items-center">
                  <Skeleton shape="full" className="h-3 w-12" />
                </div>
                <div className="flex h-5 items-center">
                  <Skeleton shape="full" className="h-3.5 w-10" />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="flex items-baseline gap-2">
            <span className="font-display text-4xl leading-none font-semibold tracking-tight text-foreground tabular-nums">
              {remaining.toLocaleString()}
            </span>
            <span className="text-sm text-muted-foreground">
              of {granted.toLocaleString()} credits left
            </span>
          </p>

          <div
            role="img"
            aria-label={`${spent} spent, ${pending} held, ${remaining} left of ${granted}`}
            className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
          >
            {segments.map((segment) =>
              segment.value > 0 ? (
                <span
                  key={segment.key}
                  className={cn(
                    "h-full w-(--share) first:rounded-l-full last:rounded-r-full",
                    segment.tone,
                  )}
                  style={{ "--share": `${share(segment.value)}%` } as CSSProperties}
                />
              ) : null,
            )}
          </div>

          <dl className="grid grid-cols-3 gap-4">
            {segments.map((segment) => (
              <div key={segment.key} className="flex flex-col gap-1">
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={cn("size-2 rounded-full", segment.tone)}
                  />
                  {segment.label}
                </dt>
                <dd className="text-sm font-medium text-foreground tabular-nums">
                  {segment.value.toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </FramedPanel>
  )
}
