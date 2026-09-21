/**
 * The Contacts container: every Convex read this screen makes, the selection
 * the bulk bar acts on, and the URL state behind the filters
 * (`use-contacts-search.ts`).
 *
 * Everything below it is presentational and takes plain props. The list is a
 * live subscription, which is what makes rows appear while a run is in
 * progress.
 */
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ACTION_PRICES } from "../../../convex/lib/prices"
import { InboxConnectionBanner } from "@/components/inbox-connection/InboxConnectionBanner"
import { LoadingState } from "@/components/states/states"
import { ActionNotice } from "./ActionNotice"
import { ContactsResults } from "./ContactsResults"
import { LeadDrawer } from "./drawer/LeadDrawer"
import { BulkActionsBar } from "./filters/BulkActionsBar"
import { ContactsFilters } from "./filters/ContactsFilters"
import { NoLeadsState } from "./NoLeadsState"
import { RunStateStrip } from "./RunStateStrip"
import { useContactsSearch } from "./use-contacts-search"
import { useLeadActions } from "./use-lead-actions"
import { useLeadSelection } from "./use-lead-selection"

const PRICES = {
  email: ACTION_PRICES.get_email.credits,
  research: ACTION_PRICES.research_lead.credits,
}

export function ContactsBody({ orgId }: { orgId: Id<"orgs"> }) {
  const url = useContactsSearch()
  const actions = useLeadActions(orgId)
  const selection = useLeadSelection()

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

      {actions.notice === null ? null : (
        <ActionNotice notice={actions.notice} />
      )}

      {page === undefined ? (
        <LoadingState
          title="Loading contacts"
          description="Reading this organization's leads."
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
        <ContactsResults
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
            onPageSize: url.setPageSize,
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
