import { useState } from "react"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import {
  DetailRow,
  formatInstant,
  formatWaited,
} from "@/components/decisions/decision-presentation"
import { RUN_STATE_LABEL } from "@/components/missions/mission-presentation"
import { EmptyState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * What actually ran, and what the workspace recorded while it ran.
 *
 * Two lists, deliberately not merged: a run is an execution attempt with a
 * stage, a generation and a usage report, and an activity event is a receipt
 * the backend wrote when something happened. Interleaving them by timestamp
 * would read as one narrative and imply a causality neither table asserts.
 *
 * Nothing here is workspace-wide. `activity.listRuns` requires a `missionId`
 * and there is no cross-mission runs query or index, so receipts live inside
 * a mission and there is no Runs screen — see `plan/ux.md` §8.
 */
export function MissionReceipts({
  workspaceId,
  missionId,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  missionId: Id<"missions">
  timezone: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <RunReceipts
        workspaceId={workspaceId}
        missionId={missionId}
        timezone={timezone}
      />
      <MissionActivity
        workspaceId={workspaceId}
        missionId={missionId}
        timezone={timezone}
      />
    </div>
  )
}

function RunReceipts({
  workspaceId,
  missionId,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  missionId: Id<"missions">
  timezone: string
}) {
  // Local, not URL state: `?cursor=` on this route belongs to the board's
  // activity feed, and a second meaning for one param is how a shared link
  // starts showing the wrong page of the wrong query.
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const page = useQuery(api.activity.listRuns, {
    workspaceId,
    missionId,
    ...(cursor === undefined ? {} : { cursor }),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run receipts</CardTitle>
        <CardDescription>
          Every execution attempt for this mission, newest first.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {page === undefined ? (
          <LoadingState
            title="Loading run receipts"
            description="Reading what ran, and what it reported."
          />
        ) : page.items.length === 0 ? (
          cursor === undefined ? (
            <EmptyState
              title="Nothing has run yet"
              description="A run receipt appears the first time a stage of this mission executes."
            />
          ) : (
            <EmptyState
              title="Nothing further on this page"
              description="Earlier runs may still be on the first page."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCursor(undefined)}
                >
                  Back to the first page
                </Button>
              }
            />
          )
        ) : (
          <ul className="flex flex-col gap-3">
            {page.items.map((run) => (
              <li key={run._id}>
                <RunRow run={run} timezone={timezone} />
              </li>
            ))}
          </ul>
        )}

        {page === undefined ? null : (
          <Pager
            hasMore={page.hasMore}
            cursor={page.cursor}
            onFirstPage={
              cursor === undefined ? undefined : () => setCursor(undefined)
            }
            onNextPage={(next) => setCursor(next)}
            moreCaption="More runs than fit on one page."
            endCaption="End of the run history."
          />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * One run.
 *
 * `usage` absent means **unknown**, not zero — the worker reports it only when
 * it has it — so an absent report says "unavailable" and no number here is
 * labelled as currency or credits. There is no model name and no cost field on
 * `runFields`, so neither is rendered.
 */
function RunRow({ run, timezone }: { run: Doc<"runs">; timezone: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-[min(var(--radius-4xl),24px)] bg-muted/40 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-foreground">{run.stage}</span>
        <span className="text-xs text-muted-foreground">
          attempt {run.generation}
        </span>
        <span className="text-xs text-foreground">
          {RUN_STATE_LABEL[run.state]}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">
        {run.inputSummary}
      </p>

      <div className="flex flex-col gap-0.5">
        <DetailRow
          label="Created"
          value={formatInstant(run.createdAt, timezone)}
        />
        <DetailRow
          label="Started"
          value={
            run.startedAt === undefined
              ? "not started"
              : formatInstant(run.startedAt, timezone)
          }
        />
        <DetailRow
          label="Ended"
          value={
            run.endedAt === undefined
              ? "still open"
              : formatInstant(run.endedAt, timezone)
          }
        />
        <DetailRow
          label="Reported usage"
          value={
            run.usage === undefined
              ? "unavailable — the runtime reported none"
              : usageLine(run.usage)
          }
        />
      </div>

      {run.error === undefined ? null : (
        <p className="text-sm text-destructive">
          {run.error.message}
          {run.error.retryable === true
            ? " (the backend may retry this stage)"
            : ""}
        </p>
      )}
    </div>
  )
}

/** Only the fields the runtime actually reported; an absent one is omitted. */
function usageLine(usage: NonNullable<Doc<"runs">["usage"]>): string {
  const parts: string[] = []
  if (usage.modelCalls !== undefined) {
    parts.push(`${usage.modelCalls} model calls`)
  }
  if (usage.toolCalls !== undefined) {
    parts.push(`${usage.toolCalls} tool calls`)
  }
  if (usage.tokens !== undefined) {
    parts.push(`${usage.tokens} tokens`)
  }
  return parts.length === 0 ? "reported, but empty" : parts.join(" · ")
}

/**
 * The mission's own event feed.
 *
 * `activityEventFields.kind` is a bounded string, not the union, so a kind
 * this build has never heard of must render rather than crash the feed —
 * hence the plain summary line and no exhaustive switch.
 */
function MissionActivity({
  workspaceId,
  missionId,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  missionId: Id<"missions">
  timezone: string
}) {
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const page = useQuery(api.activity.list, {
    workspaceId,
    missionId,
    ...(cursor === undefined ? {} : { cursor }),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>
          Receipts this workspace recorded for the mission. Archive and restore
          are recorded once each, so this is not a complete visibility audit.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {page === undefined ? (
          <LoadingState
            title="Loading activity"
            description="Reading this mission's receipts."
          />
        ) : page.items.length === 0 ? (
          cursor === undefined ? (
            <EmptyState
              title="No activity recorded yet"
              description="Creating, transitioning, archiving or commenting on this mission each write a receipt here."
            />
          ) : (
            <EmptyState
              title="Nothing further on this page"
              description="Earlier receipts may still be on the first page."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCursor(undefined)}
                >
                  Back to the first page
                </Button>
              }
            />
          )
        ) : (
          <ul className="flex flex-col gap-2">
            {page.items.map((event) => (
              <li key={event._id} className="flex flex-col gap-0.5">
                <p className="text-sm text-foreground">{event.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {actorLabel(event.actor)} ·{" "}
                  {formatInstant(event.createdAt, timezone)} ·{" "}
                  {formatWaited(event.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}

        {page === undefined ? null : (
          <Pager
            hasMore={page.hasMore}
            cursor={page.cursor}
            onFirstPage={
              cursor === undefined ? undefined : () => setCursor(undefined)
            }
            onNextPage={(next) => setCursor(next)}
            moreCaption="More activity than fits on one page."
            endCaption="End of this mission's activity."
          />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * `actor` is an identityKey — an `iss|sub` token identifier — for human
 * actions, and the literal `workflow` or `system` otherwise. There is no
 * display-name lookup for it anywhere in the backend, so a human actor reads
 * as "a teammate" rather than printing the raw token into the UI.
 */
export function actorLabel(actor: string): string {
  if (actor === "workflow") {
    return "the workflow"
  }
  if (actor === "system") {
    return "the system"
  }
  return "a teammate"
}

/** Forward-only local paging, the same shape the decision queue's pager uses. */
function Pager({
  hasMore,
  cursor,
  onFirstPage,
  onNextPage,
  moreCaption,
  endCaption,
}: {
  hasMore: boolean
  cursor: string | null
  onFirstPage?: () => void
  onNextPage: (cursor: string) => void
  moreCaption: string
  endCaption: string
}) {
  if (onFirstPage === undefined && !hasMore) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {onFirstPage === undefined ? null : (
        <Button variant="outline" size="sm" onClick={onFirstPage}>
          First page
        </Button>
      )}
      {hasMore && cursor !== null ? (
        <Button variant="outline" size="sm" onClick={() => onNextPage(cursor)}>
          Next page
        </Button>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {hasMore ? moreCaption : endCaption}
      </p>
    </div>
  )
}
