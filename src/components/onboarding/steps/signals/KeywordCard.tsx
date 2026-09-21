import { InformationCircleIcon, Tag01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReactNode } from "react"
import { ChipInput } from "@/components/kit/ChipInput"
import { SuggestionChips } from "@/components/kit/SuggestionChips"
import { AGENT_KEYWORDS_MAX } from "../../../../../convex/lib/validators"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type KeywordCardProps = {
  keywords: string[]
  suggestions: string[]
  onChange: (next: string[]) => void
  action?: ReactNode
  disabled?: boolean
}

export function KeywordCard({
  keywords,
  suggestions,
  onChange,
  action,
  disabled = false,
}: KeywordCardProps) {
  const atMax = keywords.length >= AGENT_KEYWORDS_MAX

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-background px-4 py-4">
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-4"
            icon={Tag01Icon}
            strokeWidth={2}
          />
        </span>
        <h2 className="text-sm font-medium text-foreground">
          Keyword engagement
        </h2>
        <Tooltip>
          <TooltipTrigger
            aria-label="What keyword engagement means"
            className="rounded-full p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            type="button"
          >
            <HugeiconsIcon
              aria-hidden="true"
              className="size-4"
              icon={InformationCircleIcon}
              strokeWidth={2}
            />
          </TooltipTrigger>
          <TooltipContent>
            Your agent looks for these words on people&rsquo;s own profiles and
            their company pages, and adds whoever it finds to your leads.
          </TooltipContent>
        </Tooltip>
      </div>

      <ChipInput
        addLabel="Add a keyword"
        disabled={disabled}
        inputAriaLabel="Add a custom keyword"
        maxCount={AGENT_KEYWORDS_MAX}
        onChange={onChange}
        placeholder="e.g. ppc optimization"
        removeLabel={(value) => `Remove ${value}`}
        values={keywords}
      />

      {suggestions.length > 0 ? (
        <SuggestionChips
          action={action}
          disabled={disabled || atMax}
          label="Suggested for you — click to add"
          onAdd={(value) => {
            onChange([...keywords, value])
          }}
          suggestions={suggestions}
        />
      ) : (
        // `SuggestionChips` renders nothing when it has nothing to offer, so
        // the ask-for-more control has to live outside it — otherwise taking
        // the last suggestion would remove the way to get another.
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {keywords.length === 0
              ? "No suggestions yet — add a phrase of your own, or ask for some."
              : "You've taken every suggestion. Add your own, or ask for more."}
          </p>
          {action}
        </div>
      )}
    </div>
  )
}
