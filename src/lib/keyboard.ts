/**
 * Whether a keyboard event landed somewhere the user is typing.
 *
 * Every window-level shortcut in this app has to ask this first. ⌘K and ⌘B
 * both `preventDefault()` on any keydown today, so pressing ⌘B while writing a
 * four-thousand-character conversation note toggles the sidebar and pressing ⌘K
 * opens the palette over a half-typed instruction. A global shortcut that
 * fires inside a text field is a shortcut that eats the user's work.
 *
 * `select` is included deliberately: a native `<select>` uses letter keys to
 * jump between options, so a bare-letter shortcut would fight it.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}
