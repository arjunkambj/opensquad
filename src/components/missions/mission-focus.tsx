import { createContext, useCallback, useContext, useMemo, useRef } from "react"
import type { ReactNode } from "react"

type MissionFocus = {
  /**
   * Called when a card is opened, so the board knows where to return — and on
   * which board. `viewKey` identifies the filter set and column the card was
   * read in.
   */
  remember: (missionId: string, viewKey: string) => void
  /**
   * True exactly once, for the card that was opened, and only on the board it
   * was opened from. Claiming clears the memory, so a later board visit does
   * not steal focus from wherever the operator put it.
   */
  claim: (missionId: string, viewKey: string) => boolean
  /**
   * Called by the board with the view it is currently rendering. A memory
   * belonging to a different view is dropped: the operator has moved, and
   * focus belongs where they moved it.
   */
  settle: (viewKey: string) => void
  /** The operator acted on the board themselves. Forget the memory outright. */
  drop: () => void
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
 * **The memory belongs to one board view, and expires when the board shows a
 * different one.** Without that bound it survived every filter change, column
 * change and archive toggle for as long as the operator stayed under
 * `/overview`: open a mission in Needs you, cancel it so it moves to Backlog,
 * come back to a board that no longer holds it — nothing claims — then tap the
 * Backlog selector, and the remembered card mounts and yanks focus off the
 * button just pressed, into the middle of a list. A card may only claim on the
 * board it was opened from. Anywhere else the operator has already placed
 * focus themselves, and moving it is a theft rather than a courtesy.
 *
 * A ref rather than state, on purpose: nothing here should cause a render.
 * Remembering a card is not a visible change, and setting state from the
 * effect that consumes it would re-render every card on the board to move one
 * focus ring.
 */
export function MissionFocusProvider({ children }: { children: ReactNode }) {
  const lastOpened = useRef<{ missionId: string; viewKey: string } | null>(null)

  const remember = useCallback((missionId: string, viewKey: string) => {
    lastOpened.current = { missionId, viewKey }
  }, [])

  const claim = useCallback((missionId: string, viewKey: string) => {
    const memory = lastOpened.current
    if (
      memory === null ||
      memory.missionId !== missionId ||
      memory.viewKey !== viewKey
    ) {
      return false
    }
    lastOpened.current = null
    return true
  }, [])

  const settle = useCallback((viewKey: string) => {
    if (lastOpened.current !== null && lastOpened.current.viewKey !== viewKey) {
      lastOpened.current = null
    }
  }, [])

  const drop = useCallback(() => {
    lastOpened.current = null
  }, [])

  const value = useMemo<MissionFocus>(
    () => ({ remember, claim, settle, drop }),
    [remember, claim, settle, drop],
  )

  return <MissionFocusContext value={value}>{children}</MissionFocusContext>
}

/**
 * Outside the provider this is a set of no-ops rather than a throw: focus
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
  settle: () => {},
  drop: () => {},
}
