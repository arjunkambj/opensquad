import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function getSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches
}

/**
 * Whether the viewport is phone-width.
 *
 * `useSyncExternalStore`, not state-plus-effect: the previous version started
 * at `undefined` and wrote the real value from an effect, so the first painted
 * frame always claimed desktop. On a phone that renders the desktop shell for
 * a frame before correcting itself, and it was the one lint warning in the
 * repo (`react(set-state-in-effect)`). Reading the media query during render
 * removes both.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}
