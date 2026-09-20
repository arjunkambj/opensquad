import {
  CatchBoundary,
  Link,
  useNavigate,
  useSearch,
} from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import type { FunctionReturnType } from "convex/server"
import type { ConversationTab } from "../../../convex/lib/validators"
import {
  CONVERSATION_TAB_LABEL,
  ConversationStateChip,
  DispositionChip,
} from "@/components/inbox/inbox-presentation"
import { Chip, formatWaited } from "@/components/shared/presentation"
import { EmptyState, ErrorState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { useQueueNavigation } from "@/hooks/use-queue-navigation"
import type { InboxSearch } from "@/routes/_dashboard/_workspace/inbox"
import { withFilters } from "@/lib/search-params"
import { cn } from "@/lib/utils"

const INBOX_ROUTE = "/_dashboard/_workspace/inbox"

type ConversationSummary = FunctionReturnType<
  typeof api.conversations.list
>["items"][number]

const TABS: { tab: ConversationTab; label: string }[] = (
  ["open", "unassigned", "takeover", "closed"] as const
).map((tab) => ({ tab, label: CONVERSATION_TAB_LABEL[tab] }))

/**
 * The shared workspace inbox — one mailbox per workspace, so two panes and
 * no mailbox switcher (`plan/ux.md` §232).
 *
 * Every tab is one exact index range on `conversations`: `open`/`unassigned`/
 * `closed` slice by state, `takeover` slices by `humanTakeover`. There is no
 * post-filtered tab and no unread tab — unread is a badge and a sort fact,
 * not an index (`plan/ux.md` §172 ②).
 */
export function InboxList({ detailOpen }: { detailOpen: boolean }) {
  const current = useCurrentWorkspace()
  const search = useSearch({ from: INBOX_ROUTE })
  const navigate = useNavigate()

  const workspaceId =
    current !== undefined && current !== null ? current.workspace._id : undefined
  const tab = search.tab ?? "open"

  const employees = useQuery(
    api.employees.list,
    workspaceId === undefined ? "skip" : { workspaceId },
  )
  // The unassigned tab's count is the one `attentionCounts` bucket that is an
  // exact match for a tab's index range (state = "unassigned"). `openTakeover`
  // deliberately does NOT badge the takeover tab — it counts only open frozen
  // threads, a strict subset, and a smaller number over a longer list is a lie.
  const attention = useQuery(
    api.conversations.attentionCounts,
    workspaceId === undefined ? "skip" : { workspaceId },
  )

  if (current === undefined || current === null) {
    return (
      <LoadingState
        title="Loading the inbox"
        description="Reading this workspace's conversations."
      />
    )
  }

  const setTab = (next: ConversationTab) =>
    void navigate({
      to: "/inbox",
      search: withFilters(search, {
        tab: next === "open" ? undefined : next,
      }),
    })

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs are links over one URL param — a filtered inbox is a linkable,
          shareable view, and Back returns through the tab history. They live
          OUTSIDE the boundary below so a bad cursor kills the rows but never
          the way out of them. */}
      <nav aria-label="Inbox filters" className="flex flex-wrap gap-1.5">
        {TABS.map(({ tab: value, label }) => {
          const active = tab === value
          return (
            <Link
              key={value}
              to="/inbox"
              search={withFilters(search, {
                tab: value === "open" ? undefined : value,
              })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                active
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {value === "unassigned" && attention !== undefined ? (
                <span className="tabular-nums">
                  {attention.unassignedHasMore
                    ? `${attention.unassigned}+`
                    : attention.unassigned}
                  <span className="sr-only"> unassigned</span>
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>

      {/* The `conversations.list` query lives inside this boundary so a stale
          or foreign cursor throws HERE — "this page link is no longer valid"
          — never the whole route (`plan/ux.md` §227). */}
      <CatchBoundary
        getResetKey={() => `${tab}:${search.cursor ?? ""}`}
        errorComponent={InboxListError}
      >
        <InboxListBody
          workspaceId={current.workspace._id}
          search={search}
          tab={tab}
          detailOpen={detailOpen}
          attention={attention}
          employees={employees}
          onSelectTab={setTab}
        />
      </CatchBoundary>
    </div>
  )
}

/**
 * The page itself: owns the `list` query and the queue keyboard state. Its
 * render throwing is exactly the cursor case the boundary above exists for.
 */
function InboxListBody({
  workspaceId,
  search,
  tab,
  detailOpen,
  attention,
  employees,
  onSelectTab,
}: {
  workspaceId: Id<"workspaces">
  search: InboxSearch
  tab: ConversationTab
  detailOpen: boolean
  attention:
    | FunctionReturnType<typeof api.conversations.attentionCounts>
    | undefined
  employees: FunctionReturnType<typeof api.employees.list> | undefined
  onSelectTab: (tab: ConversationTab) => void
}) {
  const navigate = useNavigate()
  const page = useQuery(api.conversations.list, {
    workspaceId,
    tab,
    limit: search.limit,
    ...(search.cursor === undefined ? {} : { cursor: search.cursor }),
  })

  const items = page?.items ?? []
  const { activeKey, setActiveKey } = useQueueNavigation({
    items,
    keyOf: (item) => item.conversationId,
    detailOpen,
  })

  if (page === undefined) {
    return (
      <LoadingState
        title="Loading the inbox"
        description="Reading this workspace's conversations."
      />
    )
  }

  const employeeName = (employeeId: Id<"employees">) =>
    employees?.find((employee) => employee._id === employeeId)?.name ??
    "an employee"

  return (
    <InboxRows
      items={items}
      tab={tab}
      hasCursor={search.cursor !== undefined}
      hasMore={page.hasMore}
      nextCursor={page.cursor}
      attention={attention}
      activeKey={activeKey}
      setActiveKey={setActiveKey}
      employeeName={employeeName}
      onFirstPage={() =>
        void navigate({
          to: "/inbox",
          search: { ...search, cursor: undefined },
        })
      }
      onNextPage={(cursor) =>
        void navigate({
          to: "/inbox",
          search: { ...search, cursor },
        })
      }
      onSelectTab={onSelectTab}
    />
  )
}

/**
 * The list itself, behind its own boundary: a stale or foreign cursor throws
 * inside `paginate` and must land on a "this page link is no longer valid"
 * state — never the whole route (`plan/ux.md` §227).
 */
function InboxRows({
  items,
  tab,
  hasCursor,
  hasMore,
  nextCursor,
  attention,
  activeKey,
  setActiveKey,
  employeeName,
  onFirstPage,
  onNextPage,
  onSelectTab,
}: {
  items: ConversationSummary[]
  tab: ConversationTab
  hasCursor: boolean
  hasMore: boolean
  nextCursor: string | null
  attention:
    | FunctionReturnType<typeof api.conversations.attentionCounts>
    | undefined
  activeKey: string | null
  setActiveKey: (key: string) => void
  employeeName: (employeeId: Id<"employees">) => string
  onFirstPage: () => void
  onNextPage: (cursor: string) => void
  onSelectTab: (tab: ConversationTab) => void
}) {
  if (items.length === 0) {
    if (hasCursor) {
      return (
        <EmptyState
          title="Nothing further on this page"
          description="This is a link to a later page of the inbox, and there is nothing on it. Earlier threads may still be on the first page."
          action={<Button variant="outline" onClick={onFirstPage}>Back to the first page</Button>}
        />
      )
    }
    switch (tab) {
      case "open":
        return (
          <EmptyState
            title="No open conversations"
            description={
              attention !== undefined && attention.needsAttention > 0
                ? "Nothing is open for the squad to work — but threads are waiting under Unassigned and Taken over."
                : "When a prospect replies to an approved send, or mail arrives this inbox cannot place, it lands here. Nothing has arrived yet."
            }
            action={
              attention !== undefined && attention.needsAttention > 0 ? (
                <Button
                  variant="outline"
                  onClick={() => onSelectTab("unassigned")}
                >
                  Review unassigned mail
                </Button>
              ) : undefined
            }
          />
        )
      case "unassigned":
        return (
          <EmptyState
            title="No unassigned mail"
            description="Every inbound reply this inbox received is matched to a lead. Mail that matches no thread waits here under takeover until a person links it."
          />
        )
      case "takeover":
        return (
          <EmptyState
            title="Nothing is taken over"
            description="Threads an operator froze — or that arrived with no lead — stay here until someone resumes automation. Right now none are held."
          />
        )
      case "closed":
        return (
          <EmptyState
            title="No closed conversations"
            description="Closed threads stay readable here. Automation never reopens one on its own."
          />
        )
    }
  }

  return (
    <>
      <ul className="flex flex-col gap-2" aria-label="Conversations">
        {items.map((item) => (
          <li key={item.conversationId}>
            <ConversationRow
              item={item}
              active={item.conversationId === activeKey}
              setActiveKey={setActiveKey}
              employeeName={employeeName}
            />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {hasCursor ? (
          <Button variant="outline" size="sm" onClick={onFirstPage}>
            First page
          </Button>
        ) : null}
        {hasMore && nextCursor !== null ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNextPage(nextCursor)}
          >
            Next page
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {hasMore
            ? "More threads than fit on one page."
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
 * One inbox row. The whole row is the link so the queue is workable with Tab
 * and Enter alone; `search: (prev) => prev` carries the tab and page cursor
 * into the thread, so Back returns to the same filtered page.
 */
function ConversationRow({
  item,
  active,
  setActiveKey,
  employeeName,
}: {
  item: ConversationSummary
  active: boolean
  setActiveKey: (key: string) => void
  employeeName: (employeeId: Id<"employees">) => string
}) {
  return (
    <Link
      to="/inbox/$conversationId"
      params={{ conversationId: item.conversationId }}
      search={true}
      data-queue-item={item.conversationId}
      onFocus={() => setActiveKey(item.conversationId)}
      className={cn(
        "flex flex-col gap-2 rounded-[min(var(--radius-4xl),24px)] bg-card px-4 py-3 text-card-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
        active && "ring-3 ring-ring/30",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ConversationStateChip state={item.state} />
        {item.humanTakeover ? <Chip>Automation frozen</Chip> : null}
        {item.lastDisposition !== undefined ? (
          <DispositionChip disposition={item.lastDisposition} />
        ) : null}
        {item.hasDraft ? (
          <Chip className="bg-chart-2/15 text-chart-2">Draft ready</Chip>
        ) : null}
        {item.unreadCount > 0 ? (
          <span className="ml-auto text-xs font-medium text-foreground">
            {item.unreadCount} unread
          </span>
        ) : null}
      </div>
      <p className="text-sm font-medium leading-relaxed text-foreground">
        {item.prospect?.companyName ??
          item.lastInboundFrom ??
          "Unmatched sender"}
      </p>
      <p className="text-xs text-muted-foreground">
        {item.prospect === null
          ? "No lead linked"
          : `${item.prospect.salesStage} · `}
        worked by {employeeName(item.employeeId)}
        {item.assigneeIdentityKey !== undefined
          ? " · has a human owner"
          : ""}
        {item.lastMessageAt !== undefined
          ? ` · ${formatWaited(item.lastMessageAt)}`
          : ""}
      </p>
    </Link>
  )
}

/** Expired/foreign cursor or a failed page — inside the list, not the route. */
function InboxListError({ error, reset }: ErrorComponentProps) {
  const navigate = useNavigate()
  const search = useSearch({ from: INBOX_ROUTE })
  // A stale cursor re-throws on every retry — the honest recovery is the
  // first page, reached by navigation (which also remounts the boundary).
  const cursorProblem = error instanceof Error && /cursor/i.test(error.message)
  return (
    <ErrorState
      title={
        cursorProblem
          ? "This page link is no longer valid"
          : "The inbox didn't load"
      }
      description={
        cursorProblem
          ? "The list moved on since this link was made — the page cursor it carries no longer resolves."
          : "The inbox could not be loaded. Nothing here was sent or changed."
      }
      onRetry={
        cursorProblem
          ? () =>
              void navigate({
                to: "/inbox",
                search: { ...search, cursor: undefined },
              })
          : reset
      }
      retryLabel={cursorProblem ? "Back to the first page" : "Try again"}
    />
  )
}
