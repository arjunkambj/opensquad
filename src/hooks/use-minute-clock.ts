import { useEffect, useState } from "react"

/** Pass a minute-rounded clock to time-dependent queries so they refresh without resubscribing on every render. */
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
