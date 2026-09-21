import { useCallback, useRef } from "react"

/** Reuse one request ID per subject/action across retries. Different actions need different IDs
 * to avoid replay conflicts; a new subject mounts a fresh map. */
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
