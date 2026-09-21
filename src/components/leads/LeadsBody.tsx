import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ACTION_PRICES } from "../../../convex/lib/prices"
import { useMinuteClock } from "@/hooks/use-minute-clock"
import { ActionNotice } from "./ActionNotice"
import { LeadsResultsSkeleton } from "./LeadsPageSkeleton"
import { LeadsResults } from "./LeadsResults"
import { LeadDrawer } from "./drawer/LeadDrawer"
import { BulkActionsBar } from "./filters/BulkActionsBar"
import { LeadsFilters } from "./filters/LeadsFilters"
import { NoLeadsState, StalePageState } from "./NoLeadsState"
import { RunStateStrip } from "./RunStateStrip"
import { useLeadsSearch } from "./use-leads-search"
import { useLeadActions } from "./use-lead-actions"
import { useLeadSelection } from "./use-lead-selection"

const PRICES = {
  email: ACTION_PRICES.get_email.credits,
  research: ACTION_PRICES.research_lead.credits,
}

export function LeadsBody({ orgId }: { orgId: Id<"orgs"> }) {
  const url = useLeadsSearch()
  const actions = useLeadActions(orgId)
  const selection = useLeadSelection()

  const { search, limit } = url
  const now = useMinuteClock()
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
  const run = useQuery(api.leads.counts.runState, { orgId, now })
  const signals = useQuery(api.leads.counts.byStrategy, { orgId })
  const credits = useQuery(api.billing.credits.balance, { orgId })

  const spend = {
    remaining: credits === undefined ? null : (credits?.remaining ?? 0),
  }
  const busy = actions.pending !== null

  const filterTo = (patch: Parameters<typeof url.applyFilter>[0]) => {
    selection.clear()
    url.applyFilter(patch)
  }

  const inBulk = async (
    call: (ids: Id<"prospects">[]) => Promise<void>,
    ids: Id<"prospects">[],
  ) => {
    await call(ids)
    selection.clear()
  }

  return (
    <div className="flex flex-col gap-4">
      {run === undefined || run === null ? null : (
        <RunStateStrip
          run={run}
          onShowNeedsAttention={() => filterTo({ stage: "needs_attention" })}
        />
      )}

      <LeadsFilters
        search={search}
        text={url.text}
        onText={url.setText}
        onFilter={filterTo}
      />

      {selection.selected.size === 0 ? null : (
        <BulkActionsBar
          count={selection.selected.size}
          busy={busy}
          spend={spend}
          prices={PRICES}
          onGetEmails={() => void inBulk(actions.getEmails, selection.ids)}
          onResearch={() => void inBulk(actions.research, selection.ids)}
          onApprove={() =>
            void inBulk((ids) => actions.decide(ids, "approved"), selection.ids)
          }
          onReject={() =>
            void inBulk((ids) => actions.decide(ids, "rejected"), selection.ids)
          }
          onClear={selection.clear}
        />
      )}

      {actions.notice === null ? null : (
        <ActionNotice notice={actions.notice} />
      )}

      {page === undefined ? (
        <LeadsResultsSkeleton />
      ) : page.items.length === 0 && search.cursor !== undefined ? (
        <StalePageState
          onReset={() => {
            selection.clear()
            url.resetPaging()
          }}
        />
      ) : page.items.length === 0 ? (
        // `run` and `signals` may still be reading — the zero-state is the
        // one that says so, because the reason a table is empty is the run
        // state and the per-signal counts.
        <NoLeadsState
          run={run}
          signals={signals}
          filtered={url.filtered}
          onClearFilters={() => filterTo({ q: undefined })}
        />
      ) : (
        <LeadsResults
          leads={page.items}
          selected={selection.selected}
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
            selection.replace(
              checked ? page.items.map((lead) => lead._id) : [],
            )
          }
          handlers={{
            toggle: selection.toggle,
            open: url.openLead,
            getEmail: (prospectId) => void actions.getEmails([prospectId]),
            research: (prospectId) => void actions.research([prospectId]),
            approve: (prospectId) =>
              void actions.decide([prospectId], "approved"),
            reject: (prospectId) =>
              void actions.decide([prospectId], "rejected"),
          }}
          pagination={{
            firstIndex: (url.pageNumber - 1) * limit + 1,
            total: page.total,
            pageSize: limit,
            canGoBack: url.canGoBack,
            canGoForward: page.hasMore && page.cursor !== null,
            onPageSize: (size) => {
              // A smaller page hides rows a bulk action would still spend on.
              selection.clear()
              url.setPageSize(size)
            },
            onBack: () => {
              selection.clear()
              url.goBack()
            },
            onForward: () => {
              if (page.cursor === null) {
                return
              }
              selection.clear()
              url.goForward(page.cursor)
            },
          }}
        />
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
