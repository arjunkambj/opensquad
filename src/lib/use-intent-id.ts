import { useCallback, useState } from "react"

/**
 * One `requestId` per logical intent — stable across retries of the same
 * submit, fresh after success.
 *
 * The backend enforces the rule this hook exists to match: every CRM and
 * booking mutation is idempotent on its `requestId` — a replayed id returns
 * the outcome that was actually recorded, and a replayed id carrying
 * DIFFERENT values is a CONFLICT. So:
 *
 * - A retry of the same intent must send the SAME id — a CONFLICT or a
 *   dropped connection leaves nothing recorded, and pressing the button
 *   again is the same intent, not a second write.
 * - A successful submit completes the intent, so `rotate()` mints the next
 *   one — submitting again afterwards is a new intent with a new id.
 *
 * This is the same shape `useRequestIntents` gives the decisions surface,
 * generalised to one intent per component instance. The component is keyed
 * by its parent (`formEpoch` on the lead detail), so a new intent context
 * mounts a fresh id.
 */
export function useIntentId(): readonly [string, () => void] {
  const [id, setId] = useState(() => crypto.randomUUID())
  const rotate = useCallback(() => setId(crypto.randomUUID()), [])
  return [id, rotate]
}
