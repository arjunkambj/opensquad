import * as React from "react"
import { cn } from "cn"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-lg bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-data-[slot=input-group]:bg-input in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

function getMetaKeyLabel() {
  return typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl"
}

function formatMetaShortcut(metaKey: string, shortcut: string) {
  const key = shortcut.toUpperCase()
  return metaKey === "⌘" ? `${metaKey}${key}` : `${metaKey}+${key}`
}

function MetaKbd({
  shortcut,
  className,
  ...props
}: React.ComponentProps<"kbd"> & { shortcut: string }) {
  const metaKey = getMetaKeyLabel()
  return (
    <Kbd className={className} {...props}>
      {formatMetaShortcut(metaKey, shortcut)}
    </Kbd>
  )
}

export { Kbd, KbdGroup, MetaKbd }
