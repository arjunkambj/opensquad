/**
 * "Connect inbox to start sending" — the banner the Agent and Contacts
 * screens carry while the org cannot send (PLAN §5 "Inbox step is
 * skippable", §9.3 `sourcing_only`).
 *
 * It states the consequence rather than the setting: leads keep being found
 * and researched; nothing goes out until an inbox is attached.
 *
 * Presentational — `InboxConnectionBanner` is the container that decides
 * whether it should appear at all.
 */
import { MailValidation01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function ConnectInboxBanner({
  title,
  description,
  action,
  tone = "primary",
  className,
}: {
  title: string
  description: string
  /** The link or button that resolves it. */
  action: ReactNode
  /** `attention` for a connection that broke, rather than one never made. */
  tone?: "primary" | "attention"
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3",
        tone === "attention"
          ? "border-destructive/30 bg-destructive/5"
          : "border-primary/20 bg-primary/5",
        className,
      )}
    >
      <HugeiconsIcon
        icon={MailValidation01Icon}
        strokeWidth={2}
        className={cn(
          "size-5 shrink-0",
          tone === "attention" ? "text-destructive" : "text-primary",
        )}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}
