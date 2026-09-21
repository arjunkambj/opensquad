/**
 * Static stand-ins for the dashboard, built from the same kit the app uses
 * (FramedPanel, StatCard, Chip, FlameScore, Button) so the landing page shows
 * the product as it looks rather than a drawing of it.
 *
 * Everything here is `inert`: real buttons, switches and tabs render with
 * their real styles, but nothing takes focus, clicks, or reaches a reader.
 */
import { HugeiconsIcon } from "@hugeicons/react"
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import Logo from "@/components/layout/Logo"
import {
  sidebarFooterItems,
  sidebarOverviewItem,
  sidebarSections,
  type MenuItem,
} from "@/constants/sidebar-menu"
import { cn } from "@/lib/utils"

/** Wraps any preview so it is decoration only. */
export function AppPreview({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none text-left select-none", className)}
      inert
    >
      {children}
    </div>
  )
}

/**
 * Lays `children` out at a fixed desktop size, then scales the whole picture
 * to the frame's width, so padding, gaps and type shrink together and the
 * preview reads as a small copy of the app rather than a reflowed one.
 */
export function ScaledFrame({
  children,
  className,
  height,
  width,
}: {
  children: ReactNode
  className?: string
  height: number
  width: number
}) {
  const frame = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState<number | null>(null)

  useLayoutEffect(() => {
    const node = frame.current
    if (node === null) {
      return
    }
    const measure = () => setScale(node.clientWidth / width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [width])

  const size = {
    "--frame-height": `${height}px`,
    "--frame-ratio": `${width} / ${height}`,
    "--frame-scale": String(scale ?? 1),
    "--frame-width": `${width}px`,
  } as CSSProperties

  return (
    <div
      ref={frame}
      className={cn(
        "relative aspect-(--frame-ratio) w-full overflow-hidden",
        className,
      )}
      style={size}
    >
      <div
        className={cn(
          "absolute top-0 left-0 h-(--frame-height) w-(--frame-width) origin-top-left scale-(--frame-scale)",
          scale === null && "invisible",
        )}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * The dashboard shell at its desktop layout: a 14rem sidebar on the sidebar
 * ground, the page on an inset panel. Always the desktop layout, because it
 * is drawn inside a ScaledFrame rather than reflowed per viewport.
 */
export function PreviewShell({
  active,
  children,
  badges = {},
  className,
}: {
  active: MenuItem["href"]
  children: ReactNode
  badges?: Partial<Record<MenuItem["href"], string>>
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex size-full overflow-hidden bg-sidebar p-2 pl-0 text-foreground",
        className,
      )}
    >
      <nav className="flex w-56 shrink-0 flex-col px-3">
        <div className="px-2 pt-1.5 pb-3">
          <Logo markClassName="size-6" />
        </div>
        <PreviewNavItem
          item={sidebarOverviewItem}
          active={active === sidebarOverviewItem.href}
        />
        {sidebarSections.map((section) => (
          <div key={section.label} className="flex flex-col">
            <p className="px-2.5 pt-3 pb-1.5 text-2xs tracking-wide text-muted-foreground/70 uppercase">
              {section.label}
            </p>
            {section.items.map((item) => (
              <PreviewNavItem
                key={item.href}
                item={item}
                active={active === item.href}
                badge={badges[item.href]}
              />
            ))}
          </div>
        ))}
        <div className="mt-auto flex flex-col pt-6">
          {sidebarFooterItems.map((item) => (
            <PreviewNavItem
              key={item.href}
              item={item}
              active={active === item.href}
              badge={badges[item.href]}
            />
          ))}
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-hidden rounded-2xl bg-panel px-8 py-8 ring-1 ring-sidebar-border/60">
        {children}
      </div>
    </div>
  )
}

function PreviewNavItem({
  item,
  active,
  badge,
}: {
  item: MenuItem
  active: boolean
  badge?: string
}) {
  return (
    <div
      className={cn(
        "flex h-8 items-center gap-2 rounded-xl pr-2.5 pl-2.5 text-sm",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground",
      )}
    >
      <HugeiconsIcon icon={item.icon} className="size-4 shrink-0" />
      <span className="truncate">{item.name}</span>
      {badge === undefined ? null : (
        <span className="ml-auto text-xs font-medium text-muted-foreground tabular-nums">
          {badge}
        </span>
      )}
    </div>
  )
}

/** A list row as the dashboard panels draw it: two lines left, one thing right. */
export function PreviewRow({
  title,
  detail,
  end,
}: {
  title: string
  detail: string
  end?: ReactNode
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </div>
      {end === undefined ? null : <div className="shrink-0">{end}</div>}
    </li>
  )
}

/**
 * The glass mat every landing preview sits on, over a forest backdrop.
 * `className` sizes the mat; the backdrop fills the parent.
 */
export function PreviewMat({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "rounded-marketing-preview bg-background/40 p-1.5 shadow-xl shadow-foreground/10 backdrop-blur-md sm:p-2",
        className,
      )}
    >
      {children}
    </div>
  )
}
