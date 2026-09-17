import {
  CatchBoundary,
  Link,
  useNavigate,
  useSearch,
} from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { SALES_STAGES } from "../../../convex/lib/validators"
import {
  Chip,
  formatWaited,
} from "@/components/decisions/decision-presentation"
import {
  QualificationChip,
  SALES_STAGE_LABEL,
  StageChip,
  memberLabel,
  nextActionLabel,
} from "@/components/leads/leads-presentation"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { useQueueNavigation } from "@/hooks/use-queue-navigation"
import { boundedCount } from "@/lib/bounded-count"
import {
  DUE_WINDOWS,
  DUE_WINDOW_IDS,
  dueWindowBounds,
  type DueWindowId,
} from "@/lib/date-ranges"
import { withFilters } from "@/lib/search-params"
import { cn } from "@/lib/utils"
import type {
  LeadListMode,
  LeadsSearch,
} from "@/routes/_dashboard/_workspace/leads"

const LEADS_ROUTE = "/_dashboard/_workspace/leads"

type LeadRow = FunctionReturnType<typeof api.prospects.list>["items"][number]
type MemberDoc = FunctionReturnType<typeof api.workspaces.listMembers>[number]

/**
 * `/leads` — the CRM home's list. Two modes, three query shapes, zero
 * post-filtered pages (`plan/ux.md` §225):
 *
 * - **Pipeline** — `prospects.list` on the stage indexes. Stage and campaign
 *   filters are legal; owner is not (no index backs owner+stage).
 * - **Due actions** — `prospects.list` on the two `nextActionDueAt` indexes:
 *   a bounded range, the `unscheduled` slice, or owner-scoped. Stage and
 *   campaign are disabled here — visibly, with the reason written out.
 * - **Company-name search** — `prospects.search` once `q` is non-empty;
 *   stage/campaign/owner stay legal as in-index equality filters while the
 *   due controls switch off.
 *
 * The list query lives inside the boundary so a stale or foreign cursor
 * throws HERE — "this page link is no longer valid" — never the whole route
 * (§227).
 */
