import {
  Globe02Icon,
  Mail01Icon,
  PlugIcon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Doc } from "../../../convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type IntegrationRow = {
  icon: IconSvgElement
  name: string
  description: string
  status: string
  /** `live` is the only state allowed to look green — pending and
   *  backend-managed rows stay visually pending, never "connected". */
  live?: boolean
  /** When false the control is intentionally disabled — nothing is faked. */
  action?: { label: string }
  note?: string
}

/**
 * Provider integrations. Every row below is an honest state — Firecrawl is
 * backend-managed and the AgentMail inbox is assigned by the backend — so
 * nothing here offers a control that could lie.
 */
export function IntegrationsSection({
  workspace,
  isOwner,
}: {
  workspace: Doc<"workspaces">
  isOwner: boolean
}) {
  void isOwner
  const rows: IntegrationRow[] = [
    {
      icon: PlugIcon,
      name: "Lead sourcing",
      description:
        "The B2B data source sourced leads come from. Configured server-side.",
      status: "Not connected yet",
      note: "Scoped server-side — never a raw key in the browser.",
    },
    {
      icon: Globe02Icon,
      name: "Firecrawl",
      description:
        "Backend-owned website research. Runs server-side via the crawl component.",
      status: "Backend-managed — no user connection",
      note: "Configured by deployment env, not per-workspace login.",
    },
    {
      icon: Mail01Icon,
      name: "AgentMail inbox",
      description:
        "The sending inbox approved email goes out through. Assigned by the backend.",
      status:
        workspace.inboxRef !== undefined ? "Assigned" : "Not assigned yet",
      live: workspace.inboxRef !== undefined,
      note:
        workspace.inboxRef !== undefined
          ? "Inbox reference is set on this workspace."
          : "No inbox is attached to this workspace yet.",
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>
          Provider connections. Nothing here is simulated or implied to be
          connected.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.map((row) => (
          <div
            key={row.name}
            className="flex items-start gap-3 rounded-2xl border border-border px-4 py-3"
          >
            <HugeiconsIcon
              icon={row.icon}
              strokeWidth={2}
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{row.name}</p>
                <span
                  className={
                    row.live === true
                      ? "rounded-full bg-chart-2/15 px-2 py-0.5 text-xs text-chart-2"
                      : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  }
                >
                  {row.status}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {row.description}
              </p>
              {row.note !== undefined ? (
                <p className="text-xs text-muted-foreground">{row.note}</p>
              ) : null}
            </div>
            {row.action !== undefined ? (
              <Button variant="outline" size="sm" disabled>
                {row.action.label}
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
