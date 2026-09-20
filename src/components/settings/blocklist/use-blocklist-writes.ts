/**
 * The Blocklist tab's two writes and the state they need.
 *
 * Split out of the tab so the component is a layout and this is the
 * behaviour. Both writes reset the page trail on success: a new row is the
 * newest row and lives on page one, and a removed row may have been the very
 * cursor a later page was anchored to.
 */
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import type { Doc, Id } from "../../../../convex/_generated/dataModel"
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"

export type BlocklistEntry = { kind: "email" | "domain"; value: string }

export type BlocklistWrites = {
  /** Which write is in flight, so one button's spinner cannot show on both. */
  busy: "add" | "remove" | null
  addError: string | null
  removeError: string | null
  clearAddError: () => void
  clearRemoveError: () => void
  add: (entry: BlocklistEntry) => void
  remove: (entry: Doc<"suppressions">) => void
}

export function useBlocklistWrites({
  orgId,
  onAdded,
  onRemoved,
}: {
  orgId: Id<"orgs">
  onAdded: () => void
  onRemoved: () => void
}): BlocklistWrites {
  const addSuppression = useMutation(api.outreach.suppressions.add)
  const removeSuppression = useMutation(api.outreach.suppressions.remove)
  const [busy, setBusy] = useState<"add" | "remove" | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  return {
    busy,
    addError,
    removeError,
    clearAddError: () => setAddError(null),
    clearRemoveError: () => setRemoveError(null),
    add: (entry) => {
      setBusy("add")
      setAddError(null)
      // `reason: "manual"` is not a choice: unsubscribe, bounce and provider
      // rows are written by the backend from things that actually happened,
      // and a form able to mint them would let a person fabricate an opt-out.
      void addSuppression({ orgId, ...entry, reason: "manual" })
        .then((added) => {
          onAdded()
          toast.add({
            title: added.created ? "Added to the blocklist" : "Already blocked",
            description: added.created
              ? `${added.suppression.normalizedValue} will never be contacted.`
              : `${added.suppression.normalizedValue} was already on the list.`,
            type: "success",
          })
        })
        .catch((cause) =>
          setAddError(
            errorMessage(cause, "Could not add that to the blocklist."),
          ),
        )
        .finally(() => setBusy(null))
    },
    remove: (entry) => {
      setBusy("remove")
      setRemoveError(null)
      void removeSuppression({ orgId, suppressionId: entry._id })
        .then(() => {
          onRemoved()
          toast.add({
            title: "Removed from the blocklist",
            description: `${entry.normalizedValue} can be contacted again.`,
            type: "success",
          })
        })
        .catch((cause) =>
          setRemoveError(
            errorMessage(cause, "Could not remove that from the blocklist."),
          ),
        )
        .finally(() => setBusy(null))
    },
  }
}
