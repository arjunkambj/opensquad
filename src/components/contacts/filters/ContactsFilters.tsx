/**
 * The search and filter bar (ref 23).
 *
 * One filter at a time, and the bar SAYS so: each filter is a separate index
 * range on the backend, and a pair with no index behind it refuses rather than
 * post-filtering a page. Choosing a second filter therefore replaces the
 * first, and the active one is shown as a chip the user can clear — so the
 * exchange is visible instead of silent.
 */
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { LEAD_STAGES } from "../../../../convex/lib/validators"
import type { LeadApproval, LeadStage } from "../../../../convex/lib/validators"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import type {
  ContactsSearch,
  LeadScoreFilter,
} from "@/routes/_dashboard/_org/contacts"
import { APPROVAL_LABEL, STAGE_LABEL } from "../contacts-model"

const APPROVALS: readonly LeadApproval[] = ["pending", "approved", "rejected"]

const SCORES: readonly LeadScoreFilter[] = [3, 2, 1]

export function ContactsFilters({
  search,
  text,
  onText,
  onFilter,
}: {
  search: ContactsSearch
  text: string
  onText: (value: string) => void
  onFilter: (patch: Partial<ContactsSearch>) => void
}) {
  const active: { label: string; clear: () => void }[] = []
  if (search.stage !== undefined) {
    active.push({
      label: `Stage: ${STAGE_LABEL[search.stage]}`,
      clear: () => onFilter({ stage: undefined }),
    })
  }
  if (search.approval !== undefined) {
    active.push({
      label: `Approval: ${APPROVAL_LABEL[search.approval]}`,
      clear: () => onFilter({ approval: undefined }),
    })
  }
  if (search.score !== undefined) {
    active.push({
      label: `AI score: ${search.score} of 3`,
      clear: () => onFilter({ score: undefined }),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-64 flex-1">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search contacts by company"
            className="pl-9"
            placeholder="Search by company"
            value={text}
            onChange={(event) => onText(event.target.value)}
          />
        </div>

        <NativeSelect
          aria-label="Filter by stage"
          className="w-44"
          value={search.stage ?? ""}
          onChange={(event) =>
            onFilter({
              stage: (event.target.value || undefined) as LeadStage | undefined,
            })
          }
        >
          <option value="">Every stage</option>
          {LEAD_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABEL[stage]}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Filter by approval"
          className="w-40"
          value={search.approval ?? ""}
          onChange={(event) =>
            onFilter({
              approval: (event.target.value || undefined) as
                | LeadApproval
                | undefined,
            })
          }
        >
          <option value="">Any decision</option>
          {APPROVALS.map((approval) => (
            <option key={approval} value={approval}>
              {APPROVAL_LABEL[approval]}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Filter by AI score"
          className="w-36"
          value={search.score === undefined ? "" : String(search.score)}
          onChange={(event) =>
            onFilter({
              score:
                event.target.value === ""
                  ? undefined
                  : (Number(event.target.value) as LeadScoreFilter),
            })
          }
        >
          <option value="">Any score</option>
          {SCORES.map((score) => (
            <option key={score} value={score}>
              {score} of 3
            </option>
          ))}
        </NativeSelect>
      </div>

      {active.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Filtering by one thing at a time:
          </span>
          {active.map((chip) => (
            <Button
              key={chip.label}
              size="xs"
              variant="secondary"
              onClick={chip.clear}
            >
              {chip.label}
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
