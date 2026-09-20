/**
 * The blocklist's page footer: how many entries match, and the way through
 * them.
 *
 * Keyset pagination, so the controls are Back and Next rather than numbered
 * pages: the query knows where the NEXT page starts, and the pages already
 * walked are remembered by the caller. There is no page number to show that
 * would survive a row being added while someone reads.
 */
import { Button } from "@/components/ui/button"
import { CardFooter } from "@/components/ui/card"

export type BlocklistPagerProps = {
  /** Entries matching the current filter, across every page. */
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
    <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm text-muted-foreground">
      <span>
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
    </CardFooter>
  )
}
