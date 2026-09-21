import { Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "convex/react"
import type { CSSProperties, ReactNode } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

type Plan = {
  name: string
  price: string
  period: string
  description: string
  features: readonly string[]
}

const FREE_PLAN: Plan = {
  name: "Free",
  price: "$0",
  period: "to start",
  description: "Every organization starts here with a one-time credit grant.",
  features: [
    "Find, research and email leads",
    "Review mode with two approvals",
    "Unsubscribe and blocklist on every send",
  ],
}

const PAID_PLAN: Plan = {
  name: "Paid",
  price: "Soon",
  period: "per month",
  description: "For teams that run out of credits and want more.",
  features: [
    "Everything in Free",
    "More credits every month",
    "For higher sending volume",
  ],
}

/** Only the Free plan exists today; the paid plan is listed so the next step is visible, not purchasable. */
export function PlansTab({ orgId }: { orgId: Id<"orgs"> }) {
  const balance = useQuery(api.billing.credits.balance, { orgId })

  return (
    <PlansGrid
      credits={
        balance === undefined ? (
          <CreditsMeterSkeleton />
        ) : balance === null ? (
          <p className="text-sm text-muted-foreground">No credits granted yet.</p>
        ) : (
          <CreditsMeter granted={balance.granted} remaining={balance.remaining} />
        )
      }
    />
  )
}

/** The plans are static, so only the credit meter waits on data. */
export function PlansTabSkeleton() {
  return <PlansGrid credits={<CreditsMeterSkeleton />} />
}

function PlansGrid({ credits }: { credits: ReactNode }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <PlanCard
        plan={FREE_PLAN}
        badge={
          <span className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
            Current plan
          </span>
        }
        extra={credits}
      />
      <PlanCard
        plan={PAID_PLAN}
        action={
          <Button className="w-full" disabled type="button" variant="secondary">
            Coming soon
          </Button>
        }
      />
    </div>
  )
}

function CreditsMeterSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-5 items-center justify-between">
        <Skeleton shape="full" className="h-3.5 w-20" />
        <Skeleton shape="full" className="h-3.5 w-14" />
      </div>
      <Skeleton shape="full" className="h-1.5 w-full" />
    </div>
  )
}

function CreditsMeter({ granted, remaining }: { granted: number; remaining: number }) {
  const share = granted === 0 ? 0 : Math.min(100, Math.max(0, (remaining / granted) * 100))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">Credits left</span>
        <span className="font-medium tabular-nums text-foreground">
          {remaining.toLocaleString()} / {granted.toLocaleString()}
        </span>
      </div>
      <div
        aria-label="Credits left"
        aria-valuemax={granted}
        aria-valuemin={0}
        aria-valuenow={remaining}
        className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
        role="progressbar"
      >
        <div
          className="h-full w-(--credits-share) rounded-full bg-primary"
          style={{ "--credits-share": `${share}%` } as CSSProperties}
        />
      </div>
    </div>
  )
}

function PlanCard({
  plan,
  badge,
  extra,
  action,
}: {
  plan: Plan
  badge?: ReactNode
  extra?: ReactNode
  action?: ReactNode
}) {
  return (
    <Card className="h-full">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-muted-foreground">{plan.name}</span>
          {badge}
        </div>
        <div className="flex flex-col gap-1">
          <p className="flex items-baseline gap-1.5">
            <span className="font-display text-4xl font-semibold text-foreground">
              {plan.price}
            </span>
            <span className="text-sm text-muted-foreground">{plan.period}</span>
          </p>
          <CardDescription>{plan.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">
        <ul className="flex flex-col gap-2.5 border-t border-border pt-5 text-sm text-foreground">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5">
              <HugeiconsIcon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-primary"
                icon={Tick02Icon}
                strokeWidth={2}
              />
              {feature}
            </li>
          ))}
        </ul>
        {extra === undefined ? null : <div className="mt-auto">{extra}</div>}
      </CardContent>
      {action === undefined ? null : <CardFooter>{action}</CardFooter>}
    </Card>
  )
}
