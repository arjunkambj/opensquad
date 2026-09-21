import { useNavigate } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { isTypingTarget } from "@/lib/keyboard"

const rowSelector = (key: string) => `[data-queue-item="${CSS.escape(key)}"]`

const focusRow = (key: string) => {
  const row = document.querySelector<HTMLElement>(rowSelector(key))
  row?.focus()
}

/**
 * Queue navigation for the two screens whose whole job is working a list:
 * `/inbox` and `/contacts`.
 *
 * `j`/`k` move DOM focus between the row links — the rows are real links, so
 * once a row is focused, Enter opens it natively and a screen reader announces
 * an actual element rather than a highlighted index. Escape belongs to the
 * detail, not the list, so it is not handled here.
 *
 * Focus restore on close tracks the row's id, not a DOM ref: the Convex
 * subscription may re-render the list while the detail is open, and a stale
 * element reference restores focus to nothing.
 */
export function useQueueNavigation<T>({
  items,
  keyOf,
  detailOpen,
}: {
  items: T[]
  keyOf: (item: T) => string
  /**
   * Whether a detail is currently open beside/over this list. When it flips
   * back to false, focus returns to the row that was last opened — tracked
   * by id because the list may have re-rendered underneath.
   */
  detailOpen: boolean
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const lastOpenedKey = useRef<string | null>(null)
  const wasDetailOpen = useRef(detailOpen)

  // What the key handler needs, held where reading it cannot re-subscribe the
  // listener: `items` is a new array on every Convex update and `keyOf` a new
  // closure on every render, so an effect keyed on their identities would
  // remove and re-add a window listener continuously while a list is live.
  const itemsRef = useRef(items)
  const keyOfRef = useRef(keyOf)
  const activeKeyRef = useRef(activeKey)
  useEffect(() => {
    itemsRef.current = items
    keyOfRef.current = keyOf
    activeKeyRef.current = activeKey
  })

  // Record which row's detail is open, and give its focus back when the
  // detail closes. The row refocus is keyed on the transition, not on every
  // render — a live list re-render must not steal focus from the detail.
  useEffect(() => {
    if (detailOpen && !wasDetailOpen.current) {
      lastOpenedKey.current =
        document.activeElement instanceof HTMLElement
          ? (document.activeElement
              .closest("[data-queue-item]")
              ?.getAttribute("data-queue-item") ?? lastOpenedKey.current)
          : lastOpenedKey.current
    }
    if (!detailOpen && wasDetailOpen.current) {
      const key = lastOpenedKey.current
      if (key !== null) {
        // The list is mounted but possibly not yet painted after the route
        // change; defer a frame so the row exists to take focus.
        requestAnimationFrame(() => focusRow(key))
      }
    }
    wasDetailOpen.current = detailOpen
  }, [detailOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (isTypingTarget(event.target)) {
        return
      }
      const key = event.key.toLowerCase()
      if (key !== "j" && key !== "k") {
        return
      }
      const rows = itemsRef.current
      const keyFor = keyOfRef.current
      const current = activeKeyRef.current
      if (rows.length === 0) {
        return
      }
      event.preventDefault()
      const currentIndex =
        current === null
          ? -1
          : rows.findIndex((item) => keyFor(item) === current)
      const nextIndex =
        key === "j"
          ? Math.min(currentIndex + 1, rows.length - 1)
          : currentIndex === -1
            ? 0
            : Math.max(currentIndex - 1, 0)
      const next = rows[nextIndex]
      if (next === undefined) {
        return
      }
      const nextKey = keyFor(next)
      setActiveKey(nextKey)
      focusRow(nextKey)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return {
    /** The row key j/k last moved to — a row reads this for its own styling. */
    activeKey,
    /** Wire to each row's onFocus so pointer/Tab focus also drives j/k. */
    setActiveKey,
  }
}

/**
 * Escape on a detail navigates back to the parent list rather than just
 * blurring — `plan/ux.md` §6: "Escape navigates to the parent route, not just
 * blurs, or the URL and the view disagree."
 */
export function useEscapeToParent(to: string) {
  const navigate = useNavigate()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return
      }
      // Inside a real dialog Escape closes the dialog — Base UI handles that,
      // and also navigating away would strand the dialog's outcome.
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[role="dialog"]') !== null
      ) {
        return
      }
      if (isTypingTarget(event.target)) {
        return
      }
      event.preventDefault()
      // `search: true` inherits the detail's own URL params — the tab and
      // cursor the row link carried in — so Back and Escape land on the same
      // filtered page. A `(prev) => prev` reducer breaks here: `prev` unions
      // every route's schema, and `tab` collides across routes.
      void navigate({ to, search: true })
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [navigate, to])
}

