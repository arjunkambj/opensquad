/** Reset the ref on mount: StrictMode remounts effects after cleanup in development. */
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
