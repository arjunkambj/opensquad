/**
 * Link a thread that matched no lead to one already in this org.
 *
 * Human-only by contract: the mutation takes ids from an authenticated
 * editor and refuses an agent the lead does not belong to, so the picker
 * derives `agentId` from the chosen lead and the two can never disagree.
 * Linking files the conversation — it sends nothing and starts no work.
 */
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import type { Doc, Id } from "../../../../convex/_generated/dataModel"
import { leadDisplayName } from "@/components/inbox/inbox-presentation"
import { Hint } from "@/components/kit/Hint"
import { FieldSkeleton } from "@/components/states/skeletons"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"
import { useRequestIntents } from "@/lib/use-request-intents"
import { useMountedRef } from "@/hooks/use-mounted"

export function AssociateLeadButton({
  orgId,
  conversation,
  expectedContextVersion,
}: {
  orgId: Id<"orgs">
  conversation: Doc<"conversations">
  expectedContextVersion: number
}) {
  const leads = useQuery(api.leads.queries.list, { orgId, limit: 50 })
  const associate = useMutation(api.inbox.conversationResume.associateProspect)
  const intentId = useRequestIntents()

  const [open, setOpen] = useState(false)
  const [prospectId, setProspectId] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Guard local state after unmount; the global success toast can still report the completed write.
  const mounted = useMountedRef()

  // Nothing from an abandoned attempt survives into the next one.
  const close = () => {
    setOpen(false)
    setProspectId("")
    setError(null)
  }

  const submit = () => {
    const lead = leads?.items.find((item) => item._id === prospectId)
    if (lead === undefined) {
      return
    }
    setPending(true)
    setError(null)
    void associate({
      orgId,
      conversationId: conversation._id,
      expectedContextVersion,
      prospectId: lead._id,
      agentId: lead.agentId,
      requestId: intentId(conversation._id, "associate"),
    })
      .then(() => {
        if (mounted.current) {
          close()
        }
        toast.add({
          title: "Lead linked",
          description: "The thread is filed under that lead.",
          type: "success",
        })
      })
      .catch((cause) => {
        if (mounted.current) {
          setError(
            isConflictError(cause)
              ? `${errorMessage(cause, "This thread changed while you had it open.")} The pane now shows the current version.`
              : errorMessage(cause, "Could not link that lead."),
          )
        }
      })
      .finally(() => {
        if (mounted.current) {
          setPending(false)
        }
      })
  }

  return (
    <>
      <Hint content="This mail matched no thread we started. Linking files it under a lead — nothing is sent.">
        <Button onClick={() => setOpen(true)}>Link to a lead</Button>
      </Hint>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) {
            return
          }
          if (next) {
            setOpen(true)
          } else {
            close()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link this thread to a lead</DialogTitle>
            <DialogDescription>
              The conversation is filed under the lead you pick. Nothing is
              sent and no work starts.
            </DialogDescription>
          </DialogHeader>
          {leads === undefined ? (
            <FieldSkeleton />
          ) : leads.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This organization has no leads to link yet. The thread stays here
              meanwhile.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="associate-lead">Lead</Label>
              <NativeSelect
                id="associate-lead"
                value={prospectId}
                onChange={(event) => setProspectId(event.target.value)}
              >
                <option value="">Choose a lead…</option>
                {leads.items.map((lead) => (
                  <option key={lead._id} value={lead._id}>
                    {leadDisplayName(lead)}
                    {lead.companyName === undefined
                      ? ""
                      : ` — ${lead.companyName}`}
                  </option>
                ))}
              </NativeSelect>
              {leads.hasMore ? (
                <p className="text-xs text-muted-foreground">
                  Showing the first {leads.items.length} leads.
                </p>
              ) : null}
            </div>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={close}
            >
              Cancel
            </Button>
            <Button disabled={pending || prospectId === ""} onClick={submit}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Link the lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
