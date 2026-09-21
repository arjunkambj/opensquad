/**
 * What the last bulk action did, in one line.
 *
 * A live status rather than a toast: an action over a selection can partly
 * succeed ("emails found for 3 of 5"), and that sentence has to stay on screen
 * next to the rows it is about.
 */
import type { LeadActionNotice } from "./use-lead-actions"

export function ActionNotice({ notice }: { notice: LeadActionNotice }) {
  return (
    <p
      role="status"
      className={
        notice.tone === "error"
          ? "text-sm text-destructive"
          : "text-sm text-muted-foreground"
      }
    >
      {notice.text}
    </p>
  )
}
