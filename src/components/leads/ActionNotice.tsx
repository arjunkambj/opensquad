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
