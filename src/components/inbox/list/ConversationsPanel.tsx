/**
 * The conversation list of reference 24: the "Conversations" header with its
 * count and search, the four filter pills, and the rows themselves.
 *
 * This is the container — it owns the one Convex read behind all of it and
 * the URL contract the pills, the search box and the cursor travel in. The
 * pieces below it are presentational.
 */
import {
  CatchBoundary,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { ConversationRow } from "@/components/inbox/list/ConversationRow"
import { InboxEmptyRows } from "@/components/inbox/list/InboxEmptyRows"
import { InboxPills } from "@/components/inbox/list/InboxPills"
import { InboxSearchField } from "@/components/inbox/list/InboxSearchField"
import { ErrorState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useQueueNavigation } from "@/hooks/use-queue-navigation"
import { boundedCount } from "@/lib/bounded-count"
import { withFilters } from "@/lib/search-params"
import type { InboxSearch } from "@/routes/_dashboard/_workspace/inbox"

const INBOX_ROUTE = "/_dashboard/_workspace/inbox"

export function ConversationsPanel({
  workspaceId,
}: {
  workspaceId: Id<"workspaces">
}) {
  const search = useSearch({ from: INBOX_ROUTE })
  const navigate = useNavigate()
  const pill = search.pill ?? "received"

  const page = useQuery(api.inbox.inboxList.list, {
    workspaceId,
    pill,
    ...(search.q === undefined ? {} : { q: search.q }),
    ...(search.cursor === undefined ? {} : { cursor: search.cursor }),
    ...(search.limit === undefined ? {} : { limit: search.limit }),
  })

  // j/k move focus between the rows, and closing a thread gives focus back
  // to the row that opened it.
  const params = useParams({ strict: false })
  const { setActiveKey } = useQueueNavigation({
    items: page?.items ?? [],
    keyOf: (row) => row.conversationId,
    detailOpen: params.conversationId !== undefined,
  })

  const setSearch = (changes: Partial<InboxSearch>) =>
    void navigate({ to: "/inbox", search: withFilters(search, changes) })

  return (
    <section
      aria-label="Conversations"
      className="flex flex-col gap-4 rounded-[min(var(--radius-4xl),24px)] border border-border bg-card p-4"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Conversations
          </h2>
          <p className="text-xs text-muted-foreground">
            {page === undefined
              ? "Counting…"
              : `${boundedCount(page.count.value, page.count.hasMore)} conversation${
                  page.count.value === 1 && !page.count.hasMore ? "" : "s"
                }`}
          </p>
        </div>
        <InboxSearchField
          key={search.q ?? ""}
          value={search.q}
          onChange={(q) => setSearch({ q })}
        />
      </header>

      <InboxPills active={pill} search={search} />

      <CatchBoundary
        getResetKey={() => `${pill}:${search.q ?? ""}:${search.cursor ?? ""}`}
        errorComponent={(props: ErrorComponentProps) => (
          <ErrorState
            title="This page of the inbox could not be read"
            description={
              props.error instanceof Error
                ? props.error.message
                : "The link may point at a page that no longer exists."
            }
            onRetry={() => setSearch({ cursor: undefined })}
            retryLabel="Back to the first page"
          />
        )}
      >
        {page === undefined ? (
          <LoadingState title="Loading conversations" />
        ) : page.items.length === 0 ? (
          <InboxEmptyRows
            pill={pill}
            searched={page.searched}
            hasCursor={search.cursor !== undefined}
            onReset={() => setSearch({ cursor: undefined, q: undefined })}
          />
        ) : (
          <ol className="flex flex-col gap-1">
            {page.items.map((row) => (
              <li key={row.conversationId}>
                <ConversationRow
                  row={row}
                  search={search}
                  onFocus={() => setActiveKey(row.conversationId)}
                />
              </li>
            ))}
          </ol>
        )}

        {page !== undefined && page.searched && page.hasMore ? (
          <p className="text-xs text-muted-foreground">
            Showing the first {page.items.length} matches. Narrow the company
            name to see fewer.
          </p>
        ) : null}

        {page !== undefined && !page.searched ? (
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={search.cursor === undefined}
              onClick={() => setSearch({ cursor: undefined })}
            >
              First page
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!page.hasMore || page.cursor === null}
              onClick={() =>
                page.cursor === null
                  ? undefined
                  : setSearch({ cursor: page.cursor })
              }
            >
              Older
            </Button>
          </div>
        ) : null}
      </CatchBoundary>
    </section>
  )
}
