import type { FunctionReturnType } from "convex/server"
import type { ReactNode } from "react"
import type { api } from "../../../../convex/_generated/api"
import type { Doc } from "../../../../convex/_generated/dataModel"
import {
  DispositionChip,
  parseSender,
  sourceNote,
  StageChip,
} from "@/components/inbox/inbox-presentation"
import { Chip } from "@/components/kit/Chip"
import { Hint } from "@/components/kit/Hint"
import { formatInstant } from "@/lib/presentation"

type Detail = FunctionReturnType<typeof api.inbox.conversations.get>

export function ThreadHeader({
  conversation,
  prospect,
  subject,
  messageCount,
  actions,
}: {
  conversation: Doc<"conversations">
  prospect: Detail["prospect"]
  /** The newest subject on the thread, when a message carries one. */
  subject: string | undefined
  messageCount: number | undefined
  actions?: ReactNode
}) {
  const imported = sourceNote(conversation.source)
  const withWhom =
    conversation.lastInboundFrom === undefined
      ? prospect?.companyName
      : parseSender(conversation.lastInboundFrom).name
  const facts = [
    withWhom === undefined ? undefined : `with ${withWhom}`,
    messageCount === undefined || messageCount === 0
      ? undefined
      : `${messageCount} message${messageCount === 1 ? "" : "s"}`,
    conversation.lastInboundAt === undefined
      ? "No reply yet"
      : `last reply ${formatInstant(conversation.lastInboundAt)}`,
  ].filter((fact): fact is string => fact !== undefined)

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="font-heading text-xl font-semibold text-balance break-words text-foreground">
            {subject ?? prospect?.companyName ?? withWhom ?? "Conversation"}
          </h2>
          <p className="text-sm text-muted-foreground">{facts.join(" · ")}</p>
        </div>
        {actions === undefined ? null : <div className="shrink-0">{actions}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {prospect === null ? (
          <Chip>No lead linked</Chip>
        ) : (
          <StageChip stage={prospect.stage} />
        )}
        {conversation.lastDisposition === undefined ? null : (
          <DispositionChip disposition={conversation.lastDisposition} />
        )}
        {conversation.state === "closed" ? <Chip>Closed</Chip> : null}
        {conversation.humanTakeover ? (
          <Hint content="Your agent will not draft replies here until you resume it.">
            <Chip variant="accent">Agent paused</Chip>
          </Hint>
        ) : null}
        {imported === undefined ? null : (
          <Hint content={imported}>
            <Chip>Imported</Chip>
          </Hint>
        )}
      </div>
    </header>
  )
}
