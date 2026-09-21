/**
 * The exact subject and body that would be mailed, as stored on the draft
 * revision. The recipient sits in the card header above it.
 *
 * Plain text, rendered as text: the draft body is what the send payload
 * commits to, so nothing here reformats, truncates or marks it up.
 */
import type { Doc } from "../../../../convex/_generated/dataModel"

export function DraftPreview({ draft }: { draft: Doc<"drafts"> }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Subject:{" "}
        <span className="font-medium text-foreground">{draft.subject}</span>
      </p>
      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {draft.body}
      </p>
    </div>
  )
}
