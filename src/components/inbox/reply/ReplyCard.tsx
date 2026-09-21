/** Approval is bound to this revision; editing creates another revision and withdraws the old ask. */
import { PencilEdit02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../../convex/_generated/api"
import type { Doc, Id } from "../../../../convex/_generated/dataModel"
import { ReplyCardSkeleton } from "@/components/inbox/InboxPageSkeleton"
import { DraftPreview } from "@/components/inbox/reply/DraftPreview"
import { ReplyActions } from "@/components/inbox/reply/ReplyActions"
import { SendStatus } from "@/components/inbox/reply/SendStatus"
import { sendBlockCopy } from "@/components/inbox/reply/send-block-copy"
import { useMinuteClock } from "@/hooks/use-minute-clock"
import { MessageCard } from "@/components/inbox/thread/MessageCard"
import { Chip } from "@/components/kit/Chip"

export function ReplyCard({
  orgId,
  conversation,
  agentName,
}: {
  orgId: Id<"orgs">
  conversation: Doc<"conversations">
  agentName: string
}) {
  const draftId = conversation.currentDraftId
  const draft = useQuery(
    api.outreach.drafts.get,
    draftId === undefined ? "skip" : { orgId, draftId },
  )
  const verdicts = useQuery(
    api.outreach.approvals.listForDraft,
    draftId === undefined ? "skip" : { orgId, draftId },
  )
  // Refresh time-dependent preflight answers with a coarse client clock.
  const now = useMinuteClock()
  const preflight = useQuery(
    api.outreach.sendPreflight.preflight,
    draftId === undefined ? "skip" : { orgId, draftId, now },
  )

  if (draftId === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <HugeiconsIcon
          icon={PencilEdit02Icon}
          strokeWidth={1.75}
          className="size-4 shrink-0"
          aria-hidden="true"
        />
        No draft waiting — your agent writes one when the lead replies.
      </p>
    )
  }

  if (draft === undefined || verdicts === undefined || preflight === undefined) {
    return <ReplyCardSkeleton />
  }

  return (
    <LoadedReply
      orgId={orgId}
      draft={draft}
      verdicts={verdicts}
      preflight={preflight}
      agentName={agentName}
    />
  )
}

function LoadedReply({
  orgId,
  draft,
  verdicts,
  preflight,
  agentName,
}: {
  orgId: Id<"orgs">
  draft: Doc<"drafts">
  verdicts: Doc<"approvals">[]
  preflight: FunctionReturnType<typeof api.outreach.sendPreflight.preflight>
  agentName: string
}) {
  const approved = verdicts.some((verdict) => verdict.decision === "approved")
  const changesAsked =
    !approved && verdicts.some((verdict) => verdict.decision === "rejected")
  // Before an approval exists the boundary always stops at that gate, so the
  // later gates — window, daily limit, suppression — have not been evaluated.
  // Reporting "waiting for you" is the honest reading of that code.
  const blocked =
    !preflight.permitted && preflight.code !== "no_current_approval"

  return (
    <MessageCard
      as="div"
      sender={agentName}
      badge={
        <Chip
          variant={approved ? "success" : "accent"}
          className="px-2 py-0.5"
        >
          {approved ? "Approved" : "Draft"}
        </Chip>
      }
      meta={`to ${draft.normalizedRecipient}`}
      time={
        draft.createdBy === "system"
          ? `revision ${draft.revision}`
          : `edited · revision ${draft.revision}`
      }
      className="ring-3 ring-primary/5"
      footer={
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {blocked ? (
            <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-foreground">
              {sendBlockCopy(preflight.code)}
            </p>
          ) : null}

          {changesAsked ? (
            <p className="text-sm text-muted-foreground">
              You asked for changes on this revision. Edit it, or wait for your
              agent to rewrite it.
            </p>
          ) : null}

          <ReplyActions orgId={orgId} draft={draft} approved={approved} />

          <SendStatus
            orgId={orgId}
            draftId={draft._id}
            attempts={preflight.attempts}
          />
        </div>
      }
    >
      <DraftPreview draft={draft} />
    </MessageCard>
  )
}
