/**
 * `/contacts` — everyone the agent found, what it learned about them, and
 * what happens next (ref 23).
 *
 * The container owns every Convex call on this screen and the URL state
 * behind it; the table, the filters, the bulk bar and the drawer are
 * presentational and take plain props. The list is a live subscription, which
 * is what makes rows appear while a run is in progress.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { useEffect, useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ACTION_PRICES } from "../../../convex/lib/limits"
import { InboxConnectionBanner } from "@/components/inbox-connection/InboxConnectionBanner"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { LoadingState } from "@/components/states/states"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { canEdit } from "@/lib/workspace-role"
import type { PageSize } from "@/lib/search-params"
import type { ContactsSearch } from "@/routes/_dashboard/_workspace/contacts"
import { exclusiveFilters, withContactFilters } from "./contacts-model"
import { LeadDrawer } from "./drawer/LeadDrawer"
import { BulkActionsBar } from "./filters/BulkActionsBar"
import { ContactsFilters } from "./filters/ContactsFilters"
import { NoLeadsState } from "./NoLeadsState"
import { RunStateStrip } from "./RunStateStrip"
import { ContactsTable } from "./table/ContactsTable"
import { TableFooterBar } from "./table/TableFooterBar"
import { useLeadActions } from "./use-lead-actions"

const CONTACTS_ROUTE = "/_dashboard/_workspace/contacts"

const DEFAULT_PAGE_SIZE: PageSize = 25

/** How long the search box waits before it becomes a query (and a URL). */
const SEARCH_DEBOUNCE_MS = 350

const PRICES = {
  email: ACTION_PRICES.get_email.credits,
  research: ACTION_PRICES.research_lead.credits,
}

export function ContactsPage() {
  const current = useCurrentWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Contacts"
        description="Everyone your agent found, what it learned about them, and what happens next."
      />
      {/* `null` cannot reach here — the `_workspace` gate redirects a
          membership-less user to setup — but loading is the only honest
          render for a case that resolves elsewhere. */}
      {current === undefined || current === null ? (
        <LoadingState
          title="Loading contacts"
          description="Reading this workspace's pipeline."
        />
      ) : (
        <ContactsBody
          workspaceId={current.workspace._id}
          canAct={canEdit(current.role)}
        />
      )}
    </div>
  )
}

