/** Approval is bound to this revision; editing creates another revision and withdraws the old ask. */
import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../../convex/_generated/api"
import type { Doc, Id } from "../../../../convex/_generated/dataModel"
import { DraftPreview } from "@/components/inbox/reply/DraftPreview"
import { ReplyActions } from "@/components/inbox/reply/ReplyActions"
import { SendStatus } from "@/components/inbox/reply/SendStatus"
import { sendBlockCopy } from "@/components/inbox/reply/send-block-copy"
import { useMinuteClock } from "@/hooks/use-minute-clock"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function ReplyCard({
  orgId,
  conversation,
}: {
  orgId: Id<"orgs">
  conversation: Doc<"conversations">
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
      <Card>
        <CardHeader>
          <CardTitle>No reply waiting</CardTitle>
          <CardDescription>
            When a reply lands on a thread your agent started, it writes the
            answer here for you to approve. Threads it did not start, and mail
            imported from before you connected the inbox, are never answered.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (draft === undefined || verdicts === undefined || preflight === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reading the reply…</CardTitle>
        </CardHeader>
      </Card>
    )
  }

  return (
    <LoadedReply
      orgId={orgId}
      draft={draft}
      verdicts={verdicts}
      preflight={preflight}
    />
  )
}

function LoadedReply({
  orgId,
  draft,
  verdicts,
  preflight,
}: {
  orgId: Id<"orgs">
  draft: Doc<"drafts">
  verdicts: Doc<"approvals">[]
  preflight: FunctionReturnType<typeof api.outreach.sendPreflight.preflight>
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
    <Card>
      <CardHeader>
        <CardTitle>
          {approved ? "Approved reply" : "Suggested reply"}
        </CardTitle>
        <CardDescription>
          {draft.createdBy === "system"
            ? `Written by your agent · revision ${draft.revision}`
            : `Edited by hand · revision ${draft.revision}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DraftPreview draft={draft} />

        {blocked ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-foreground">
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
      </CardContent>
    </Card>
  )
}
