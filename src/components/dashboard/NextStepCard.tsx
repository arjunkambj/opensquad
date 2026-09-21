import { Navigation03Icon } from "@hugeicons/core-free-icons"
import { Link } from "@tanstack/react-router"
import type { FunctionReturnType } from "convex/server"
import type { ReactNode } from "react"
import type { api } from "../../../convex/_generated/api"
import { FramedPanel } from "@/components/kit/FramedPanel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { boundedCount } from "@/lib/bounded-count"

export type NextStep = FunctionReturnType<typeof api.dashboard.queries.nextStep>

export function NextStepCard({ next }: { next: NextStep | undefined }) {
  return (
    <FramedPanel
      as="div"
      icon={Navigation03Icon}
      title="Next step"
      className="h-full"
      bodyClassName="items-start justify-center gap-3"
    >
      {next === undefined ? (
        <>
          <div className="flex h-6 items-center">
            <Skeleton shape="full" className="h-4 w-48" />
          </div>
          <div className="flex w-full flex-col gap-2 py-1">
            <Skeleton shape="full" className="h-3.5 w-full" />
            <Skeleton shape="full" className="h-3.5 w-3/5" />
          </div>
          <Skeleton shape="xl" className="mt-1 h-8 w-36" />
        </>
      ) : (
        <NextStepBody next={next} />
      )}
    </FramedPanel>
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
            <Button render={<Link to="/onboarding" />}>
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
              : "Connect the inbox your agent will send from. Until then it finds and researches leads and contacts nobody."
          }
          action={
            <Button render={<Link to="/integrations" />}>
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
            <Button render={<Link to="/autopilot" />}>
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
            <Button render={<Link to="/leads" search={{ approval: "pending" }} />}>
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
            <Button render={<Link to="/autopilot" />} variant="outline">
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
            <Button render={<Link to="/autopilot" />} variant="outline">
              Open autopilot
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
      <p className="text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      <div className="mt-1">{action}</div>
    </>
  )
}
