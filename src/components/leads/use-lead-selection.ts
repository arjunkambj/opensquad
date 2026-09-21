/** Clear selection when visible rows change so bulk actions cannot target hidden rows. */
import { useState } from "react"
import type { Id } from "../../../convex/_generated/dataModel"

export function useLeadSelection() {
  const [selected, setSelected] = useState<Set<Id<"prospects">>>(new Set())

  return {
    selected,
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
