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
import { ConversationRowsSkeleton } from "@/components/inbox/InboxPageSkeleton"
import { ConversationRow } from "@/components/inbox/list/ConversationRow"
import { InboxEmptyRows } from "@/components/inbox/list/InboxEmptyRows"
import { InboxPills } from "@/components/inbox/list/InboxPills"
import { InboxSearchField } from "@/components/inbox/list/InboxSearchField"
import { ErrorState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useQueueNavigation } from "@/hooks/use-queue-navigation"
import { boundedCount } from "@/lib/bounded-count"
import { withFilters } from "@/lib/search-params"
import type { InboxSearch } from "@/routes/_dashboard/_org/inbox"

const INBOX_ROUTE = "/_dashboard/_org/inbox"

export function ConversationsPanel({
  orgId,
}: {
  orgId: Id<"orgs">
}) {
  const search = useSearch({ from: INBOX_ROUTE })
  const navigate = useNavigate()
  const pill = search.pill ?? "received"

  const page = useQuery(api.inbox.inboxList.list, {
    orgId,
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
      className="flex flex-col overflow-hidden rounded-card border border-border xl:min-h-0 xl:flex-1 xl:rounded-none xl:border-0"
    >
      <header className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="font-heading text-base font-semibold text-foreground">
              Conversations
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {page === undefined
                ? null
                : boundedCount(page.count.value, page.count.hasMore)}
            </span>
          </div>
          <InboxSearchField
            key={search.q ?? ""}
            value={search.q}
            onChange={(q) => setSearch({ q })}
          />
        </div>
        <InboxPills active={pill} search={search} />
      </header>

      <CatchBoundary
        getResetKey={() => `${pill}:${search.q ?? ""}:${search.cursor ?? ""}`}
        errorComponent={(props: ErrorComponentProps) => (
          <div className="p-4">
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
          </div>
        )}
      >
        <div className="min-h-0 flex-1 xl:overflow-y-auto">
          {page === undefined ? (
            <ConversationRowsSkeleton />
          ) : page.items.length === 0 ? (
            <InboxEmptyRows
              pill={pill}
              searched={page.searched}
              query={search.q}
              hasCursor={search.cursor !== undefined}
              onReset={() => setSearch({ cursor: undefined, q: undefined })}
              onShowAll={() =>
                setSearch({ pill: "all", cursor: undefined, q: undefined })
              }
            />
          ) : (
            <ol className="flex flex-col divide-y divide-border">
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
            <p className="px-4 py-3 text-xs text-muted-foreground">
              Showing the first {page.items.length} matches. Narrow the company
              name to see fewer.
            </p>
          ) : null}
        </div>

        {page !== undefined &&
        !page.searched &&
        (page.hasMore || search.cursor !== undefined) ? (
          <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={search.cursor === undefined}
              onClick={() => setSearch({ cursor: undefined })}
            >
              Newest
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
          </footer>
        ) : null}
      </CatchBoundary>
    </section>
  )
}
