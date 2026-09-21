import type { ReactNode } from "react"
import { ChipInput } from "@/components/kit/ChipInput"
import { SuggestionChips } from "@/components/kit/SuggestionChips"
import { AGENT_KEYWORDS_MAX } from "../../../../../convex/lib/validators"

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
    <div className="flex flex-col gap-4">
      <ChipInput
        addLabel="Add more"
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
          label="Suggested — click to add"
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
          <p className="text-xs text-muted-foreground">No suggestions left.</p>
          {action}
        </div>
      )}
    </div>
  )
}
