import { Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import type { Doc, Id } from "../../../../convex/_generated/dataModel"
import { EditDraftDialog } from "@/components/drafts/EditDraftDialog"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"
import { useRequestIntents } from "@/lib/use-request-intents"

export function ReplyActions({
  orgId,
  draft,
  approved,
}: {
  orgId: Id<"orgs">
  draft: Doc<"drafts">
  approved: boolean
}) {
  const approve = useMutation(api.outreach.approvals.approve)
  const intentId = useRequestIntents()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {approved ? null : (
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError(null)
              void approve({
                orgId,
                draftId: draft._id,
                requestId: intentId(draft._id, "approve"),
              })
                .then(() =>
                  toast.add({
                    title: "Approved",
                    description:
                      "Every send check runs again before this leaves.",
                    type: "success",
                  }),
                )
                .catch((cause) =>
                  setError(errorMessage(cause, "Could not approve this reply.")),
                )
                .finally(() => setBusy(false))
            }}
          >
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <HugeiconsIcon
                icon={Tick02Icon}
                strokeWidth={2.5}
                data-icon="inline-start"
                aria-hidden="true"
              />
            )}
            Approve &amp; send
          </Button>
        )}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          Edit draft
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {approved
          ? "Approved. It sends within your sending hours once every check passes."
          : "Sends from your connected inbox after the send checks pass."}
      </p>
      <FormError message={error} />
      {editing ? (
        <EditDraftDialog
          orgId={orgId}
          draft={draft}
          open={editing}
          onOpenChange={setEditing}
        />
      ) : null}
    </div>
  )
}
