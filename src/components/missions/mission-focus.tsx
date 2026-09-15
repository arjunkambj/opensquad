import { createContext, useCallback, useContext, useMemo, useRef } from "react"
import type { ReactNode } from "react"

type MissionFocus = {
  /** Called when a card is opened, so the board knows where to return. */
  remember: (missionId: string) => void
  /**
   * True exactly once, for the card that was opened. Claiming clears the
   * memory, so a later board visit does not steal focus from wherever the
   * operator put it.
   */
  claim: (missionId: string) => boolean
}

const MissionFocusContext = createContext<MissionFocus | null>(null)

/**
 * Where focus goes when a mission detail closes.
 *
 * It tracks the mission **id**, never a DOM node: a live Convex subscription
 * re-renders the board underneath, and a stored element reference would point
 * at a card React has already thrown away. `plan/ux.md` §6 states exactly this
 * rule, and it is the difference between focus landing on the row you came
 * from and focus landing on `<body>`.
 *
 * It lives on the `/overview` layout because that is what survives the swap
 * between the board and the detail. On the board route it would unmount the
 * moment the detail opened, taking the memory with it.
 *
 * A ref rather than state, on purpose: nothing here should cause a render.
 * Remembering a card is not a visible change, and setting state from the
 * effect that consumes it would re-render every card on the board to move one
 * focus ring.
 */
export function MissionFocusProvider({ children }: { children: ReactNode }) {
  const lastOpened = useRef<string | null>(null)

  const remember = useCallback((missionId: string) => {
    lastOpened.current = missionId
  }, [])

  const claim = useCallback((missionId: string) => {
    if (lastOpened.current !== missionId) {
      return false
    }
    lastOpened.current = null
    return true
  }, [])

  const value = useMemo<MissionFocus>(
    () => ({ remember, claim }),
    [remember, claim],
  )

  return (
    <MissionFocusContext value={value}>{children}</MissionFocusContext>
  )
}

/**
 * Outside the provider this is a pair of no-ops rather than a throw: focus
 * restore is a courtesy, and a mission card rendered somewhere else one day
 * should not crash the page over it.
 */
export function useMissionFocus(): MissionFocus {
  const context = useContext(MissionFocusContext)
  return context ?? FALLBACK
}

const FALLBACK: MissionFocus = {
  remember: () => {},
  claim: () => false,
}
