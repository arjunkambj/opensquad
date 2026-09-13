import {
  AiChipIcon,
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
  /** When false the control is intentionally disabled — nothing is faked. */
  action?: { label: string }
  note?: string
}

/**
 * Integrations and the Codex runtime connection.
 *
 * Every row here is an HONEST pending/unavailable state: the runtime bridge
 * (`convex/runtimeConnections.ts`, owner connect/reconnect/disconnect) ships
 * with P07, and provider extraction gates belong to P04/P05. No endpoint
 * exists today, so no row offers a fake "Connect" that could succeed — the
 * buttons are disabled and the copy says what is missing and what will land.
 *
 * Working controls vs awaiting-P07: the Workspace, Sending policy, Automation
 * and Members sections on this page are functional today; this section is the
 * explicitly pending one.
 */
export function IntegrationsSection({
  workspace,
  isOwner,
}: {
  workspace: Doc<"workspaces">
  isOwner: boolean
}) {
  const rows: IntegrationRow[] = [
    {
      icon: AiChipIcon,
      name: "Codex runtime",
      description:
        "The workspace's isolated Codex App Server inside its own ASCII Box — employees cannot run without it.",
      status: "Awaiting runtime bridge (P07)",
      action: { label: "Connect" },
      note: isOwner
        ? "Owner-only connect/reconnect/disconnect arrive with the runtime bridge. Until then this control is intentionally disabled."
        : "Only the workspace owner manages the runtime connection once it ships.",
    },
    {
      icon: PlugIcon,
      name: "Apollo",
      description:
        "Company discovery and contact enrichment source used by Scout inside the runtime.",
      status: "Pending provider gate (P04)",
      note: "Scoped through the runtime tool policy — never a raw key in the browser.",
    },
    {
      icon: Globe02Icon,
      name: "Firecrawl",
      description:
        "Backend-owned website research for Researcher. Runs server-side via the crawl component.",
      status: "Backend-managed — no user connection",
      note: "Configured by deployment env, not per-workspace login.",
    },
    {
      icon: Mail01Icon,
      name: "AgentMail inbox",
      description:
        "The sending inbox employees use for approved email. Assigned by the backend.",
      status:
        workspace.inboxRef !== undefined
          ? "Assigned"
          : "Not assigned — arrives with P05/P10",
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
          Runtime and provider connections. These are pending — nothing here is
          simulated or implied to be connected.
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
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
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
