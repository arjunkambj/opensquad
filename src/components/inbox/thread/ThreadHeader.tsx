/**
 * The reading pane's header: who the thread is with, what state it is in and
 * which agent's work runs on it.
 */
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../../convex/_generated/api"
import type { Doc } from "../../../../convex/_generated/dataModel"
import {
  DispositionChip,
  sourceNote,
} from "@/components/inbox/inbox-presentation"
import { Chip } from "@/components/kit/Chip"
import { formatInstant } from "@/lib/presentation"

type Detail = FunctionReturnType<typeof api.inbox.conversations.get>

export function ThreadHeader({
  conversation,
  prospect,
  agent,
}: {
  conversation: Doc<"conversations">
  prospect: Detail["prospect"]
  agent: Detail["agent"]
}) {
  const imported = sourceNote(conversation.source)
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {conversation.state === "closed" ? <Chip>Closed</Chip> : null}
        {conversation.state === "unassigned" ? <Chip>No lead linked</Chip> : null}
        {conversation.humanTakeover ? <Chip>Automation paused here</Chip> : null}
        {conversation.lastDisposition === undefined ? null : (
          <DispositionChip disposition={conversation.lastDisposition} />
        )}
      </div>
      <h2 className="font-heading text-xl font-semibold text-foreground">
        {prospect?.companyName ??
          conversation.lastInboundFrom ??
          "Conversation"}
      </h2>
      <p className="text-sm text-muted-foreground">
        {conversation.lastInboundAt === undefined
          ? "No reply on this thread yet."
          : `Last reply ${formatInstant(conversation.lastInboundAt)}`}
        {agent === null ? "" : ` · ${agent.name === "" ? "Your agent" : agent.name}`}
      </p>
      {imported === undefined ? null : (
        <p className="max-w-2xl text-xs text-muted-foreground">{imported}</p>
      )}
    </header>
  )
}
