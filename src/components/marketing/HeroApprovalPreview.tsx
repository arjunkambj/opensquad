import {
  ArrowUpRight01Icon,
  DashboardSquare01Icon,
  InboxIcon,
  Link01Icon,
  Search01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
import Logo from "@/components/layout/Logo"
import { CompanyMark } from "@/components/marketing/CompanyMark"
import { cn } from "@/lib/utils"

const navItems: {
  label: string
  icon: IconSvgElement
  count?: number
  active?: boolean
}[] = [
  { label: "Leads", icon: UserGroupIcon },
  { label: "Inbox", icon: InboxIcon, count: 3, active: true },
  { label: "Overview", icon: DashboardSquare01Icon },
]

const evidence = [
  {
    label: "Launching a new booking flow this quarter",
    domain: "northwind.example.com",
  },
  {
    label: "Current booking form breaks on mobile",
    domain: "northwind.example.com/book",
  },
]

const prospectFacts = [
  { label: "Stage", value: "Draft ready" },
  { label: "Owner", value: "Researcher" },
  { label: "Contact", value: "Sienna Whitlock, Ops" },
  { label: "Next action", value: "Approve first email" },
]

function MockButton({
  children,
  tone = "outline",
}: {
  children: ReactNode
  tone?: "primary" | "outline"
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-medium whitespace-nowrap",
        tone === "primary"
          ? "bg-primary text-primary-foreground"
          : "bg-muted",
      )}
    >
      {children}
    </span>
  )
}

/**
 * Static, non-interactive mockup of the draft approval screen.
 * All names and domains are fictional demo data.
 */
export function HeroApprovalPreview() {
  return (
    <div
      aria-label="Illustrative preview of an OpenIntent draft approval screen, where a human reviews an exact email before it sends"
      className="relative w-full overflow-hidden rounded-2xl bg-background text-foreground select-none sm:min-h-[600px]"
      role="img"
    >
      <div aria-hidden="true" className="flex h-full">
        <aside className="hidden w-52 shrink-0 flex-col gap-1 border-r border-border p-4 md:flex">
          <Logo
            className="pointer-events-none mb-5 px-2"
            markClassName="size-6"
          />
          {navItems.map((item) => (
            <div
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm",
                item.active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground",
              )}
              key={item.label}
            >
              <HugeiconsIcon className="size-4" icon={item.icon} />
              {item.label}
              {item.count ? (
                <span className="ml-auto flex size-5 items-center justify-center rounded-md bg-illustration-accent text-[10px] font-semibold text-illustration-accent-foreground">
                  {item.count}
                </span>
              ) : null}
            </div>
          ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
            <span className="text-xs text-muted-foreground">Inbox</span>
            <span className="text-xs text-muted-foreground">/</span>
            <span className="truncate text-xs font-medium">
              Draft approval
            </span>
            <span className="ml-auto hidden items-center gap-2 rounded-lg bg-muted px-2.5 py-1 text-xs text-muted-foreground sm:inline-flex">
              <HugeiconsIcon className="size-3.5" icon={Search01Icon} />
              Search leads
            </span>
            <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Illustrative preview
            </span>
          </div>

          <div className="flex min-w-0 flex-1 gap-5 p-4 sm:p-6">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <h3 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
                    Approve first email
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Prepared by Outreach for Northwind Studio
                  </p>
                </div>
                <span className="inline-flex items-center rounded-lg bg-muted px-2.5 py-1 text-xs font-medium">
                  Ready to send
                </span>
              </div>

              <div className="flex flex-col overflow-hidden rounded-xl bg-muted p-1.5">
                <div className="flex flex-col gap-1.5 px-3 py-2.5 text-xs">
                  <div className="flex gap-2">
                    <span className="w-14 shrink-0 text-muted-foreground">
                      To
                    </span>
                    <span className="truncate">
                      Sienna Whitlock &lt;sienna@northwind.example.com&gt;
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-14 shrink-0 text-muted-foreground">
                      Subject
                    </span>
                    <span className="truncate font-medium">
                      Your new booking flow
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-3 rounded-lg bg-background px-4 py-4 text-sm leading-relaxed">
                  <p>Hi Sienna,</p>
                  <p>
                    I saw Northwind is launching a new booking flow this
                    quarter. We help studios ship booking pages that convert,
                    usually in about three weeks.
                  </p>
                  <p className="hidden sm:block">
                    Would a short call next week be useful? Happy to share two
                    recent examples first.
                  </p>
                  <p>Best, Arjun</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 font-mono text-[10px] text-muted-foreground">
                  <span>Revision 2</span>
                  <span>sha256 · 9f3c…a41e</span>
                  <span className="hidden sm:inline">
                    Approving sends this exact text
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Evidence
                </span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {evidence.map((item) => (
                    <div
                      className="flex items-start gap-2.5 rounded-xl bg-muted p-3"
                      key={item.domain}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-illustration-accent text-illustration-accent-foreground">
                        <HugeiconsIcon className="size-3.5" icon={Link01Icon} />
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-xs font-medium leading-snug">
                          {item.label}
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {item.domain}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <MockButton tone="primary">
                  Approve and send
                  <HugeiconsIcon
                    className="size-3.5"
                    icon={ArrowUpRight01Icon}
                  />
                </MockButton>
                <MockButton>Request changes</MockButton>
                <MockButton>Reject</MockButton>
              </div>
            </div>

            <div className="hidden w-60 shrink-0 flex-col gap-3 lg:flex">
              <div className="flex flex-col gap-3 rounded-xl bg-muted p-4">
                <div className="flex items-center gap-2.5">
                  <CompanyMark className="size-9 rounded-lg" company="Northwind Studio" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      Northwind Studio
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      northwind.example.com
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {prospectFacts.map((fact) => (
                    <div
                      className="flex items-center justify-between gap-2 text-xs"
                      key={fact.label}
                    >
                      <span className="text-muted-foreground">
                        {fact.label}
                      </span>
                      <span className="truncate font-medium">{fact.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2 rounded-xl bg-muted p-4">
                <span className="text-xs font-medium">Campaign</span>
                <span className="text-xs text-muted-foreground">
                  Studios launching booking flows
                </span>
                <div className="mt-1 flex gap-1">
                  {[0, 1, 2, 3, 4].map((index) => (
                    <span
                      className={cn(
                        "h-1.5 flex-1 rounded-full",
                        index < 3
                          ? "bg-illustration-accent"
                          : "bg-border",
                      )}
                      key={index}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  3 of 5 leads researched
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
