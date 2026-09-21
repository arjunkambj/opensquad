import { cn } from "@/lib/utils"

export function LogoMark({
  className,
  title,
}: {
  className?: string
  title?: string
}) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn("size-8 shrink-0", className)}
      role={title ? "img" : undefined}
      viewBox="0 0 256 256"
    >
      <path
        d="M198 24H99C53 24 15 58 15 100V162L58 198V232H157C204 232 241 202 241 158V92L198 58ZM182 72V142C182 169 168 184 143 184H72V110C72 86 89 72 112 72Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  )
}

export default function Logo({
  className,
  markOnly = true,
  markClassName,
  labelClassName,
}: {
  className?: string
  markOnly?: boolean
  markClassName?: string
  /** For the collapsed rail, which hides the word and keeps the mark. */
  labelClassName?: string
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2.5 text-foreground",
        className,
      )}
    >
      <LogoMark
        className={markClassName}
        title={markOnly ? "OpenIntent" : undefined}
      />
      {!markOnly && (
        <span
          className={cn(
            "font-display text-lg leading-none font-semibold tracking-tight",
            labelClassName,
          )}
        >
          OpenIntent
        </span>
      )}
    </div>
  )
}
