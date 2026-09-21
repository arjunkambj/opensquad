/**
 * "Is this screen still on the page?", for the code that runs after an await.
 *
 * Every screen in setup writes state when a mutation or action answers, and
 * the user can leave — Previous, Next, a closed tab — while that answer is
 * still in flight. The ref this returns is the guard those handlers check
 * before they set anything, so a screen that is gone stays gone.
 *
 * It is set to `true` on mount rather than only at creation because
 * StrictMode mounts, unmounts and remounts a component in development: a ref
 * left `false` by the first unmount would make the remounted screen believe
 * it had already been thrown away.
 */
import { useEffect, useRef } from "react"
import type { RefObject } from "react"

export function useMountedRef(): RefObject<boolean> {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return mounted
}
