/** Integrations sits under the `_org` gate, so an organization with a finished setup is guaranteed here. */
import { Calendar03Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReactNode } from "react"
import { useRef, useState } from "react"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { OutreachDetailsForm } from "@/components/agent/OutreachDetailsForm"
import { followUpSummary } from "@/components/agent/agent-model"
import { AgentMailMark } from "@/components/integrations/AgentMailMark"
import { InboxConnection } from "@/components/inbox-connection/InboxConnection"
import { useInboxConnection } from "@/components/inbox-connection/use-inbox-connection"
import { Chip } from "@/components/kit/Chip"
import type { ChipVariant } from "@/components/kit/Chip"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { IntegrationsGridSkeleton } from "@/components/integrations/IntegrationsPageSkeleton"
import { SkeletonRegion } from "@/components/states/skeletons"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCurrentOrgId } from "@/hooks/use-current-org"

export function IntegrationsPage() {
  const orgId = useCurrentOrgId()

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Integrations"
        description="Services your agent uses."
      />
      {orgId === undefined ? (
        <SkeletonRegion label="Loading integrations">
          <IntegrationsGridSkeleton />
        </SkeletonRegion>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AgentMailIntegration orgId={orgId} />
          <MeetingsIntegration orgId={orgId} />
        </div>
      )}
    </div>
  )
}

/** One button opens the dialog; key, inbox, sync and disconnect all live there. */
function AgentMailIntegration({ orgId }: { orgId: Id<"orgs"> }) {
  const access = useInboxConnection(orgId)
  const [managing, setManaging] = useState(false)
  const popup = useRef<HTMLDivElement>(null)

  const view = access.state === "ready" ? access.view : undefined
  const connected = view?.connection === "connected"

  return (
    <>
      <IntegrationCard
        logo={<AgentMailMark className="size-5" />}
        name="AgentMail"
        site="agentmail.to"
        description="Sends outreach and receives replies."
        status={
          view === undefined
            ? undefined
            : view.connection === "connected"
              ? "connected"
              : view.connection === "invalid"
                ? "invalid"
                : "disconnected"
        }
        detail={
          view?.connection === "connected"
            ? view.inboxAddress
            : view?.connection === "invalid"
              ? "Key refused — reconnect to resume"
              : undefined
        }
        onAction={() => setManaging(true)}
      />

      <Dialog open={managing} onOpenChange={setManaging}>
        <DialogContent
          ref={popup}
          // Connected: focus the dialog itself so no action opens with a focus ring.
          // Otherwise the key field takes focus.
          initialFocus={connected ? popup : true}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>AgentMail</DialogTitle>
            <DialogDescription>
              {view?.connection === "none"
                ? "Paste your API key to connect."
                : view?.connection === "invalid"
                  ? "Reconnect to resume sending."
                  : "Sends outreach and receives replies."}
            </DialogDescription>
          </DialogHeader>
          <InboxConnection orgId={orgId} />
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The booking link and follow-up ladder every email is written with. */
function MeetingsIntegration({ orgId }: { orgId: Id<"orgs"> }) {
  const agent = useQuery(api.agents.queries.get, { orgId })
  const [editing, setEditing] = useState(false)
  const booking = agent?.bookingUrl

  return (
    <>
      <IntegrationCard
        logo={
          <HugeiconsIcon
            icon={Calendar03Icon}
            strokeWidth={2}
            className="size-5"
          />
        }
        name="Meetings & follow-ups"
        description="Booking link and follow-up timing."
        status={
          agent === undefined || agent === null
            ? undefined
            : booking === undefined
              ? "disconnected"
              : "connected"
        }
        statusLabel={{ connected: "Link set", disconnected: "No link" }}
        detail={
          agent === undefined || agent === null
            ? undefined
            : followUpSummary(agent.followUpDays)
        }
        actionLabel="Edit"
        onAction={() => setEditing(true)}
      />

      {agent === undefined || agent === null ? null : (
        <Dialog open={editing} onOpenChange={setEditing}>
          <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Meetings & follow-ups</DialogTitle>
              <DialogDescription>Booking link and follow-up timing.</DialogDescription>
            </DialogHeader>
            <OutreachDetailsForm agent={agent} />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

type IntegrationStatus = "connected" | "invalid" | "disconnected"

const STATUS_CHIP: Record<IntegrationStatus, { label: string; variant: ChipVariant }> = {
  connected: { label: "Connected", variant: "success" },
  invalid: { label: "Needs attention", variant: "destructive" },
  disconnected: { label: "Not connected", variant: "muted" },
}

function IntegrationCard({
  logo,
  name,
  site,
  description,
  status,
  statusLabel,
  detail,
  actionLabel,
  onAction,
}: {
  logo: ReactNode
  name: string
  /** The provider's site, for a third-party service. */
  site?: string
  description: string
  status: IntegrationStatus | undefined
  statusLabel?: Partial<Record<IntegrationStatus, string>>
  detail: string | undefined
  /** Overrides the Connect / Manage / Reconnect wording. */
  actionLabel?: string
  onAction: () => void
}) {
  const connected = status === "connected"
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-panel p-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
        >
          {logo}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {name}
            </h3>
            {status === undefined ? null : (
              <Chip variant={STATUS_CHIP[status].variant} className="shrink-0 px-2 py-0.5">
                {statusLabel?.[status] ?? STATUS_CHIP[status].label}
              </Chip>
            )}
          </div>
          {site === undefined ? null : (
            <a
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              href={`https://${site}`}
              rel="noreferrer"
              target="_blank"
            >
              {site}
              <HugeiconsIcon
                aria-hidden="true"
                className="size-3"
                icon={LinkSquare02Icon}
              />
            </a>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{description}</p>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {detail ?? (status === undefined ? "Checking…" : "Not set up yet")}
        </span>
        <Button
          className="shrink-0"
          size="sm"
          disabled={status === undefined}
          onClick={onAction}
          type="button"
          variant={connected || actionLabel !== undefined ? "outline" : "default"}
        >
          {actionLabel ??
            (connected ? "Manage" : status === "invalid" ? "Reconnect" : "Connect")}
        </Button>
      </div>
    </div>
  )
}
