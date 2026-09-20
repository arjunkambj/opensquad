/**
 * What research learned about this lead, in the drawer.
 *
 * A score exists only on a researched lead (PLAN §7), so this switches on the
 * research variant rather than rendering an absent score as zero: not
 * researched, running, failed and researched are four different things to say,
 * and only the last one has prose behind it.
 *
 * The hooks are `evidence` rows — observations with the page they came from.
 * Nothing here is synthesised on the client.
 */
import { LinkSquare02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { LeadResearch } from "../../../../convex/lib/validators"
import { FlameScore } from "@/components/kit/FlameScore"
import { formatWaited } from "@/components/shared/presentation"
import type { ContactDetailData } from "../contacts-model"
import { LEAD_ERROR_COPY } from "../contacts-model"

export function LeadResearchPanel({
  research,
  evidence,
}: {
  research: LeadResearch
  evidence: ContactDetailData["evidence"]
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">Research</h3>
        {research.status === "researched" ? (
          <FlameScore status="researched" score={research.aiScore} />
        ) : (
          <FlameScore status={research.status} />
        )}
      </div>

      {research.status === "not_researched" ? (
        <p className="text-sm text-muted-foreground">
          Nobody has researched this lead yet. Researching reads the company's
          site and scores the fit.
        </p>
      ) : null}

      {research.status === "researching" ? (
        <p className="text-sm text-muted-foreground">
          Research is running right now. The score appears here when it lands.
        </p>
      ) : null}

      {research.status === "failed" ? (
        <p className="text-sm text-destructive">
          {LEAD_ERROR_COPY[research.lastError.code]} Last tried{" "}
          {formatWaited(research.lastError.at)} · attempt{" "}
          {research.lastError.attempts}.
        </p>
      ) : null}

      {research.status === "researched" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-foreground">
            {research.summary}
          </p>
          <div className="rounded-2xl bg-muted px-4 py-3">
            <p className="text-xs font-medium text-foreground">
              Why it scored {research.aiScore} of 3
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {research.aiScoreReason}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Researched {formatWaited(research.researchedAt)}.
          </p>
        </div>
      ) : null}

      {evidence.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium text-foreground">
            Personalisation hooks
          </h4>
          <ul className="flex flex-col gap-2">
            {evidence.map((row) => (
              <li
                key={row._id}
                className="rounded-2xl border border-border px-4 py-3"
              >
                <p className="text-sm text-foreground">{row.observation}</p>
                <a
                  href={row.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <HugeiconsIcon
                    icon={LinkSquare02Icon}
                    strokeWidth={2}
                    className="size-3"
                  />
                  Source
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
