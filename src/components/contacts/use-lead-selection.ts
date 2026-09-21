/**
 * The rows the bulk bar acts on.
 *
 * Deliberately not in the URL, unlike the filters and the open lead: a
 * selection is a gesture, not shared context, and it is cleared by anything
 * that changes which rows are on screen — a filter, a page, a finished bulk
 * action — so the bar can never act on a row the user can no longer see.
 */
import { useState } from "react"
import type { Id } from "../../../convex/_generated/dataModel"

export function useLeadSelection() {
  const [selected, setSelected] = useState<Set<Id<"prospects">>>(new Set())

  return {
    selected,
    /** The selection as the order-independent list the mutations take. */
    ids: [...selected],
    clear: () => setSelected(new Set()),
    toggle: (prospectId: Id<"prospects">) =>
      setSelected((previous) => {
        const next = new Set(previous)
        if (!next.delete(prospectId)) {
          next.add(prospectId)
        }
        return next
      }),
    replace: (prospectIds: readonly Id<"prospects">[]) =>
      setSelected(new Set(prospectIds)),
  }
}
