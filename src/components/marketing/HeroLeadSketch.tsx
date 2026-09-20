import {
  ArrowUpRight01Icon,
  Clock01Icon,
  ShieldCheckIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { FlameScore } from "@/components/kit/FlameScore"

const signals = ["Recently funded", "Hiring marketers"] as const

const reasons = [
  "Funded last quarter",
  "Three marketing roles open",
] as const

const stages = ["Found", "Researched", "Approved", "Emailing", "Reply"] as const
const reachedStages = 3

/**
 * A schematic of one lead the way the app lays it out: the role that matched,
 * the signals that found it, the 1–3 score, and the first email waiting for
 * approval.
 *
 * Deliberately anonymous. It shows a role and a company shape, never a person
 * or a company anyone could look up, and nothing on it is a result we are
 * claiming — it is a sketch of the screen, not a screenshot of a run.
 */
export function HeroLeadSketch() {
  return (
    <div
      aria-label="Schematic preview of a lead in OpenIntent: the role that matched, the signals that found it, its score, and the first email waiting for approval"
      className="relative w-full overflow-hidden rounded-2xl bg-background text-foreground select-none sm:min-h-[560px]"
      role="img"
    >
      <div aria-hidden="true" className="flex flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
          <span className="text-xs text-muted-foreground">Contacts</span>
          <span className="text-xs text-muted-foreground">/</span>
          <span className="truncate text-xs font-medium">Lead</span>
          <span className="ml-auto rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Schematic
          </span>
        </div>

        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
                VP Marketing
              </h3>
              <p className="text-xs text-muted-foreground">
                at a 200-person SaaS company
              </p>
            </div>
            <div className="flex items-center gap-2">
              <FlameScore score={3} status="researched" />
              <span className="inline-flex items-center rounded-lg bg-muted px-2.5 py-1 text-xs font-medium">
                Review mode
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {signals.map((signal) => (
              <span
                className="inline-flex h-6 items-center rounded-lg bg-secondary px-2.5 text-xs font-medium text-secondary-foreground"
                key={signal}
              >
                {signal}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {stages.map((stage, index) => (
              <div className="flex min-w-0 flex-1 flex-col gap-1.5" key={stage}>
                <span
                  className={
                    index < reachedStages
                      ? "h-1.5 rounded-full bg-primary"
                      : "h-1.5 rounded-full bg-border"
                  }
                />
                <span className="truncate text-[10px] text-muted-foreground">
                  {stage}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 rounded-xl bg-muted p-3.5">
            <span className="text-xs font-medium text-muted-foreground">
              Why this lead
            </span>
            <ul className="flex flex-col gap-1.5">
              {reasons.map((reason) => (
                <li className="text-xs leading-snug" key={reason}>
                  {reason}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col overflow-hidden rounded-xl bg-muted p-1.5">
            <div className="flex flex-col gap-1.5 px-3 py-2.5 text-xs">
              <div className="flex gap-2">
                <span className="w-14 shrink-0 text-muted-foreground">
                  From
                </span>
                <span className="truncate">Your own sending inbox</span>
              </div>
              <div className="flex gap-2">
                <span className="w-14 shrink-0 text-muted-foreground">To</span>
                <span className="truncate">The lead above</span>
              </div>
            </div>
            <div className="flex flex-col gap-2.5 rounded-lg bg-background px-4 py-4 text-sm leading-relaxed">
              <p>Hi there,</p>
              <p className="hidden sm:block">
                You are hiring marketers and have nothing automating the
                follow-up yet — that is usually the point this gets painful.
              </p>
              <p>Worth fifteen minutes next week?</p>
              <p className="text-xs text-muted-foreground">
                Reply &ldquo;stop&rdquo; and you will not hear from me again.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
              <span className="inline-flex h-7 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground">
                Approve and send
                <HugeiconsIcon className="size-3.5" icon={ArrowUpRight01Icon} />
              </span>
              <span className="inline-flex h-7 items-center rounded-xl bg-background px-3 text-xs font-medium">
                Edit
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <HugeiconsIcon className="size-3.5" icon={Clock01Icon} />
                Goes out in your sending window
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-3 pb-1.5 text-xs text-muted-foreground">
              <HugeiconsIcon
                className="size-3.5 shrink-0"
                icon={ShieldCheckIcon}
              />
              Checked against your blocklist first
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
