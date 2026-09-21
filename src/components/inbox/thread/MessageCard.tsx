/** The one shape every message on a thread takes: who, to whom, when, then the text. */
import type { ReactNode } from "react"
import { PersonAvatar } from "@/components/inbox/inbox-presentation"
import { cn } from "@/lib/utils"

export function MessageCard({
  as: Tag = "li",
  sender,
  badge,
  meta,
  time,
  subject,
  children,
  footer,
  className,
}: {
  as?: "li" | "div"
  sender: string
  badge?: ReactNode
  /** Beside the sender: an address or a recipient. */
  meta?: ReactNode
  time?: ReactNode
  subject?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <Tag
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-border bg-background p-4",
        className,
      )}
    >
      <header className="flex items-center gap-3">
        <PersonAvatar name={sender} className="size-8" />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium text-foreground">
            {sender}
          </span>
          {meta === undefined ? null : (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {meta}
            </span>
          )}
          {badge}
        </div>
        {time === undefined ? null : (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {time}
          </span>
        )}
      </header>
      {/* The body lines up with the sender's name, as a mail client reads. */}
      <div className="flex flex-col gap-3 sm:pl-11">
        {subject === undefined ? null : (
          <p className="text-sm font-medium text-foreground">{subject}</p>
        )}
        {children}
        {footer}
      </div>
    </Tag>
  )
}

/** The conventional signature delimiter: a line of `--`, optionally with a trailing space. */
const SIGNATURE_DELIMITER = /\n--[ \t]?\n/

/**
 * Plain text, rendered as text. Trailing blank lines are dropped and a
 * signature after the `--` delimiter is set quieter than the message itself.
 */
export function MessageBody({ children }: { children: string }) {
  const text = children.replace(/\s+$/, "")
  const split = SIGNATURE_DELIMITER.exec(text)
  const message = split === null ? text : text.slice(0, split.index).replace(/\s+$/, "")
  const signature =
    split === null ? undefined : text.slice(split.index + split[0].length).trim()

  return (
    <div className="flex flex-col gap-2">
      {message.length === 0 ? null : (
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
          {message}
        </p>
      )}
      {signature === undefined || signature.length === 0 ? null : (
        <p className="text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
          {signature}
        </p>
      )}
    </div>
  )
}
