import { useEffect, useState } from "react"

/**
 * Current time rounded down to the minute. Convex queries that depend on
 * "now" take that instant as an argument — they are not re-run because the
 * clock advanced — so the client passes this stable value. It changes once
 * a minute, which keeps the subscription key stable inside the minute and
 * refreshes time-dependent answers within a minute of a boundary.
 */
export function useMinuteClock(): number {
  const minute = (): number => Math.floor(Date.now() / 60_000) * 60_000
  const [now, setNow] = useState(minute)
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(minute())
    }, 15_000)
    return () => {
      clearInterval(timer)
    }
  }, [])
  return now
}
