/**
 * "Latest hot leads" (reference 20) — the researched leads that scored 3 in
 * this window, newest first, with "View more" into Contacts.
 *
 * Person fields are optional on a sourced lead and are printed only when the
 * row carries them: an unnamed lead reads as "Unnamed lead" rather than
 * borrowing a name from its company or its email. The flame score comes from
 * the shared kit component, so it matches the Contacts table exactly.
 *
 * Presentational: the container owns the query.
 */
import { ArrowRight01Icon, UserGroupIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import { EmptyState } from "@/components/states/states"
import { FlameScore } from "@/components/kit/FlameScore"
import { PanelFrame } from "@/components/dashboard/PanelFrame"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export type HotLeads = FunctionReturnType<
  typeof api.dashboard.panels.latestHotLeads
>

export function LatestHotLeads({
  leads,
  hint,
}: {
  /** `undefined` while the query is still reading. */
  leads: HotLeads | undefined
  hint: string
}) {
  return (
    <PanelFrame
      icon={UserGroupIcon}
      title="Latest hot leads"
      description={`Scored 3 of 3 · ${hint}`}
      action={
        leads !== undefined && leads.items.length > 0 ? (
          // "View more" has to open the same list this panel shows, so it
          // carries the score filter the panel is: Contacts filters on one
          // flame score, and a bare `/contacts` would open every lead.
          <Button
            render={<Link to="/contacts" search={{ score: 3 }} />}
            size="sm"
            variant="ghost"
          >
            View more
            <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
          </Button>
        ) : null
      }
    >
      {leads === undefined ? (
        <div className="flex flex-col gap-2 px-5 pb-5">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      ) : leads.items.length === 0 ? (
        <EmptyState
          variant="plain"
          icon={UserGroupIcon}
          title="No hot leads in this window"
          description="Your agent scores every lead it researches out of three. The ones that score three land here."
          action={
            <Button render={<Link to="/contacts" />} size="sm" variant="outline">
              Open contacts
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col">
          {leads.items.map((lead) => (
            <li
              key={lead.prospectId}
              className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 first:border-t-0"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">
                  {lead.name ?? "Unnamed lead"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {[lead.jobTitle, lead.companyName]
                    .filter((part) => part !== undefined)
                    .join(" @ ") || "No title or company on this lead yet"}
                </span>
              </div>
              <FlameScore status="researched" score={3} />
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  )
}
