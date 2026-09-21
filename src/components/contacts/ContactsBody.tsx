import { Link, useNavigate } from "@tanstack/react-router"
import { ContactBookIcon } from "@hugeicons/core-free-icons"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ACTION_PRICES } from "../../../convex/lib/prices"
import { ActionNotice } from "@/components/leads/ActionNotice"
import { StalePageState } from "@/components/leads/NoLeadsState"
import { RunStateStrip } from "@/components/leads/RunStateStrip"
import { LeadDrawer } from "@/components/leads/drawer/LeadDrawer"
import { TableFooterBar } from "@/components/leads/table/TableFooterBar"
import { useLeadActions } from "@/components/leads/use-lead-actions"
import { useLeadSelection } from "@/components/leads/use-lead-selection"
import { useMinuteClock } from "@/hooks/use-minute-clock"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { ContactsResultsSkeleton } from "./ContactsPageSkeleton"
import { ContactsTable } from "./ContactsTable"
import { RevealBar } from "./RevealBar"
import { useContactsSearch } from "./use-contacts-search"

const PRICES = {
  email: ACTION_PRICES.get_email.credits,
  research: ACTION_PRICES.research_lead.credits,
}

export function ContactsBody({ orgId }: { orgId: Id<"orgs"> }) {
  const url = useContactsSearch()
  const actions = useLeadActions(orgId)
  const selection = useLeadSelection()

  const navigate = useNavigate()
  const now = useMinuteClock()

  const { search, limit } = url
  const page = useQuery(api.leads.queries.listRevealable, {
    orgId,
    ...(search.cursor !== undefined ? { cursor: search.cursor } : {}),
    limit,
  })
  const run = useQuery(api.leads.counts.runState, { orgId, now })
  const credits = useQuery(api.billing.credits.balance, { orgId })

  const spend = {
    remaining: credits === undefined ? null : (credits?.remaining ?? 0),
  }
  const busy = actions.pending !== null

  const reveal = async (prospectIds: Id<"prospects">[]) => {
    await actions.getEmails(prospectIds)
    selection.clear()
  }

  return (
    <div className="flex flex-col gap-4">
      {run === undefined || run === null ? null : (
        <RunStateStrip
          run={run}
          onShowNeedsAttention={() =>
            void navigate({
              to: "/leads",
              search: { stage: "needs_attention" },
            })
          }
        />
      )}

      {selection.selected.size === 0 ? null : (
        <RevealBar
          count={selection.selected.size}
          busy={busy}
          spend={spend}
          price={PRICES.email}
          onReveal={() => void reveal(selection.ids)}
          onClear={selection.clear}
        />
      )}

      {actions.notice === null ? null : (
        <ActionNotice notice={actions.notice} />
      )}

      {page === undefined ? (
        <ContactsResultsSkeleton />
      ) : page.items.length === 0 && search.cursor !== undefined ? (
        <StalePageState
          onReset={() => {
            selection.clear()
            url.resetPaging()
          }}
        />
      ) : page.items.length === 0 ? (
        <EmptyState
          variant="plain"
          icon={ContactBookIcon}
          title="Nobody left to reveal"
          description="Every lead your agent found has had its email looked up. New finds land here."
          action={
            <Button size="sm" variant="outline" render={<Link to="/leads" />}>
              Open leads
            </Button>
          }
        />
      ) : (
        <>
          <ContactsTable
            contacts={page.items}
            selected={selection.selected}
            busy={busy}
            spend={spend}
            price={PRICES.email}
            onToggle={selection.toggle}
            onToggleAll={(checked) =>
              selection.replace(
                checked ? page.items.map((contact) => contact._id) : [],
              )
            }
            onOpen={url.openLead}
            onReveal={(prospectId) => void reveal([prospectId])}
          />
          <TableFooterBar
            noun="contacts"
            shown={page.items.length}
            firstIndex={(url.pageNumber - 1) * limit + 1}
            total={page.total}
            pageSize={limit}
            canGoBack={url.canGoBack}
            canGoForward={page.hasMore && page.cursor !== null}
            onPageSize={(size) => {
              // A smaller page hides rows Reveal emails would still spend on.
              selection.clear()
              url.setPageSize(size)
            }}
            onBack={() => {
              selection.clear()
              url.goBack()
            }}
            onForward={() => {
              if (page.cursor === null) {
                return
              }
              selection.clear()
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