export function LeadList({
  workspaceId,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  timezone: string
}) {
  const search = useSearch({ from: LEADS_ROUTE })
  const navigate = useNavigate()

  const mode: LeadListMode = search.mode ?? "pipeline"
  const q = search.q ?? ""
  const searching = q.trim().length > 0

  const members = useQuery(api.workspaces.listMembers, { workspaceId })
  const campaigns = useQuery(api.campaigns.list, { workspaceId, limit: 50 })

  const setFilters = (changes: Partial<LeadsSearch>) =>
    void navigate({
      to: "/leads",
      search: withFilters(search, changes),
    })

  const campaignTitle = (campaignId: Id<"campaigns">) =>
    campaigns?.items.find((campaign) => campaign._id === campaignId)?.title ??
    "its campaign"

  return (
    <div className="flex flex-col gap-4">
      {/* Mode + search. These controls stay OUTSIDE the boundary below so a
          bad cursor kills the rows but never the way out of them. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="List mode" className="flex gap-1.5">
            {(
              [
                ["pipeline", "Pipeline"],
                ["due", "Due actions"],
              ] as const
            ).map(([value, label]) => (
              <Link
                key={value}
                to="/leads"
                search={withFilters(search, {
                    mode: value === "pipeline" ? undefined : value,
                  })
                }
                aria-current={mode === value && !searching ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                  mode === value && !searching
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                  searching && "opacity-60",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          {/* Keyed on the committed value so a URL change (Back, the clear
              button, a pasted link) replaces the draft rather than fighting
              it — no state syncs an input against a search param. */}
          <CompanySearch
            key={q}
            committed={q}
            onCommit={(text) =>
              setFilters({ q: text === "" ? undefined : text })
            }
          />
          {searching ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilters({ q: undefined })}
            >
              Clear search
            </Button>
          ) : null}
        </div>
        {searching ? (
          <p role="status" className="text-xs text-muted-foreground">
            Searching company names — due windows and the mode toggle are off.
            Stage, campaign and owner still filter the results.
          </p>
        ) : null}
      </div>

      {/* Filters. Each disabled combination is named, not silently dropped:
          the control keeps its value visible and the note says which mode the
          filter belongs to. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Stage</span>
          <StageStrip search={search} disabled={!searching && mode === "due"} />
          {!searching && mode === "due" ? (
            <p className="text-xs text-muted-foreground">
              Stage filtering lives in Pipeline mode — it is not applied to the
              due list.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex w-56 min-w-40 flex-col gap-1">
            <Label
              htmlFor="leads-campaign"
              className="text-xs text-muted-foreground"
            >
              Campaign
            </Label>
            <NativeSelect
              id="leads-campaign"
              disabled={!searching && mode === "due"}
              value={search.campaign ?? ""}
              onChange={(event) =>
                setFilters({
                  campaign:
                    event.target.value === "" ? undefined : event.target.value,
                })
              }
            >
              <option value="">All campaigns</option>
              {(campaigns?.items ?? []).map((campaign) => (
                <option key={campaign._id} value={campaign._id}>
                  {campaign.title}
                </option>
              ))}
            </NativeSelect>
            {!searching && mode === "due" ? (
              <p className="text-xs text-muted-foreground">
                Campaign filtering lives in Pipeline mode.
              </p>
            ) : null}
            {campaigns !== undefined && campaigns.hasMore ? (
              <p className="text-xs text-muted-foreground">
                Showing the first {campaigns.items.length} campaigns.
              </p>
            ) : null}
          </div>

          <div className="flex w-56 min-w-40 flex-col gap-1">
            <Label
              htmlFor="leads-owner"
              className="text-xs text-muted-foreground"
            >
              Owner
            </Label>
            <NativeSelect
              id="leads-owner"
              disabled={!searching && mode === "pipeline"}
              value={search.owner ?? ""}
              onChange={(event) =>
                setFilters({
                  owner:
                    event.target.value === "" ? undefined : event.target.value,
                })
              }
            >
              <option value="">Anyone</option>
              {(members ?? [])
                .filter((member) => member.status === "active")
                .map((member) => (
                  <option key={member.identityKey} value={member.identityKey}>
                    {memberLabel(member.identityKey)}
                  </option>
                ))}
            </NativeSelect>
            {!searching && mode === "pipeline" ? (
              <p className="text-xs text-muted-foreground">
                Owner filtering needs Due mode or a company-name search — the
                pipeline indexes do not back an owner slice.
              </p>
            ) : null}
          </div>

          <div className="flex w-56 min-w-40 flex-col gap-1">
            <Label
              htmlFor="leads-due"
              className="text-xs text-muted-foreground"
            >
              Due window
            </Label>
            <NativeSelect
              id="leads-due"
              disabled={searching || mode !== "due"}
              value={search.due ?? ""}
              onChange={(event) =>
                setFilters({
                  due:
                    event.target.value === ""
                      ? undefined
                      : (event.target.value as DueWindowId),
                })
              }
            >
              <option value="">Anything scheduled</option>
              {DUE_WINDOW_IDS.map((id) => (
                <option key={id} value={id}>
                  {DUE_WINDOWS[id].label}
                </option>
              ))}
            </NativeSelect>
            {searching ? (
              <p className="text-xs text-muted-foreground">
                Due windows do not combine with a company-name search.
              </p>
            ) : mode !== "due" ? (
              <p className="text-xs text-muted-foreground">
                Due windows apply in Due mode.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <CatchBoundary
        getResetKey={() =>
          `${mode}:${search.cursor ?? ""}:${q}:${search.stage ?? ""}:${search.campaign ?? ""}:${search.owner ?? ""}:${search.due ?? ""}`
        }
        errorComponent={LeadListError}
      >
        <LeadListBody
          workspaceId={workspaceId}
          timezone={timezone}
          search={search}
          mode={mode}
          searching={searching}
          q={q.trim()}
          members={members}
          campaignTitle={campaignTitle}
          onFirstPage={() => setFilters({ cursor: undefined })}
          onNextPage={(cursor) =>
            void navigate({
              to: "/leads",
              search: { ...search, cursor },
            })
          }
        />
      </CatchBoundary>
    </div>
  )
}

/**
 * The search box owns its draft so keystrokes stay local; the URL (and the
 * query) follow a beat later. Mounted keyed on the committed `q`, so an
 * external change — Back, Clear, a pasted link — remounts the draft rather
 * than syncing state inside an effect.
 */
function CompanySearch({
  committed,
  onCommit,
}: {
  committed: string
  onCommit: (text: string) => void
}) {
  const [draft, setDraft] = useState(committed)
  // The parent's inline `onCommit` changes identity on every unrelated render
  // (a live list update, a j/k keystroke) — keeping it in a ref stops those
  // renders from cancelling and restarting the pending 350 ms commit.
  const commitRef = useRef(onCommit)
  useEffect(() => {
    commitRef.current = onCommit
  }, [onCommit])

  useEffect(() => {
    const trimmed = draft.trim()
    if (trimmed === committed.trim()) {
      return
    }
    const handle = setTimeout(() => commitRef.current(trimmed), 350)
    return () => clearTimeout(handle)
  }, [draft, committed])

  return (
    <div className="min-w-56 flex-1 sm:max-w-xs">
      <Label htmlFor="lead-search" className="sr-only">
        Search by company name
      </Label>
      <Input
        id="lead-search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Search by company name…"
        autoComplete="off"
      />
    </div>
  )
}

/**
 * One stage chip per stage the pipeline can hold — a strip, not a kanban
 * (§225: a list with a stage filter, not eleven columns). The strip is a row
 * of links so a filtered pipeline is a shareable address.
 */
function StageStrip({
  search,
  disabled,
}: {
  search: LeadsSearch
  disabled: boolean
}) {
  return (
    <nav
      aria-label="Stage filter"
      aria-disabled={disabled}
      className={cn(
        "flex gap-1.5 overflow-x-auto pb-1",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <Link
        to="/leads"
        search={withFilters(search, { stage: undefined })
        }
        aria-current={search.stage === undefined ? "page" : undefined}
        tabIndex={disabled ? -1 : undefined}
        className={cn(
          "shrink-0 rounded-full px-3 py-1 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
          search.stage === undefined
            ? "bg-foreground text-background"
            : "bg-muted text-muted-foreground hover:text-foreground",
        )}
      >
        All stages
      </Link>
      {SALES_STAGES.map((stage) => (
        <Link
          key={stage}
          to="/leads"
          search={withFilters(search, { stage })}
          aria-current={search.stage === stage ? "page" : undefined}
          tabIndex={disabled ? -1 : undefined}
          className={cn(
            "shrink-0 rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
            search.stage === stage
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          {SALES_STAGE_LABEL[stage]}
        </Link>
      ))}
    </nav>
  )
}

/**
 * The page itself: owns the list query and the queue keyboard state. The two
 * call sites — `search` while typing, `list` otherwise — are both declared
 * with one skipped; a skipped subscription costs nothing and keeps each call
 * site exactly typed.
 */
function LeadListBody({
  workspaceId,
  timezone,
  search,
  mode,
  searching,
  q,
  members,
  campaignTitle,
  onFirstPage,
  onNextPage,
}: {
  workspaceId: Id<"workspaces">
  timezone: string
  search: LeadsSearch
  mode: LeadListMode
  searching: boolean
  q: string
  members: MemberDoc[] | undefined
  campaignTitle: (campaignId: Id<"campaigns">) => string
  onFirstPage: () => void
  onNextPage: (cursor: string) => void
}) {
  const limit = search.limit ?? 25
  const cursor = search.cursor

  // Build the due-mode slice: an absent `due` is "everything with a due
  // date" — the empty range — and `unscheduled` is its own arg, not a range.
  // Memoized on the filter inputs alone: `useQuery` compares args by value,
  // so a `dueRange` rebuilt every render would re-subscribe on each render.
  const dueRange = useMemo(
    () =>
      mode !== "due" || searching || search.due === "unscheduled"
        ? undefined
        : search.due === undefined
          ? {}
          : (dueWindowBounds(search.due, timezone) ?? undefined),
    [mode, searching, search.due, timezone],
  )
  const unscheduled =
    !searching && mode === "due" && search.due === "unscheduled"

  const searchPage = useQuery(
    api.prospects.search,
    searching
      ? {
          workspaceId,
          text: q,
          limit,
          ...(cursor === undefined ? {} : { cursor }),
          ...(search.stage === undefined
            ? {}
            : { salesStage: search.stage }),
          ...(search.campaign === undefined
            ? {}
            : { campaignId: search.campaign as Id<"campaigns"> }),
          ...(search.owner === undefined ? {} : { owner: search.owner }),
        }
      : "skip",
  )
  const listPage = useQuery(
    api.prospects.list,
    searching
      ? "skip"
      : {
          workspaceId,
          limit,
          ...(cursor === undefined ? {} : { cursor }),
          ...(unscheduled
            ? { unscheduled: true as const }
            : dueRange !== undefined
              ? { dueRange }
              : {}),
          ...(mode === "due" && search.owner !== undefined
            ? { owner: search.owner }
            : {}),
          ...(mode === "pipeline"
            ? {
                ...(search.stage === undefined
                  ? {}
                  : { salesStage: search.stage }),
                ...(search.campaign === undefined
                  ? {}
                  : { campaignId: search.campaign as Id<"campaigns"> }),
              }
            : {}),
        },
  )
  const page = searching ? searchPage : listPage
  const items = page?.items ?? []

  const { activeKey, setActiveKey } = useQueueNavigation({
    items,
    keyOf: (item) => item._id,
    // The detail is a different route, so the list unmounts while it is open —
    // there is no side-by-side pane to keep focus in. The hook still owns the
    // j/k behaviour while the list is up.
    detailOpen: false,
  })

  if (page === undefined) {
    return (
      <LoadingState
        title="Loading leads"
        description="Reading this workspace's pipeline."
      />
    )
  }

  if (items.length === 0) {
    if (cursor !== undefined) {
      return (
        <EmptyState
          title="Nothing further on this page"
          description="This link names a later page of the list, and there is nothing on it. Earlier leads may still be on the first page."
          action={
            <Button variant="outline" onClick={onFirstPage}>
              Back to the first page
            </Button>
          }
        />
      )
    }
    return (
      <LeadListEmpty
        mode={mode}
        searching={searching}
        filtered={search.stage !== undefined || search.campaign !== undefined}
        due={search.due}
        timezone={timezone}
      />
    )
  }

  const ownerName = (identityKey: string) =>
    members !== undefined &&
    members.find((member) => member.identityKey === identityKey) === undefined
      ? `${memberLabel(identityKey)} (no longer a member)`
      : memberLabel(identityKey)

  return (
    <>
      <p className="text-xs text-muted-foreground" role="status">
        {listCaption(searching, mode, search, items.length, page.hasMore)}
      </p>
      <ul className="flex flex-col gap-2" aria-label="Leads">
        {items.map((item) => (
          <li key={item._id}>
            <LeadListRow
              item={item}
              timezone={timezone}
              active={item._id === activeKey}
              setActiveKey={setActiveKey}
              campaignTitle={campaignTitle}
              ownerName={ownerName(item.ownerIdentityKey)}
            />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {cursor !== undefined ? (
          <Button variant="outline" size="sm" onClick={onFirstPage}>
            First page
          </Button>
        ) : null}
        {page.hasMore && page.cursor !== null ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNextPage(page.cursor as string)}
          >
            Next page
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {page.hasMore
            ? "More leads than fit on one page."
            : "End of the list."}{" "}
          Press <kbd className="rounded bg-muted px-1 font-mono">j</kbd>/
          <kbd className="rounded bg-muted px-1 font-mono">k</kbd> to move,
          Enter to open.
        </p>
      </div>
    </>
  )
}

/**
 * What the current page actually IS, in one line — the mode plus the bounded
 * count. `boundedCount` is only ever fed a FIRST page, so `25+` is honest and
 * an unfiltered total is never implied.
 */
function listCaption(
  searching: boolean,
  mode: LeadListMode,
  search: LeadsSearch,
  count: number,
  hasMore: boolean,
): string {
  const shown = boundedCount(count, hasMore)
  const noun = count === 1 && !hasMore ? "lead" : "leads"
  if (searching) {
    return `${shown} ${noun} matching the name search.`
  }
  if (mode === "due") {
    const windowLabel =
      search.due === undefined
        ? "with any scheduled action"
        : DUE_WINDOWS[search.due].label.toLowerCase()
    return `${shown} ${noun} ${windowLabel}, soonest first.`
  }
  if (search.stage !== undefined || search.campaign !== undefined) {
    return `${shown} ${noun} in this slice, most recently updated first.`
  }
  return `${shown} ${noun} — ordered by next-action date, unscheduled last.`
}

/**
 * The empty state is per-mode because "nothing here" means something
 * different in each one: an empty pipeline is a discovery problem, an empty
 * due list is a clear desk, and an empty search is a typo or a lead that was
 * never imported.
 */
function LeadListEmpty({
  mode,
  searching,
  filtered,
  due,
  timezone,
}: {
  mode: LeadListMode
  searching: boolean
  filtered: boolean
  due: DueWindowId | undefined
  timezone: string
}) {
  if (searching) {
    return (
      <EmptyState
        title="No leads match"
        description={
          filtered
            ? "No company in this workspace matches that name under the current filters. Loosen the filters or check the spelling."
            : "No company in this workspace matches that name. Leads appear here when a campaign's discovery run imports them."
        }
      />
    )
  }
  if (mode === "due") {
    return (
      <EmptyState
        title={
          due === "unscheduled"
            ? "No unscheduled actions"
            : due === "overdue"
              ? "Nothing is overdue"
              : "Nothing due in this window"
        }
        description={
          due === "unscheduled"
            ? "Every lead with a next action has a due date. Unscheduled is where an undated action would wait — there are none."
            : due === "overdue"
              ? "No next action is past its due time. The due list is clear."
              : `No next action falls in this window on the workspace calendar (${timezone}).`
        }
      />
    )
  }
  if (filtered) {
    return (
      <EmptyState
        title="No leads in this slice"
        description="Nothing in the pipeline matches these filters right now. Stages move as the squad works, so this changes over time."
      />
    )
  }
  return (
    <EmptyState
      title="No leads yet"
      description="Leads appear here when a campaign's discovery run accepts a company. Confirm a campaign and run a mission to fill the pipeline."
      action={
        <Button render={<Link to="/overview" />}>Open Mission Control</Button>
      }
    />
  )
}

/**
 * One lead row — the whole row is the link so the queue is workable with Tab
 * and Enter alone. The current filters travel into the detail URL so Back
 * returns to the same page; `tab` is stripped because the detail's own
 * default applies.
 */
function LeadListRow({
  item,
  timezone,
  active,
  setActiveKey,
  campaignTitle,
  ownerName,
}: {
  item: LeadRow
  timezone: string
  active: boolean
  setActiveKey: (key: string) => void
  campaignTitle: (campaignId: Id<"campaigns">) => string
  ownerName: string
}) {
  const next = nextActionLabel(item.nextAction, item.nextActionDueAt, timezone)

  return (
    <Link
      to="/leads/$prospectId"
      params={{ prospectId: item._id }}
      search={(previous) => ({ ...previous, tab: undefined })}
      data-queue-item={item._id}
      onFocus={() => setActiveKey(item._id)}
      className={cn(
        "flex flex-col gap-2 rounded-[min(var(--radius-4xl),24px)] bg-card px-4 py-3 text-card-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
        active && "ring-3 ring-ring/30",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StageChip stage={item.salesStage} />
        <QualificationChip qualification={item.qualification} />
        {next.overdue ? (
          <Chip className="bg-chart-1/15 text-chart-1">Overdue</Chip>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          updated {formatWaited(item.updatedAt)}
        </span>
      </div>
      <p className="text-sm font-medium leading-relaxed text-foreground">
        {item.companyName}
        <span className="font-normal text-muted-foreground">
          {" "}
          · {item.canonicalDomain}
        </span>
      </p>
      <p className="text-xs text-muted-foreground">
        {ownerName} · {campaignTitle(item.campaignId)}
        {item.contact !== undefined
          ? ` · contact: ${item.contact.fullName}${item.contact.email !== undefined ? ` (${item.contact.email})` : ""}`
          : " · no contact yet"}
        {item.lastReplyAt !== undefined
          ? ` · replied ${formatWaited(item.lastReplyAt)}`
          : item.lastContactedAt !== undefined
            ? ` · mailed ${formatWaited(item.lastContactedAt)}`
            : ""}
      </p>
      <p
        className={cn(
          "text-xs",
          next.overdue ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {next.text}
      </p>
    </Link>
  )
}

/** Expired/foreign cursor, an unsupported combination or a failed page —
 *  inside the list, not the route. */
function LeadListError({ error, reset }: ErrorComponentProps) {
  const navigate = useNavigate()
  const search = useSearch({ from: LEADS_ROUTE })
  const message = error instanceof Error ? error.message : ""
  const cursor = /cursor/i.test(message)
  const unsupported = /cannot combine|no index supports/i.test(message)
  return (
    <ErrorState
      title={
        cursor
          ? "This page link is no longer valid"
          : unsupported
            ? "That combination is not supported"
            : "The lead list didn't load"
      }
      description={
        cursor
          ? "The list moved on since this link was made — the page cursor it carries no longer resolves."
          : unsupported
            ? "This link asks for a filter combination no index backs — change a filter above to leave this page."
            : "The list could not be loaded. Nothing here was changed."
      }
      {...(cursor
        ? // A stale cursor re-throws on every retry — the honest recovery is
          // the first page, reached by navigation (which remounts the boundary).
          {
            onRetry: () =>
              void navigate({
                to: "/leads",
                search: { ...search, cursor: undefined },
              }),
            retryLabel: "Back to the first page",
          }
        : unsupported
          ? {}
          : { onRetry: reset, retryLabel: "Try again" })}
    />
  )
}
