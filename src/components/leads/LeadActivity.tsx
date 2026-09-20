import { useQuery } from "convex/react"
import { useState } from "react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { formatInstant } from "@/components/shared/presentation"
import {
  LEAD_EVENT_KIND_LABEL,
  SALES_STAGE_LABEL,
  leadEventActorLabel,
} from "@/components/leads/leads-presentation"
import { EmptyState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"

type LeadEventDoc = FunctionReturnType<
  typeof api.leadEvents.list
>["items"][number]

/**
 * The append-only history — `leadEvents.list`, newest first. Rows are never
 * edited or deleted, so the timeline is the record of what actually happened:
 * a stage correction appends a row preserving `fromStage`, it does not
 * rewrite one.
 *
 * Pages are appended through "Show earlier events" — each mounted page is
 * its own live query, so nothing is a stale snapshot of a history that moved.
 */
export function LeadActivity({
  workspaceId,
  prospectId,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  prospectId: Id<"prospects">
  timezone: string
}) {
  return (
    <section
      aria-label="Lead history"
      className="flex flex-col gap-3 rounded-xl bg-card p-5"
    >
      <h3 className="text-sm font-medium">
        History — everything that happened, in order
      </h3>
      <ActivityPage
        workspaceId={workspaceId}
        prospectId={prospectId}
        timezone={timezone}
        cursor={undefined}
      />
    </section>
  )
}

function ActivityPage({
  workspaceId,
  prospectId,
  timezone,
  cursor,
}: {
  workspaceId: Id<"workspaces">
  prospectId: Id<"prospects">
  timezone: string
  cursor: string | undefined
}) {
  const page = useQuery(api.leadEvents.list, {
    workspaceId,
    prospectId,
    ...(cursor === undefined ? {} : { cursor }),
  })
  const [showMore, setShowMore] = useState(false)

  if (page === undefined) {
    return (
      <LoadingState
        title="Loading the history"
        description="Reading this lead's event log."
      />
    )
  }

  return (
    <>
      {page.items.length === 0 && cursor === undefined ? (
        <EmptyState
          title="No history yet"
          description="Every stage change, assignment, note and booking step lands here as an append-only event — the lead was just created."
        />
      ) : (
        <ol className="flex flex-col gap-2">
          {page.items.map((item) => (
            <ActivityRow key={item._id} item={item} timezone={timezone} />
          ))}
        </ol>
      )}
      {page.hasMore && page.cursor !== null ? (
        showMore ? (
          <ActivityPage
            workspaceId={workspaceId}
            prospectId={prospectId}
            timezone={timezone}
            cursor={page.cursor}
          />
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setShowMore(true)}
          >
            Show earlier events
          </Button>
        )
      ) : (
        page.items.length > 0 && (
          <p className="text-xs text-muted-foreground">Start of the history.</p>
        )
      )}
    </>
  )
}

/**
 * One history row. The summary the writer recorded is the headline; the
 * structured details — stage pair, actor, linked booking — are the context
 * under it. Model-written text never lands here: `actor` is a closed union
 * of human, workflow and system, so the byline can never claim "you said…".
 */
function ActivityRow({
  item,
  timezone,
}: {
  item: LeadEventDoc
  timezone: string
}) {
  return (
    <li className="flex flex-col gap-1 rounded-lg bg-muted/40 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-medium text-muted-foreground">
          {LEAD_EVENT_KIND_LABEL[item.kind]}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {formatInstant(item.createdAt, timezone)}
        </span>
      </div>
      <p className="text-sm text-foreground">{item.summary}</p>
      <p className="text-xs text-muted-foreground">
        {item.fromStage !== undefined && item.toStage !== undefined
          ? `${SALES_STAGE_LABEL[item.fromStage]} → ${SALES_STAGE_LABEL[item.toStage]} · `
          : ""}
        by {leadEventActorLabel(item.actor)}
        {item.bookingId !== undefined ? " · linked booking" : ""}
      </p>
      {item.details?.note !== undefined ? (
        <blockquote className="border-l-2 border-border pl-3 text-sm leading-relaxed text-foreground">
          {item.details.note}
        </blockquote>
      ) : null}
      {item.details?.reason !== undefined &&
      item.kind !== "booking_outcome_recorded" ? (
        <p className="text-xs text-muted-foreground">
          Reason: {item.details.reason}
        </p>
      ) : null}
    </li>
  )
}
