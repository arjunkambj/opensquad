/**
 * The lead's conversations and its history, at the bottom of the drawer.
 *
 * The threads come from the inbox domain's own query — the drawer asks who
 * owns conversations rather than keeping a second copy of the summary — and
 * the history is the append-only `leadEvents` trail, which is what proves a
 * stage, an approval or a charge happened.
 */
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../../convex/_generated/api"
import { formatWaited } from "@/components/shared/presentation"
import { Button } from "@/components/ui/button"
import type { ContactDetailData } from "../contacts-model"

type Conversations = FunctionReturnType<
  typeof api.inbox.conversations.listForProspect
>

export function LeadActivity({
  conversations,
  events,
  onOpenConversation,
}: {
  conversations: Conversations | undefined
  events: ContactDetailData["events"]
  onOpenConversation: (conversationId: string) => void
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">Conversation</h3>
        {conversations === undefined ? (
          <p className="text-sm text-muted-foreground">Reading threads…</p>
        ) : conversations.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No thread yet. One starts when the first email goes out.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {conversations.items.map((conversation) => (
              <li
                key={conversation.conversationId}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    {conversation.lastInboundFrom ?? "Outbound thread"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {conversation.state}
                    {conversation.unreadCount > 0
                      ? ` · ${conversation.unreadCount} unread`
                      : ""}{" "}
                    · updated {formatWaited(conversation.updatedAt)}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    onOpenConversation(conversation.conversationId)
                  }
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">History</h3>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing has happened to this lead yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((event) => (
              <li key={event._id} className="flex flex-col">
                <span className="text-sm text-foreground">{event.summary}</span>
                <span className="text-xs text-muted-foreground">
                  {formatWaited(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
