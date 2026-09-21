import { useCallback, useState } from "react"

/** Reuse the request ID after failures; rotate it only after a successful submit.
 * A new form context must remount this hook. */
export function useIntentId(): readonly [string, () => void] {
  const [id, setId] = useState(() => crypto.randomUUID())
  const rotate = useCallback(() => setId(crypto.randomUUID()), [])
  return [id, rotate]
}
