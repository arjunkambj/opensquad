import { useCallback, useRef } from "react"

/**
 * Client request ids, one per (subject, action) intent.
 *
 * The rule the backend enforces and this hook has to match: a requestId is a
 * *logical intent*, not a click. The approval mutations replay a recorded
 * outcome for a repeated requestId, and raise CONFLICT when one requestId is
 * replayed carrying a different verdict. So:
 *
 * - The same id must survive a retry of the same intent. A CONFLICT or a
 *   network failure leaves nothing recorded; pressing the button again must
 *   be the same approval, not a second one.
 * - A different action needs a different id. Approving and then rejecting are
 *   two intents, and sharing an id would make the second one a CONFLICT.
 * - A different subject needs a different id, so the map is keyed by both.
 *
 * `ReviewStep.tsx` mints one id per mount with `useRef(crypto.randomUUID())`;
 * this is the same idea with several intents alive at once, which is why it is
 * a lazily-filled map rather than a single ref. The ref is never reset: the
 * component is keyed on its subject by its parent, so a new subject mounts a
 * new map.
 */
export function useRequestIntents() {
  const intents = useRef(new Map<string, string>())

  return useCallback((subjectId: string, action: string): string => {
    const key = `${subjectId}:${action}`
    const existing = intents.current.get(key)
    if (existing !== undefined) {
      return existing
    }
    const minted = crypto.randomUUID()
    intents.current.set(key, minted)
    return minted
  }, [])
}
