import { Button } from "@/components/ui/button"

export type BlocklistPagerProps = {
  matched: number
  filtered: boolean
  canGoBack: boolean
  canGoNext: boolean
  onBack: () => void
  onNext: () => void
}

export function BlocklistPager({
  matched,
  filtered,
  canGoBack,
  canGoNext,
  onBack,
  onNext,
}: BlocklistPagerProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">
        {matched} {matched === 1 ? "entry" : "entries"}
        {filtered ? " match this filter" : " blocked"}
      </span>
      <span className="flex items-center gap-2">
        <Button
          disabled={!canGoBack}
          onClick={onBack}
          size="sm"
          type="button"
          variant="outline"
        >
          Back
        </Button>
        <Button
          disabled={!canGoNext}
          onClick={onNext}
          size="sm"
          type="button"
          variant="outline"
        >
          Next
        </Button>
      </span>
    </div>
  )
}
