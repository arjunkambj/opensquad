/**
 * The pagination footer (ref 23): "Showing x to y of z" on the left, the page
 * size on the right.
 *
 * `z` is a BOUNDED count — Convex has no count API, so the backend reads up to
 * a bound and says whether there is more. Past the bound the footer says
 * "200+" rather than a truncated number pretending to be a total.
 *
 * Going back needs the cursor of the previous page, which only this session
 * has. A link opened straight onto a later page can therefore go forward or
 * start over, and says so instead of offering a Previous that would lie.
 */
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { PAGE_SIZES, type PageSize } from "@/lib/search-params"

export function TableFooterBar({
  shown,
  firstIndex,
  total,
  pageSize,
  canGoBack,
  canGoForward,
  onPageSize,
  onBack,
  onForward,
}: {
  /** Rows on this page. */
  shown: number
  /** 1-based index of the first row on this page. */
  firstIndex: number
  total: { count: number; hasMore: boolean }
  pageSize: PageSize
  canGoBack: boolean
  canGoForward: boolean
  onPageSize: (size: PageSize) => void
  onBack: () => void
  onForward: () => void
}) {
  const last = firstIndex + Math.max(0, shown - 1)
  const totalLabel = total.hasMore ? `${total.count}+` : `${total.count}`

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-sm text-muted-foreground">
        {shown === 0
          ? "Showing no contacts"
          : `Showing ${firstIndex} to ${last} of ${totalLabel} contacts`}
      </p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Show
          <NativeSelect
            aria-label="Contacts per page"
            className="w-20"
            value={String(pageSize)}
            onChange={(event) =>
              onPageSize(Number(event.target.value) as PageSize)
            }
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </NativeSelect>
          per page
        </label>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={!canGoBack}
            onClick={onBack}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canGoForward}
            onClick={onForward}
          >
            Next
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
          </Button>
        </div>
      </div>
    </div>
  )
}
