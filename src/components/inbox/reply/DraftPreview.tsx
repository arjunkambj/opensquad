/**
 * The exact bytes that would be mailed — recipient, subject and body, as
 * stored on the draft revision.
 *
 * Plain text, rendered as text: the draft body is what the send payload
 * commits to, so nothing here reformats, truncates or marks it up.
 */
import type { Doc } from "../../../../convex/_generated/dataModel"

export function DraftPreview({ draft }: { draft: Doc<"drafts"> }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-muted/60 px-4 py-3">
      <p className="text-xs text-muted-foreground">
        To {draft.normalizedRecipient}
      </p>
      <p className="text-sm font-medium text-foreground">{draft.subject}</p>
      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {draft.body}
      </p>
    </div>
  )
}
