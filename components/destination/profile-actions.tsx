'use client'

import { Copy, Link2, Share2 } from 'lucide-react'
import { useState } from 'react'
import { useT } from '@/lib/i18n/client'

const action =
  'inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm text-foreground transition-colors hover:border-primary/60 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/**
 * Share, copy link and copy information for a university profile. `text` ends with a page-URL line
 * the server cannot know (the request host), so `{url}` is filled in here. Nothing is stored.
 */
export function ProfileActions({ title, path, text }: { title: string; path: string; text: string }) {
  const { t, locale } = useT()
  const [message, setMessage] = useState('')
  const url = () => new URL(path, window.location.origin).toString()

  async function copy(value: string, done: string) {
    try {
      await navigator.clipboard.writeText(value)
      setMessage(done)
    } catch {
      setMessage(t('actions.copyBlocked'))
    }
  }

  async function share() {
    if (!navigator.share) return copy(url(), t('actions.shareFallback'))
    try {
      await navigator.share({ title, url: url() })
      setMessage('')
    } catch (error) {
      // Closing the share sheet is not an error worth announcing.
      if (!(error instanceof DOMException && error.name === 'AbortError')) setMessage(t('actions.shareFailed'))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={action} onClick={share}>
          <Share2 className="size-4 text-primary" aria-hidden /> {t('actions.share')}
        </button>
        <button type="button" className={action} onClick={() => copy(url(), t('actions.linkCopied'))}>
          <Link2 className="size-4 text-primary" aria-hidden /> {t('actions.copyLink')}
        </button>
        {/* The copied record stays in English, as published; in Hindi the confirmation says so. */}
        <button
          type="button"
          className={action}
          onClick={() => copy(text.replace('{url}', url()), locale === 'en' ? t('actions.infoCopied') : `${t('actions.infoCopied')} ${t('actions.copyInEnglish')}`)}
        >
          <Copy className="size-4 text-primary" aria-hidden /> {t('actions.copyInfo')}
        </button>
      </div>
      <p role="status" className="min-h-5 text-xs text-muted-foreground">
        {message}
      </p>
    </div>
  )
}
