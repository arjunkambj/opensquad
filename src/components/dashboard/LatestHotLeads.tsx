import { ArrowRight01Icon, UserGroupIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import { EmptyState } from "@/components/states/states"
import { FlameScore } from "@/components/kit/FlameScore"
import { PanelFrame, PanelRowsSkeleton } from "@/components/dashboard/PanelFrame"
import { Button } from "@/components/ui/button"

export type HotLeads = FunctionReturnType<
  typeof api.dashboard.panels.latestHotLeads
>

export function LatestHotLeads({
  leads,
  hint,
}: {
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
          // carries the score filter the panel is: Leads filters on one
          // flame score, and a bare `/leads` would open every lead.
          <Button
            render={<Link to="/leads" search={{ score: 3 }} />}
            size="xs"
            variant="ghost"
          >
            View more
            <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
          </Button>
        ) : null
      }
    >
      {leads === undefined ? (
        <PanelRowsSkeleton trailing="score" />
      ) : leads.items.length === 0 ? (
        <EmptyState
          variant="plain"
          icon={UserGroupIcon}
          title="No hot leads in this window"
          description="Your agent scores every lead it researches out of three. The ones that score three land here."
          action={
            <Button render={<Link to="/leads" />} variant="outline">
              Open leads
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col">
          {leads.items.map((lead) => (
            <li
              key={lead.prospectId}
              className="flex items-center justify-between gap-3 border-t border-border px-5 py-2.5 first:border-t-0"
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
