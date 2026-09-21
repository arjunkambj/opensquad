import { Button } from "@/components/ui/button"

export type ReviewRowEditorProps = {
  hint: string
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
