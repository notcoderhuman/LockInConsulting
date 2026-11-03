// The reader's text size: a display preference kept in this browser only.
export const TEXT_SIZES = ['standard', 'large', 'larger'] as const
export type TextSize = (typeof TEXT_SIZES)[number]
export const TEXT_SIZE_KEY = 'lockin:text-size'

/**
 * Runs before first paint (inline, with the CSP nonce) so a saved size never flashes in at the
 * standard size first. Only the two known values are applied.
 */
export const TEXT_SIZE_BOOT = `try{var s=localStorage.getItem('${TEXT_SIZE_KEY}');if(s==='large'||s==='larger')document.documentElement.dataset.textSize=s}catch(e){}`

export function applyTextSize(size: TextSize): void {
  if (size === 'standard') delete document.documentElement.dataset.textSize
  else document.documentElement.dataset.textSize = size
  try {
    if (size === 'standard') localStorage.removeItem(TEXT_SIZE_KEY)
    else localStorage.setItem(TEXT_SIZE_KEY, size)
  } catch {
    // Storage blocked: the size still applies to this page.
  }
}

export function currentTextSize(): TextSize {
  const s = document.documentElement.dataset.textSize
  return s === 'large' || s === 'larger' ? s : 'standard'
}
