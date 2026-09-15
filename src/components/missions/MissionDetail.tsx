import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import {
  DetailRow,
  KindChip,
  RequiredChip,
  StateChip,
  formatInstant,
  formatWaited,
} from "@/components/decisions/decision-presentation"
import { MissionComments } from "@/components/missions/MissionComments"
import { MissionLifecycleActions } from "@/components/missions/MissionLifecycleActions"
import { MissionReceipts } from "@/components/missions/MissionReceipts"
import {
  MissionKindChip,
  MissionOutcomeChip,
  MissionPriorityChip,
  MissionStateChip,
  MISSION_STATE_SUMMARY,
  PROSPECT_OUTCOME_LABEL,
} from "@/components/missions/mission-presentation"
import { EmptyState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { isTypingTarget } from "@/lib/keyboard"
import { optionalOneOf } from "@/lib/search-params"
import {
  MISSION_TABS,
  OVERVIEW_DEFAULTS,
  type MissionTab,
} from "@/routes/_dashboard/_workspace/overview"

/** The layout that declared `validateSearch`, never this component's own leaf. */
const OVERVIEW_ROUTE = "/_dashboard/_workspace/overview"

const TAB_LABEL: Record<MissionTab, string> = {
  summary: "Summary",
  prospects: "Prospects",
  decisions: "Decisions",
  receipts: "Receipts",
  comments: "Notes",
}

/**
 * One mission, at its own URL under the board.
 *
 * It is a non-modal inline panel, not a `role="dialog"`: a focus trap plus a
 * scroll lock on a full-screen phone detail is hostile, and `role="dialog"`
 * stays reserved for the irreversible confirmations, where Base UI already
 * gives containment and restore (`plan/ux.md` §6).
 *
 * No error boundary here. `_dashboard` already maps NOT_FOUND — a foreign or
 * cross-workspace id — to an in-shell empty state and resets on search
 * changes, so a bad id keeps the shell instead of stranding the operator.
 */
export function MissionDetail({ missionId }: { missionId: string }) {
  const current = useCurrentWorkspace()
  const search = useSearch({ from: OVERVIEW_ROUTE })
  const navigate = useNavigate()

  const workspaceId =
    current !== undefined && current !== null ? current.workspace._id : undefined

  const detail = useQuery(
    api.missions.get,
    workspaceId === undefined
      ? "skip"
      : { workspaceId, missionId: missionId as Id<"missions"> },
  )

  const tab: MissionTab = search.tab ?? OVERVIEW_DEFAULTS.tab

  // Escape closes the detail by NAVIGATING to the board, not by blurring —
  // otherwise the URL still names a mission the operator is no longer looking
  // at, and Back does something they did not ask for.
  //
  // Two guards. A typing target, so Escape in the note textarea is the
  // textarea's; and an already-handled event or an open dialog, so a Base UI
  // confirmation dismisses itself first rather than the route changing out
  // from under an irreversible action someone was about to confirm.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return
      }
      if (isTypingTarget(event.target)) {
        return
      }
      if (document.querySelector('[role="dialog"]') !== null) {
        return
      }
      void navigate({
        to: "/overview",
        search: (previous) => ({ ...previous, tab: undefined }),
      })
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [navigate])

  // `null` cannot reach here — the `_workspace` gate redirects a
  // membership-less user to setup — but the query types as nullable and
  // loading is the only honest render for a case that resolves elsewhere.
  if (current === undefined || current === null || detail === undefined) {
    return (
      <>
        <BackToBoard />
        <LoadingState
          title="Loading mission"
          description="Reading the mission and everything it is bound to."
        />
      </>
    )
  }

  const { mission } = detail
  const timezone = current.workspace.timezone

  return (
    <>
      <BackToBoard />

      <MissionHeader mission={mission} timezone={timezone} />

      <MissionLifecycleActions
        workspaceId={current.workspace._id}
        mission={mission}
        role={current.role}
      />

      <Tabs
        value={tab}
        onValueChange={(next) => {
          const chosen = optionalOneOf(MISSION_TABS, next)
          void navigate({
            to: "/overview/missions/$missionId",
            params: { missionId },
            // A tab is a view mode of this screen, so it replaces rather than
            // pushes: Back should return to the board the operator came from,
            // not walk them back through five tabs first. The default is
            // written as absent so `?tab=` only ever shows a real choice.
            search: {
              ...search,
              tab:
                chosen === undefined || chosen === OVERVIEW_DEFAULTS.tab
                  ? undefined
                  : chosen,
            },
            replace: true,
          })
        }}
      >
        <TabsList className="max-w-full overflow-x-auto">
          {MISSION_TABS.map((name) => (
            <TabsTrigger key={name} value={name}>
              {TAB_LABEL[name]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="summary">
          <SummaryTab
            workspaceId={current.workspace._id}
            mission={mission}
            timezone={timezone}
          />
        </TabsContent>

        <TabsContent value="prospects">
          <ProspectsTab prospects={detail.prospects} timezone={timezone} />
        </TabsContent>

        <TabsContent value="decisions">
          <DecisionsTab
            workspaceId={current.workspace._id}
            missionId={mission._id}
            requiredDecisionCount={mission.requiredDecisionCount}
          />
        </TabsContent>

        <TabsContent value="receipts">
          <MissionReceipts
            workspaceId={current.workspace._id}
            missionId={mission._id}
            timezone={timezone}
          />
        </TabsContent>

        <TabsContent value="comments">
          <MissionComments
            workspaceId={current.workspace._id}
            missionId={mission._id}
            role={current.role}
            timezone={timezone}
          />
        </TabsContent>
      </Tabs>
    </>
  )
}

function BackToBoard() {
  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        // `tab` is this screen's own mode and means nothing to the board, so
        // it is dropped; every board filter is carried through untouched,
        // which is what makes closing the detail preserve them.
        render={
          <Link
            to="/overview"
            search={(previous) => ({ ...previous, tab: undefined })}
          />
        }
      >
        <HugeiconsIcon
          icon={ArrowLeft01Icon}
          strokeWidth={2}
          data-icon="inline-start"
          aria-hidden="true"
        />
        Back to the board
      </Button>
    </div>
  )
}

/**
 * Opening a detail moves focus to its heading — not a trap, because this is a
 * non-modal inline panel rather than a `role="dialog"`. Containment and
 * restore stay where they belong: the irreversible confirmations, which Base
 * UI already handles.
 */
function MissionHeader({
  mission,
  timezone,
}: {
  mission: Doc<"missions">
  timezone: string
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [mission._id])

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MissionStateChip state={mission.state} />
        <MissionPriorityChip priority={mission.priority} />
        <MissionKindChip kind={mission.kind} />
        {mission.visibility === "archived" ? (
          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            Archived
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          updated {formatWaited(mission.updatedAt)}
        </span>
      </div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl font-semibold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        {mission.title}
      </h1>
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {MISSION_STATE_SUMMARY[mission.state]}
      </p>
      <p className="text-xs text-muted-foreground">
        Version {mission.version} · last changed{" "}
        {formatInstant(mission.updatedAt, timezone)}
      </p>
    </header>
  )
}

function SummaryTab({
  workspaceId,
  mission,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  mission: Doc<"missions">
  timezone: string
}) {
  const employees = useQuery(api.employees.list, { workspaceId })
  const campaign = useQuery(api.campaigns.get, {
    workspaceId,
    campaignId: mission.campaignId,
  })

  const owner = employees?.find(
    (employee) => employee._id === mission.assignedEmployeeId,
  )

  return (
    <div className="flex flex-col gap-4 pt-4">
      <Card>
        <CardHeader>
          <CardTitle>Where it stands</CardTitle>
          <CardDescription>
            The current step is the summary the backend writes, not a sentence
            this screen invents.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <DetailRow label="Current step" value={mission.progressSummary} />
          <DetailRow
            label="Owner"
            value={
              employees === undefined
                ? "loading…"
                : (owner?.name ?? "an employee that is no longer on the roster")
            }
          />
          <DetailRow
            label="Campaign"
            value={
              campaign === undefined ? "loading…" : campaign.title
            }
          />
          <DetailRow
            label="Open required asks"
            value={
              mission.requiredDecisionCount === 0
                ? "none — nothing is waiting on you"
                : `${mission.requiredDecisionCount} open`
            }
          />
          <DetailRow
            label="Created"
            value={formatInstant(mission.createdAt, timezone)}
          />
          <DetailRow
            label="Last change"
            value={formatInstant(mission.updatedAt, timezone)}
          />
          {mission.completedAt === undefined ? null : (
            <DetailRow
              label="Completed"
              value={formatInstant(mission.completedAt, timezone)}
            />
          )}
        </CardContent>
      </Card>

      {mission.outcome === undefined ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Outcome</CardTitle>
            <CardDescription>
              The aggregate of this mission's branches. It is a different fact
              from the state.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div>
              <MissionOutcomeChip outcome={mission.outcome.kind} />
            </div>
            <p className="text-sm leading-relaxed text-foreground">
              {mission.outcome.summary}
            </p>
          </CardContent>
        </Card>
      )}

      {mission.failure === undefined ? null : (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">
              This mission failed
            </CardTitle>
            <CardDescription>
              A technical error, not an approval and not a completion. There is
              no retry: read the run receipt, then archive it or start a
              replacement.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="text-sm text-destructive">
              {mission.failure.message}
            </p>
            <p className="text-xs text-muted-foreground">
              Failed {formatInstant(mission.failure.at, timezone)}
            </p>
          </CardContent>
        </Card>
      )}

      <MissionOutput workspaceId={workspaceId} missionId={mission._id} />

      <Card>
        <CardHeader>
          <CardTitle>What it was dispatched with</CardTitle>
          <CardDescription>
            Frozen at dispatch. If the campaign brief has changed since, this is
            still what the squad was told to do.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DetailRow
            label="Campaign title then"
            value={mission.inputSnapshot.campaignTitle}
          />
          <DetailRow
            label="Requested outcome"
            value={mission.inputSnapshot.requestedOutcome}
          />
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Brief</span>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
              {mission.inputSnapshot.campaignBrief}
            </p>
          </div>
        </CardContent>
      </Card>

      <UnavailableNote
        title="Evidence and next actions are not on this screen yet"
        description="Research evidence and a lead's next action live on the prospect record. No public query reads either one yet, so nothing is shown rather than a number that would be invented."
      />
    </div>
  )
}

/**
 * Drafts produced under this mission.
 *
 * `drafts.listForMission` is a bare array with no `hasMore` — it takes at most
 * 50 rows and cannot say whether it truncated — so the section is labelled
 * "recent", never "all". Superseded revisions are returned too and are
 * labelled as such; a superseded draft must never read like a current one.
 */
function MissionOutput({
  workspaceId,
  missionId,
}: {
  workspaceId: Id<"workspaces">
  missionId: Id<"missions">
}) {
  const drafts = useQuery(api.drafts.listForMission, {
    workspaceId,
    missionId,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Output</CardTitle>
        <CardDescription>
          The most recent drafts this mission produced, up to 50. Approving one
          happens on its decision, never here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {drafts === undefined ? (
          <LoadingState
            title="Loading drafts"
            description="Reading what this mission has written."
          />
        ) : drafts.length === 0 ? (
          <EmptyState
            title="No drafts yet"
            description="A draft appears here once the squad writes one for this mission."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {drafts.map((draft) => (
              <li
                key={draft._id}
                className="flex flex-col gap-1 rounded-[min(var(--radius-4xl),24px)] bg-muted/40 px-4 py-3"
              >
                <p className="text-sm font-medium text-foreground">
                  {draft.subject}
                </p>
                <p className="text-xs text-muted-foreground">
                  revision {draft.revision}
                  {draft.supersededAt === undefined
                    ? ""
                    : " · superseded by a later revision"}{" "}
                  · written {formatWaited(draft.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The mission's prospect branches.
 *
 * No link: `/leads/$prospectId` does not exist yet, and
 * `missionProspects.prospectId` is a bounded string rather than an
 * `Id<"prospects">`, so there is nothing honest to link to.
 */
function ProspectsTab({
  prospects,
  timezone,
}: {
  prospects: Doc<"missionProspects">[]
  timezone: string
}) {
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Card>
        <CardHeader>
          <CardTitle>Prospect branches</CardTitle>
          <CardDescription>
            Up to 100 branches. Lead detail arrives with the CRM; until then a
            branch is identified by the key the workflow used.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {prospects.length === 0 ? (
            <EmptyState
              title="No prospect branches yet"
              description="A branch is recorded when the mission starts work on one prospect."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {prospects.map((prospect) => (
                <li
                  key={prospect._id}
                  className="flex flex-col gap-1 rounded-[min(var(--radius-4xl),24px)] bg-muted/40 px-4 py-3"
                >
                  <p className="text-sm font-medium break-words text-foreground">
                    {prospect.prospectId}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {prospect.outcome === undefined
                      ? "still running"
                      : PROSPECT_OUTCOME_LABEL[prospect.outcome]}
                    {prospect.completedAt === undefined
                      ? ""
                      : ` · ${formatInstant(prospect.completedAt, timezone)}`}
                  </p>
                  {prospect.outcomeReason === undefined ? null : (
                    <p className="text-sm text-muted-foreground">
                      {prospect.outcomeReason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * The mission's asks — every state, newest first.
 *
 * This tab **lists and links**. It renders no approval control at all: the
 * complete decision implementation already ships at `/decisions/$decisionId`,
 * including the exact-draft rendering and the approval wiring, and a second
 * implementation inside mission detail is how a draft approval gets routed to
 * the generic resolver that refuses it.
 */
function DecisionsTab({
  workspaceId,
  missionId,
  requiredDecisionCount,
}: {
  workspaceId: Id<"workspaces">
  missionId: Id<"missions">
  requiredDecisionCount: number
}) {
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const page = useQuery(api.decisions.listForMission, {
    workspaceId,
    missionId,
    ...(cursor === undefined ? {} : { cursor }),
  })

  return (
    <div className="flex flex-col gap-4 pt-4">
      <Card>
        <CardHeader>
          <CardTitle>Asks</CardTitle>
          <CardDescription>
            Every ask this mission has raised, open or closed, newest first.
            {requiredDecisionCount === 0
              ? " Nothing required is open right now."
              : ` ${requiredDecisionCount} required ${
                  requiredDecisionCount === 1 ? "ask is" : "asks are"
                } open.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {page === undefined ? (
            <LoadingState
              title="Loading asks"
              description="Reading this mission's ask history."
            />
          ) : page.items.length === 0 ? (
            cursor === undefined ? (
              <EmptyState
                title="No asks yet"
                description="The squad opens an ask here when it needs a person to decide something."
              />
            ) : (
              <EmptyState
                title="Nothing further on this page"
                description="Earlier asks may still be on the first page."
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
              {page.items.map((decision) => (
                <li key={decision._id}>
                  <DecisionLink decision={decision} />
                </li>
              ))}
            </ul>
          )}

          {page === undefined ||
          (cursor === undefined && !page.hasMore) ? null : (
            <div className="flex flex-wrap items-center gap-2">
              {cursor === undefined ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCursor(undefined)}
                >
                  First page
                </Button>
              )}
              {page.hasMore && page.cursor !== null ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCursor(page.cursor ?? undefined)}
                >
                  Next page
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {page.hasMore
                  ? "More asks than fit on one page."
                  : "End of the ask history."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** The whole row links to the decision that already knows how to render it. */
function DecisionLink({ decision }: { decision: Doc<"decisions"> }) {
  return (
    <Link
      to="/decisions/$decisionId"
      params={{ decisionId: decision._id }}
      className="flex flex-col gap-2 rounded-[min(var(--radius-4xl),24px)] bg-card px-4 py-3 text-card-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <div className="flex flex-wrap items-center gap-2">
        <KindChip kind={decision.kind} />
        <StateChip state={decision.state} />
        <RequiredChip required={decision.required} />
        <span className="text-xs text-muted-foreground">
          opened {formatWaited(decision.createdAt)}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-foreground">
        {decision.reason}
      </p>
    </Link>
  )
}

/**
 * Something `plan/ux.md` asks for that no query can serve yet. It is written
 * out rather than left blank, because a blank section reads as "there is none
 * of this" and that is a different claim from "we cannot ask".
 */
export function UnavailableNote({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[min(var(--radius-4xl),24px)] border border-dashed border-border px-4 py-3">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
      {action === undefined ? null : <div className="mt-1">{action}</div>}
    </div>
  )
}
