// Single-key shortcuts for public pages. WCAG 2.1.4 (Character Key Shortcuts): they never fire while
// typing, with a modifier held (so browser and screen-reader commands keep working), and the reader
// can turn them off; the choice is kept in this browser.
export const SHORTCUTS_KEY = 'lockin:shortcuts'

export type ShortcutAction = 'search' | 'help' | null

/** Which shortcut a keydown means, or null. Pure, so it is tested without a browser. */
export function shortcutFor(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'defaultPrevented' | 'isComposing'>, target: EventTarget | null): ShortcutAction {
  if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return null
  if (isTypingTarget(target)) return null
  if (e.key === '/') return 'search'
  if (e.key === '?') return 'help'
  return null
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { isContentEditable?: boolean; type?: string }) | null
  if (!el || typeof el !== 'object' || !('tagName' in el)) return false
  if (el.isContentEditable) return true
  const tag = String(el.tagName).toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  // Buttons, checkboxes and the like do not take text, so "/" there is still a shortcut.
  return tag === 'INPUT' && !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(String(el.type ?? 'text'))
}

export function shortcutsEnabled(): boolean {
  try {
    return localStorage.getItem(SHORTCUTS_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setShortcutsEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SHORTCUTS_KEY)
    else localStorage.setItem(SHORTCUTS_KEY, 'off')
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}
