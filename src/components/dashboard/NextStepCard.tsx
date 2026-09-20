/**
 * The "Ready to outreach?" card of reference 20, made state-aware.
 *
 * The reference offers one fixed call to action. Ours offers the step the
 * workspace is actually on — finish setup, connect the inbox, choose how the
 * agent sends, approve what is waiting, hand it the wheel, or nothing at all
 * — decided on the server from real rows (`dashboard.queries.nextStep`) and
 * only put into words here.
 *
 * Presentational: it renders the state it is handed and owns no query.
 */
import { Link } from "@tanstack/react-router"
import type { FunctionReturnType } from "convex/server"
import type { ReactNode } from "react"
import type { api } from "../../../convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { boundedCount } from "@/lib/bounded-count"

export type NextStep = FunctionReturnType<typeof api.dashboard.queries.nextStep>

export function NextStepCard({ next }: { next: NextStep | undefined }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card px-6 py-8 text-center">
      {next === undefined ? (
        <>
          <Skeleton className="h-5 w-40 rounded-xl bg-foreground/10" />
          <Skeleton className="h-9 w-36 rounded-2xl bg-foreground/10" />
        </>
      ) : (
        <NextStepBody next={next} />
      )}
    </div>
  )
}

function NextStepBody({ next }: { next: NextStep }) {
  switch (next.kind) {
    case "finish_setup":
      return (
        <Prompt
          title="Finish setting up your agent"
          description="It needs your company and the people you want to reach before it can start."
          action={
            <Button render={<Link to="/onboarding" />} size="cta">
              Finish setup
            </Button>
          }
        />
      )
    case "connect_inbox":
      return (
        <Prompt
          title="Ready to reach out?"
          description={
            next.inboxConnection === "invalid"
              ? "Your inbox key stopped working, so nothing can go out. Reconnect it to resume sending."
              : next.inboxConnection === "legacy_platform_inbox"
                ? "This organization can receive mail but not send it. Connect your own inbox to start outreach."
                : "Connect the inbox your agent will send from. Until then it finds and researches leads and contacts nobody."
          }
          action={
            <Button
              render={<Link to="/settings" search={{ tab: "inbox" }} />}
              size="cta"
            >
              Connect your inbox
            </Button>
          }
        />
      )
    case "start_sending":
      return (
        <Prompt
          title={
            next.mode === "paused"
              ? "Your agent is paused"
              : "Ready to reach out?"
          }
          description={
            next.mode === "paused"
              ? "Nothing is being sent while it is paused. Pick a sending mode to start it again."
              : "Your inbox is connected and your agent is only sourcing leads. Choose how it should send."
          }
          action={
            <Button render={<Link to="/agent" />} size="cta">
              Choose a sending mode
            </Button>
          }
        />
      )
    case "approve_leads":
      return (
        <Prompt
          title={`${boundedCount(next.pending.count, next.pending.hasMore)} lead${next.pending.count === 1 ? "" : "s"} waiting for you`}
          description="Your agent found these and is holding them until you say yes."
          action={
            <Button
              render={<Link to="/contacts" search={{ approval: "pending" }} />}
              size="cta"
            >
              Review leads
            </Button>
          }
        />
      )
    case "enable_autopilot":
      return (
        <Prompt
          title="Let your agent send on its own"
          description="Every email waits for your approval today. Autopilot sends the ones that clear your score, and you can turn it off at any time."
          action={
            <Button render={<Link to="/agent" />} size="cta" variant="outline">
              Set up autopilot
            </Button>
          }
        />
      )
    case "all_set":
      return (
        <Prompt
          title="Your agent is running"
          description="It is sourcing, writing and sending on its own. Anything that needs you shows up here."
          action={
            <Button render={<Link to="/agent" />} size="cta" variant="outline">
              Open your agent
            </Button>
          }
        />
      )
  }
}

function Prompt({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action: ReactNode
}) {
  return (
    <>
      <p className="font-heading text-base font-semibold text-foreground">
        {title}
      </p>
      <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      <div className="mt-1">{action}</div>
    </>
  )
}
