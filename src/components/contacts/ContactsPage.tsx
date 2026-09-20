/**
 * `/contacts` — everyone the agent found, what it learned about them, and
 * what happens next (ref 23).
 *
 * The container owns every Convex call on this screen; the table, the
 * filters, the bulk bar and the drawer are presentational and take plain
 * props, and the URL state behind them is `use-contacts-search.ts`. The list
 * is a live subscription, which is what makes rows appear while a run is in
 * progress.
 */
import { useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ACTION_PRICES } from "../../../convex/lib/limits"
import { InboxConnectionBanner } from "@/components/inbox-connection/InboxConnectionBanner"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { LoadingState } from "@/components/states/states"
import { useCurrentOrg } from "@/hooks/use-current-org"
import { LeadDrawer } from "./drawer/LeadDrawer"
import { BulkActionsBar } from "./filters/BulkActionsBar"
import { ContactsFilters } from "./filters/ContactsFilters"
import { NoLeadsState } from "./NoLeadsState"
import { RunStateStrip } from "./RunStateStrip"
import { ContactsTable } from "./table/ContactsTable"
import { TableFooterBar } from "./table/TableFooterBar"
import { useContactsSearch } from "./use-contacts-search"
import { useLeadActions } from "./use-lead-actions"

const PRICES = {
  email: ACTION_PRICES.get_email.credits,
  research: ACTION_PRICES.research_lead.credits,
}

export function ContactsPage() {
  const current = useCurrentOrg()

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Contacts"
        description="Everyone your agent found, what it learned about them, and what happens next."
      />
      {/* Anything but `ready` cannot reach here — the `_org` gate sends a
          caller with no organization row to setup — but loading is the only
          honest render for a case that resolves elsewhere. */}
      {current.status === "ready" ? (
        <ContactsBody orgId={current.org._id} />
      ) : (
        <LoadingState
          title="Loading contacts"
          description="Reading this organization's pipeline."
        />
      )}
    </div>
  )
}

function ContactsBody({ orgId }: { orgId: Id<"orgs"> }) {
  const url = useContactsSearch()
  const actions = useLeadActions(orgId)
  const [selected, setSelected] = useState<Set<Id<"prospects">>>(new Set())

  const { search, limit } = url
  const page = useQuery(api.leads.queries.list, {
    orgId,
    ...(search.q !== undefined ? { text: search.q } : {}),
    ...(search.stage !== undefined ? { stage: search.stage } : {}),
    ...(search.approval !== undefined ? { approval: search.approval } : {}),
    ...(search.score !== undefined ? { score: search.score } : {}),
    ...(search.sort === "lowest" ? { lowestScoreFirst: true } : {}),
    ...(search.cursor !== undefined ? { cursor: search.cursor } : {}),
    limit,
  })
  const run = useQuery(api.leads.counts.runState, { orgId })
  const signals = useQuery(api.leads.counts.byStrategy, { orgId })
  const credits = useQuery(api.billing.credits.balance, { orgId })

  const selectedIds = [...selected]
  const clearSelection = () => setSelected(new Set())
  const spend = {
    remaining: credits === undefined ? null : (credits?.remaining ?? 0),
  }
  const busy = actions.pending !== null

  const filterTo = (patch: Parameters<typeof url.applyFilter>[0]) => {
    clearSelection()
    url.applyFilter(patch)
  }

  const inBulk = async (
    call: (ids: Id<"prospects">[]) => Promise<void>,
    ids: Id<"prospects">[],
  ) => {
    await call(ids)
    clearSelection()
  }

  return (
    <div className="flex flex-col gap-4">
      <InboxConnectionBanner orgId={orgId} />
      {run === undefined || run === null ? null : (
        <RunStateStrip
          run={run}
          onShowNeedsAttention={() => filterTo({ stage: "needs_attention" })}
        />
      )}

      <ContactsFilters
        search={search}
        text={url.text}
        onText={url.setText}
        onFilter={filterTo}
      />

      <BulkActionsBar
        count={selected.size}
        busy={busy}
        spend={spend}
        prices={PRICES}
        onGetEmails={() => void inBulk(actions.getEmails, selectedIds)}
        onResearch={() => void inBulk(actions.research, selectedIds)}
        onApprove={() =>
          void inBulk((ids) => actions.decide(ids, "approved"), selectedIds)
        }
        onReject={() =>
          void inBulk((ids) => actions.decide(ids, "rejected"), selectedIds)
        }
        onClear={clearSelection}
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
          description="Reading this organization's leads."
        />
      ) : page.items.length === 0 ? (
        <NoLeadsState
          run={run ?? null}
          signals={signals ?? []}
          filtered={url.filtered}
          onClearFilters={() => filterTo({ q: undefined })}
        />
      ) : (
        <>
          <ContactsTable
            leads={page.items}
            selected={selected}
            busy={busy}
            spend={spend}
            prices={PRICES}
            sortable={!url.filtered}
            lowestScoreFirst={search.sort === "lowest"}
            onToggleSort={() =>
              filterTo({
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
              open: url.openLead,
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
            firstIndex={(url.pageNumber - 1) * limit + 1}
            total={page.total}
            pageSize={limit}
            canGoBack={url.canGoBack}
            canGoForward={page.hasMore && page.cursor !== null}
            onPageSize={url.setPageSize}
            onBack={() => {
              clearSelection()
              url.goBack()
            }}
            onForward={() => {
              if (page.cursor === null) {
                return
              }
              clearSelection()
              url.goForward(page.cursor)
            }}
          />
        </>
      )}

      {search.lead === undefined ? null : (
        <LeadDrawer
          orgId={orgId}
          prospectId={search.lead as Id<"prospects">}
          busy={busy}
          spend={spend}
          prices={PRICES}
          onClose={url.closeLead}
          onApprove={(prospectId) =>
            void actions.decide([prospectId], "approved")
          }
          onReject={(prospectId) =>
            void actions.decide([prospectId], "rejected")
          }
          onGetEmail={(prospectId) => void actions.getEmails([prospectId])}
          onResearch={(prospectId) => void actions.research([prospectId])}
        />
      )}
    </div>
  )
}
