/** Placeholders for the inbox route and its panes. Each mirrors the markup it
 * stands in for, so the split layout does not shift when data lands. */
import { useParams } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { LineSkeleton } from "@/components/leads/table/ProspectTableSkeleton"
import {
  PageTitleSkeleton,
  SkeletonRegion,
} from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** The whole `/inbox` route while the organization loads: the title where
 *  the panes stack, the list pane, and the open thread or the start pane. */
export function InboxPageSkeleton() {
  const params = useParams({ strict: false })
  const threadOpen = params.conversationId !== undefined

  return (
    <SkeletonRegion label="Loading your inbox">
      <div className="xl:hidden">
        <PageTitleSkeleton />
      </div>
      <div className="flex min-w-0 flex-col gap-6 xl:-m-8 xl:grid xl:h-[calc(100svh-1rem)] xl:min-h-[34rem] xl:grid-cols-[23rem_minmax(0,1fr)] xl:gap-0 xl:overflow-hidden xl:rounded-2xl">
        <div
          className={cn(
            "min-h-0 min-w-0 xl:flex xl:flex-col xl:border-r xl:border-border",
            threadOpen && "hidden",
          )}
        >
          <ConversationsPanelSkeleton />
        </div>
        <div className="order-first min-h-0 min-w-0 xl:order-none xl:overflow-y-auto xl:px-8 xl:py-6">
          {threadOpen ? <ConversationPaneBodySkeleton /> : <StartPaneBodySkeleton />}
        </div>
      </div>
    </SkeletonRegion>
  )
}

/** Mirrors `ConversationsPanel`: heading, search, pills, then rows. */
function ConversationsPanelSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-border xl:min-h-0 xl:flex-1 xl:rounded-none xl:border-0">
      <div className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="flex h-6 items-center">
            <Skeleton shape="full" className="h-4 w-32" />
          </span>
          <Skeleton shape="xl" className="size-8" />
        </div>
        <Skeleton shape="xl" className="h-8 w-full sm:max-w-sm xl:max-w-none" />
      </div>
      <ConversationRowsSkeleton />
    </div>
  )
}

/** Mirrors `ConversationRow`: avatar, name and time, company, then chips. */
export function ConversationRowsSkeleton() {
  return (
    <ol aria-label="Loading conversations" className="flex flex-col divide-y divide-border">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex gap-3 px-4 py-3">
          <Skeleton shape="full" className="size-9 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <LineSkeleton className="w-32" />
              <LineSkeleton size="xs" className="w-8" />
            </div>
            <LineSkeleton size="xs" className="w-24" />
            <div className="mt-1 flex gap-1.5">
              <Skeleton shape="lg" className="h-6 w-20" />
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** The start pane while the organization loads. Like the real "select a
 *  conversation" prompt it only shows where the panes sit side by side. */
export function InboxStartPaneSkeleton() {
  return (
    <SkeletonRegion label="Loading your inbox" className="hidden h-full xl:flex">
      <StartPaneBodySkeleton />
    </SkeletonRegion>
  )
}

function StartPaneBodySkeleton() {
  return (
    <div className="hidden h-full flex-col items-center justify-center gap-3 px-6 py-14 xl:flex">
      <Skeleton shape="xl" className="size-9" />
      <Skeleton shape="full" className="h-4 w-44" />
      <Skeleton shape="full" className="h-5 w-56" />
    </div>
  )
}

/** Mirrors `ConversationPane`: header with its actions, messages, reply and notes. */
export function ConversationPaneSkeleton() {
  return (
    <SkeletonRegion label="Loading the conversation">
      <ConversationPaneBodySkeleton />
    </SkeletonRegion>
  )
}

function ConversationPaneBodySkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="xl:hidden">
        <Skeleton shape="xl" className="h-7 w-40" />
      </div>

      {/* Mirrors `ThreadHeader`: subject and facts, the thread actions beside
          them, then the stage and disposition chips. */}
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="flex h-7 items-center">
              <Skeleton shape="full" className="h-5 w-2/3" />
            </span>
            <LineSkeleton className="w-72 max-w-full" />
          </div>
          <div className="flex shrink-0 gap-2">
            <Skeleton shape="xl" className="h-8 w-32" />
            <Skeleton shape="xl" className="h-8 w-28" />
            <Skeleton shape="xl" className="size-8" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton shape="lg" className="h-6 w-20" />
          <Skeleton shape="lg" className="h-6 w-24" />
        </div>
      </div>

      <MessagesSkeleton />
      <ReplyCardSkeleton />
      <SectionSkeleton>
        <NotesSkeleton />
        <Skeleton shape="xl" className="h-16 w-full" />
        <Skeleton shape="xl" className="h-8 w-24" />
      </SectionSkeleton>
    </div>
  )
}

/** Mirrors `ThreadTimeline`: message cards, oldest first. */
export function MessagesSkeleton() {
  return (
    <ol aria-label="Loading messages" className="flex flex-col gap-3">
      <MessageCardSkeleton lines={["w-full", "w-11/12", "w-2/5"]} />
      <MessageCardSkeleton lines={["w-full", "w-3/5"]} />
    </ol>
  )
}

/** Mirrors `MessageCard`: avatar, sender and meta, time, then the body. */
function MessageCardSkeleton({
  as: Tag = "li",
  lines,
  className,
  footer,
}: {
  as?: "li" | "div"
  lines: string[]
  className?: string
  footer?: ReactNode
}) {
  return (
    <Tag
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-border bg-background p-4",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton shape="full" className="size-8 shrink-0" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <LineSkeleton className="w-28" />
          <LineSkeleton size="xs" className="w-40" />
        </div>
        <LineSkeleton size="xs" className="w-16" />
      </div>
      <div className="flex flex-col sm:pl-11">
        {lines.map((width, index) => (
          <div key={index} className={width}>
            <LineSkeleton />
          </div>
        ))}
      </div>
      {footer}
    </Tag>
  )
}

/** Mirrors the loaded reply: a message card with its approval footer. */
export function ReplyCardSkeleton() {
  return (
    <MessageCardSkeleton
      as="div"
      lines={["w-full", "w-full", "w-4/5", "w-1/3"]}
      className="ring-3 ring-primary/5"
      footer={
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton shape="xl" className="h-8 w-36" />
            <Skeleton shape="xl" className="h-8 w-20" />
            <Skeleton shape="xl" className="h-8 w-32" />
          </div>
          <LineSkeleton size="xs" className="w-3/5" />
        </div>
      }
    />
  )
}

/** Mirrors a flat `PageSection`: heading, one-line description, then the body. */
function SectionSkeleton({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-6">
      <div className="flex flex-col gap-1">
        <span className="flex h-6 items-center">
          <Skeleton shape="full" className="h-4 w-20" />
        </span>
        <LineSkeleton className="w-3/4" />
      </div>
      {children}
    </section>
  )
}

/** Mirrors the notes list in `ConversationNotes`. */
export function NotesSkeleton() {
  return (
    <ul aria-label="Loading notes" className="flex flex-col gap-2">
      {["w-4/5", "w-1/2"].map((width) => (
        <li key={width} className="rounded-lg bg-muted/60 px-3 py-2">
          <div className={width}>
            <LineSkeleton />
          </div>
          <div className="mt-1">
            <LineSkeleton size="xs" className="w-32" />
          </div>
        </li>
      ))}
    </ul>
  )
}
