import { useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import type { EvidenceConfidence } from "../../../convex/lib/validators"
import {
  Chip,
  formatInstant,
  formatWaited,
} from "@/components/shared/presentation"
import {
  EmptyState,
  LoadingState,
} from "@/components/states/states"
import { Button } from "@/components/ui/button"

const CONFIDENCE_LABEL: Record<EvidenceConfidence, string> = {
  supported: "Supported — the source states this",
  hypothesis: "Hypothesis — the researcher's labeled guess",
  unknown: "Unverified",
}

/**
 * The lead's source-backed research: `prospect.sourceRefs` (where it was
 * FOUND) plus the `evidence` rows a research run wrote about it (what was
 * learned). Pages are appended through "Show more" — each mounted page is
 * its own live query, so nothing is a stale snapshot of something that
 * moved.
 */
export function LeadEvidence({
  workspaceId,
  prospect,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  prospect: Doc<"prospects">
  timezone: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2 rounded-xl bg-card p-5">
        <h3 className="text-sm font-medium">What research found</h3>
        <EvidencePage
          workspaceId={workspaceId}
          prospectId={prospect._id}
          timezone={timezone}
          cursor={undefined}
        />
      </section>
    </div>
  )
}

/**
 * One page of `evidence.listForProspect`, plus the mounted "show more" tail.
 * The tail mounts the NEXT page as a sibling query — the same recursive-page
 * pattern the activity tab uses, so a live first page and snapshot tails can
 * never disagree about order.
 */
function EvidencePage({
  workspaceId,
  prospectId,
  timezone,
  cursor,
}: {
  workspaceId: Id<"workspaces">
  prospectId: Id<"prospects">
  timezone: string
  cursor: string | undefined
}) {
  const page = useQuery(api.evidence.listForProspect, {
    workspaceId,
    prospectId,
    ...(cursor === undefined ? {} : { cursor }),
  })
  const [showMore, setShowMore] = useState(false)

  if (page === undefined) {
    return (
      <LoadingState
        title="Loading evidence"
        description="Reading what research recorded about this lead."
      />
    )
  }

  return (
    <>
      {page.items.length === 0 && cursor === undefined ? (
        <EmptyState
          title="No evidence yet"
          description="A research mission records source-backed observations here — each with the page it came from and whether the page stated it or the researcher inferred it."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {page.items.map((item) => (
            <EvidenceRow key={item._id} item={item} timezone={timezone} />
          ))}
        </ul>
      )}
      {page.hasMore && page.cursor !== null ? (
        showMore ? (
          <EvidencePage
            workspaceId={workspaceId}
            prospectId={prospectId}
            timezone={timezone}
            cursor={page.cursor}
          />
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setShowMore(true)}
          >
            Show earlier evidence
          </Button>
        )
      ) : null}
    </>
  )
}

function EvidenceRow({
  item,
  timezone,
}: {
  item: Doc<"evidence">
  timezone: string
}) {
  return (
    <li className="flex flex-col gap-1.5 rounded-lg bg-muted/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          className={
            item.confidence === "supported"
              ? "bg-chart-2/15 text-chart-2"
              : item.confidence === "hypothesis"
                ? "bg-chart-4/15 text-chart-4"
                : undefined
          }
        >
          {CONFIDENCE_LABEL[item.confidence]}
        </Chip>
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 truncate text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {item.sourceUrl}
        </a>
        <span className="ml-auto text-xs text-muted-foreground">
          {formatWaited(item.retrievedAt)}
        </span>
      </div>
      <p className="text-sm text-foreground">{item.observation}</p>
      {item.excerpt !== "" ? (
        <blockquote className="border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
          {item.excerpt}
        </blockquote>
      ) : null}
      <p className="text-xs text-muted-foreground">
        retrieved {formatInstant(item.retrievedAt, timezone)}
      </p>
    </li>
  )
}
