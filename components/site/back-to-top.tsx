'use client'

import { ArrowUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/client'

// Appears once the reader is more than a screen and a half down. Returns focus to the top of the
// page (the skip-link target) so keyboard users continue from there, not from the footer.
export function BackToTop() {
  const { t } = useT()
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > window.innerHeight * 1.5)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function toTop() {
    // Smooth or instant comes from html { scroll-behavior } in globals.css, which honours reduced motion.
    window.scrollTo({ top: 0 })
    const main = document.getElementById('main')
    if (main) {
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
      main.focus({ preventScroll: true })
    }
  }

  return (
    <button
      type="button"
      onClick={toTop}
      hidden={!shown}
      aria-label={t('backToTop')}
      className="fixed bottom-5 right-5 z-30 inline-flex size-12 items-center justify-center rounded-full border border-primary/50 bg-background/90 text-primary shadow-lg shadow-black/40 backdrop-blur-md transition-colors hover:bg-primary hover:text-primary-foreground md:bottom-8 md:right-8"
    >
      <ArrowUp className="size-5" aria-hidden />
    </button>
  )
}
