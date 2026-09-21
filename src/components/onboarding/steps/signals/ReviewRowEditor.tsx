/**
 * The body of one review row: what changing this answer affects, and the
 * button back to the step that wrote it (reference 11).
 *
 * Presentational. It exists as its own component so the review screen hands
 * the jump down as a JSX prop rather than passing a callback into the call
 * that builds the rows — rows are built during render, and a callback given
 * to that call is one React has to assume render can invoke.
 */
import { Button } from "@/components/ui/button"

export type ReviewRowEditorProps = {
  /** One line on what changing this answer affects. */
  hint: string
  /** Off while a step change or the confirm is already in flight. */
  disabled: boolean
  onEdit: () => void
}

export function ReviewRowEditor({
  hint,
  disabled,
  onEdit,
}: ReviewRowEditorProps) {
  return (
    <div className="flex flex-col gap-2 px-4 pb-4">
      <p className="text-sm text-muted-foreground">{hint}</p>
      <div>
        <Button
          disabled={disabled}
          onClick={onEdit}
          size="sm"
          type="button"
          variant="outline"
        >
          Change this
        </Button>
      </div>
    </div>
  )
}