function ContactsBody({
  workspaceId,
  canAct,
}: {
  workspaceId: Id<"workspaces">
  canAct: boolean
}) {
  const search = useSearch({ from: CONTACTS_ROUTE })
  const navigate = useNavigate()
  const actions = useLeadActions(workspaceId)

  const [selected, setSelected] = useState<Set<Id<"prospects">>>(new Set())
  const [text, setText] = useState(search.q ?? "")
  /**
   * The cursor of each page already visited, so Previous can return to one.
   * `null` is page one, which has no cursor. It lives in component state
   * because only this session has it: a link opened straight onto a later
   * page has no trail, and the footer says so rather than offering a
   * Previous that would land somewhere else.
   */
  const [trail, setTrail] = useState<(string | null)[]>([])

  const limit = search.limit ?? DEFAULT_PAGE_SIZE
  const page = useQuery(api.leads.queries.list, {
    workspaceId,
    ...(search.q !== undefined ? { text: search.q } : {}),
    ...(search.stage !== undefined ? { stage: search.stage } : {}),
    ...(search.approval !== undefined ? { approval: search.approval } : {}),
    ...(search.score !== undefined ? { score: search.score } : {}),
    ...(search.sort === "lowest" ? { lowestScoreFirst: true } : {}),
    ...(search.cursor !== undefined ? { cursor: search.cursor } : {}),
    limit,
  })
  const run = useQuery(api.leads.counts.runState, { workspaceId })
  const signals = useQuery(api.leads.counts.byStrategy, { workspaceId })
  const credits = useQuery(api.billing.credits.balance, { workspaceId })

  // The search box types faster than a query should run, and every keystroke
  // would otherwise be a history entry as well as a page of results.
  useEffect(() => {
    const trimmed = text.trim()
    if (trimmed === (search.q ?? "")) {
      return
    }
    const timer = setTimeout(() => {
      setTrail([])
      void navigate({
        to: "/contacts",
        search: (currentSearch: ContactsSearch) =>
          withContactFilters(currentSearch, {
            q: trimmed === "" ? undefined : trimmed,
          }),
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [navigate, search.q, text])

  const applyFilter = (patch: Partial<ContactsSearch>) => {
    setTrail([])
    setSelected(new Set())
    if ("q" in patch) {
      setText(patch.q ?? "")
    }
    void navigate({
      to: "/contacts",
      search: (currentSearch: ContactsSearch) =>
        withContactFilters(currentSearch, exclusiveFilters(patch)),
    })
  }

  const goToPage = (cursor: string | undefined, pageNumber: number) => {
    void navigate({
      to: "/contacts",
      search: (currentSearch: ContactsSearch) => ({
        ...currentSearch,
        cursor,
        page: pageNumber <= 1 ? undefined : pageNumber,
      }),
    })
  }

  const openLead = (prospectId: Id<"prospects">) => {
    void navigate({
      to: "/contacts",
      search: (currentSearch: ContactsSearch) => ({
        ...currentSearch,
        lead: prospectId,
      }),
    })
  }

  const closeLead = () => {
    void navigate({
      to: "/contacts",
      search: (currentSearch: ContactsSearch) => ({
        ...currentSearch,
        lead: undefined,
      }),
    })
  }

  const selectedIds = [...selected]
  const spend = {
    canAct,
    remaining: credits === undefined ? null : (credits?.remaining ?? 0),
  }
  const busy = actions.pending !== null
  const filtered =
    search.q !== undefined ||
    search.stage !== undefined ||
    search.approval !== undefined ||
    search.score !== undefined
  const pageNumber = search.page ?? 1
  const unfiltered =
    search.q === undefined &&
    search.stage === undefined &&
    search.approval === undefined &&
    search.score === undefined

  const runWith = async (
    call: (ids: Id<"prospects">[]) => Promise<void>,
    ids: Id<"prospects">[],
  ) => {
    await call(ids)
    setSelected(new Set())
  }

  return (
    <div className="flex flex-col gap-4">
      <InboxConnectionBanner workspaceId={workspaceId} />
      {run === undefined || run === null ? null : (
        <RunStateStrip
          run={run}
          onShowNeedsAttention={() => applyFilter({ stage: "needs_attention" })}
        />
      )}

      <ContactsFilters
        search={search}
        text={text}
        onText={setText}
        onFilter={applyFilter}
      />

      <BulkActionsBar
        count={selected.size}
        busy={busy}
        spend={spend}
        prices={PRICES}
        onGetEmails={() => void runWith(actions.getEmails, selectedIds)}
        onResearch={() => void runWith(actions.research, selectedIds)}
        onApprove={() =>
          void runWith((ids) => actions.decide(ids, "approved"), selectedIds)
        }
        onReject={() =>
          void runWith((ids) => actions.decide(ids, "rejected"), selectedIds)
        }
        onClear={() => setSelected(new Set())}
      />

      {actions.notice === null ? null : (
        <p
          role="status"
          className={
            actions.notice.tone === "error"
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {actions.notice.text}
        </p>
      )}

      {page === undefined ? (
        <LoadingState
          title="Loading contacts"
          description="Reading this workspace's leads."
        />
      ) : page.items.length === 0 ? (
        <NoLeadsState
          run={run ?? null}
          signals={signals ?? []}
          filtered={filtered}
          onClearFilters={() => applyFilter({ q: undefined })}
        />
      ) : (
        <>
          <ContactsTable
            leads={page.items}
            selected={selected}
            busy={busy}
            spend={spend}
            prices={PRICES}
            sortable={unfiltered}
            lowestScoreFirst={search.sort === "lowest"}
            onToggleSort={() =>
              applyFilter({
                sort: search.sort === "lowest" ? undefined : "lowest",
              })
            }
            onToggleAll={(checked) =>
              setSelected(
                checked
                  ? new Set(page.items.map((lead) => lead._id))
                  : new Set(),
              )
            }
            handlers={{
              toggle: (prospectId) =>
                setSelected((previous) => {
                  const next = new Set(previous)
                  if (!next.delete(prospectId)) {
                    next.add(prospectId)
                  }
                  return next
                }),
              open: openLead,
              getEmail: (prospectId) => void actions.getEmails([prospectId]),
              research: (prospectId) => void actions.research([prospectId]),
              approve: (prospectId) =>
                void actions.decide([prospectId], "approved"),
              reject: (prospectId) =>
                void actions.decide([prospectId], "rejected"),
            }}
          />
          <TableFooterBar
            shown={page.items.length}
            firstIndex={(pageNumber - 1) * limit + 1}
            total={page.total}
            pageSize={limit}
            canGoBack={trail.length > 0}
            canGoForward={page.hasMore && page.cursor !== null}
            onPageSize={(size) => {
              setTrail([])
              void navigate({
                to: "/contacts",
                search: (currentSearch: ContactsSearch) =>
                  withContactFilters(currentSearch, { limit: size }),
              })
            }}
            onBack={() => {
              const previous = trail[trail.length - 1] ?? null
              setTrail(trail.slice(0, -1))
              setSelected(new Set())
              goToPage(previous ?? undefined, pageNumber - 1)
            }}
            onForward={() => {
              if (page.cursor === null) {
                return
              }
              setTrail([...trail, search.cursor ?? null])
              setSelected(new Set())
              goToPage(page.cursor, pageNumber + 1)
            }}
          />
        </>
      )}

      {search.lead === undefined ? null : (
        <LeadDrawer
          workspaceId={workspaceId}
          prospectId={search.lead as Id<"prospects">}
          busy={busy}
          spend={spend}
          prices={PRICES}
          onClose={closeLead}
          onApprove={(prospectId) => void actions.decide([prospectId], "approved")}
          onReject={(prospectId) => void actions.decide([prospectId], "rejected")}
          onGetEmail={(prospectId) => void actions.getEmails([prospectId])}
          onResearch={(prospectId) => void actions.research([prospectId])}
        />
      )}
    </div>
  )
}
