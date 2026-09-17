import {
  Link,
  useNavigate,
  useSearch,
} from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { BookingPanel } from "@/components/bookings/BookingPanel"
import {
  Chip,
  formatInstant,
  formatWaited,
} from "@/components/decisions/decision-presentation"
import { LeadActivity } from "@/components/leads/LeadActivity"
import { LeadConversations } from "@/components/leads/LeadConversations"
import { LeadEvidence } from "@/components/leads/LeadEvidence"
import { LeadOverview } from "@/components/leads/LeadOverview"
import {
  QualificationChip,
  StageChip,
  memberLabel,
} from "@/components/leads/leads-presentation"
import { LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { useEscapeToParent } from "@/hooks/use-queue-navigation"
import { canEdit } from "@/lib/workspace-role"
import { cn } from "@/lib/utils"
import type { LeadTabId } from "@/routes/_dashboard/_workspace/leads"

const LEADS_ROUTE = "/_dashboard/_workspace/leads"

const LEAD_TABS: { id: LeadTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "evidence", label: "Evidence" },
  { id: "activity", label: "Activity" },
  { id: "conversation", label: "Conversation" },
  { id: "booking", label: "Booking" },
]

/**
 * `/leads/$prospectId` — one lead, five sections, one URL contract shared
 * with the list (`?tab=` picks the section; every list param survives a Back
 * to `/leads`).
 *
 * **Version pinning** — the detail shows the version the operator first
 * READ, not whatever the subscription last delivered. Every write below
 * supplies `seenVersion` as its `expectedVersion`, so a colleague's change
 * between open and submit conflicts rather than silently landing on top.
 * When the live row moves past the pinned version a banner names it and
 * offers two explicit actions — never a silent re-pin (J7):
 *
 * - "Keep my answers and use the newer version" re-pins only — the typed
 *   form content is component state and survives.
 * - "Discard my answers" re-pins AND remounts the forms through `formEpoch`,
 *   so nothing typed against the old version is still in the fields.
 */
export function LeadDetail({ prospectId }: { prospectId: string }) {
  const current = useCurrentWorkspace()
  useEscapeToParent("/leads")
  const search = useSearch({ from: LEADS_ROUTE })
  const navigate = useNavigate()

  const workspaceId =
    current !== undefined && current !== null ? current.workspace._id : undefined

  const detail = useQuery(
    api.prospects.getDetail,
    workspaceId === undefined
      ? "skip"
      : { workspaceId, prospectId: prospectId as Id<"prospects"> },
  )
  // The campaign context is a second bounded read — `getDetail` returns the
  // lead, evidence, events and bookings, and the campaign is fetched by its
  // id so the header can name it.
  const campaign = useQuery(
    api.campaigns.get,
    workspaceId === undefined || detail === undefined
      ? "skip"
      : { workspaceId, campaignId: detail.prospect.campaignId },
  )

  const [seenVersion, setSeenVersion] = useState<number | null>(null)
  const [formEpoch, setFormEpoch] = useState(0)
  if (detail !== undefined && seenVersion === null) {
    setSeenVersion(detail.prospect.version)
  }
  const pinnedVersion = seenVersion ?? detail?.prospect.version ?? 0
  const stale =
    detail !== undefined &&
    seenVersion !== null &&
    detail.prospect.version !== seenVersion

  if (current === undefined || current === null || detail === undefined) {
    return (
      <LoadingState
        title="Loading the lead"
        description="Reading this lead, its campaign and its bookings."
      />
    )
  }

  const mayEdit = canEdit(current.role)
  const prospect = detail.prospect
  const tab = search.tab ?? "overview"

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        {/* The list context the row link carried in survives this return —
            `tab` is stripped because it names a section of THIS page. */}
        <Link
          to="/leads"
          search={(previous) => ({ ...previous, tab: undefined })}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Back to leads
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StageChip stage={prospect.salesStage} />
          <QualificationChip qualification={prospect.qualification} />
          {prospect.salesStage === "lost" || prospect.salesStage === "won" ? (
            <Chip className="bg-chart-1/15 text-chart-1">
              {prospect.salesStage === "won" ? "Closed — won" : "Closed — lost"}
            </Chip>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold leading-tight">
          {prospect.companyName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {prospect.canonicalDomain} · {campaign?.title ?? "its campaign"} ·
          owned by {memberLabel(prospect.ownerIdentityKey)} · updated{" "}
          {formatWaited(prospect.updatedAt)}
          {prospect.lastContactedAt !== undefined
            ? ` · last mailed ${formatInstant(prospect.lastContactedAt, current.workspace.timezone)}`
            : ""}
          {prospect.lastReplyAt !== undefined
            ? ` · last reply ${formatInstant(prospect.lastReplyAt, current.workspace.timezone)}`
            : ""}
        </p>
      </header>

      {stale ? (
        <StaleLeadBanner
          live={prospect.version}
          seen={pinnedVersion}
          onKeep={() => setSeenVersion(prospect.version)}
          onDiscard={() => {
            setSeenVersion(prospect.version)
            setFormEpoch((epoch) => epoch + 1)
          }}
        />
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({
            to: "/leads/$prospectId",
            params: { prospectId },
            search: (previous) => ({
              ...previous,
              tab: value === "overview" ? undefined : (value as LeadTabId),
            }),
            replace: true,
          })
        }
      >
        <TabsList className="flex-wrap">
          {LEAD_TABS.map(({ id, label }) => (
            <TabsTrigger key={id} value={id}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <LeadOverview
            key={`overview:${formEpoch}`}
            workspaceId={current.workspace._id}
            detail={detail}
            campaign={campaign}
            expectedVersion={pinnedVersion}
            canEdit={mayEdit}
            stale={stale}
            timezone={current.workspace.timezone}
          />
        </TabsContent>
        <TabsContent value="evidence" className="mt-4">
          <LeadEvidence
            workspaceId={current.workspace._id}
            prospect={prospect}
            timezone={current.workspace.timezone}
          />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <LeadActivity
            workspaceId={current.workspace._id}
            prospectId={prospect._id}
            timezone={current.workspace.timezone}
          />
        </TabsContent>
        <TabsContent value="conversation" className="mt-4">
          <LeadConversations
            workspaceId={current.workspace._id}
            prospectId={prospect._id}
          />
        </TabsContent>
        <TabsContent value="booking" className="mt-4">
          <BookingPanel
            key={`booking:${formEpoch}`}
            workspaceId={current.workspace._id}
            detail={detail}
            leadExpectedVersion={pinnedVersion}
            leadStale={stale}
            canEdit={mayEdit}
            timezone={current.workspace.timezone}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/**
 * The stale-version banner (J7). Two actions, both explicit — the typing is
 * never silently thrown away and never silently re-based.
 */
function StaleLeadBanner({
  live,
  seen,
  onKeep,
  onDiscard,
}: {
  live: number
  seen: number
  onKeep: () => void
  onDiscard: () => void
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border border-chart-1/40 bg-chart-1/10 px-4 py-3",
      )}
    >
      <p className="min-w-0 flex-1 text-sm text-foreground">
        This lead changed underneath you (you read version {seen}; it is now
        version {live}). Your typed answers are still in the fields — choose
        what to do before submitting.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onKeep}>
          Keep my answers, use version {live}
        </Button>
        <Button variant="outline" size="sm" onClick={onDiscard}>
          Discard my answers
        </Button>
      </div>
    </div>
  )
}
