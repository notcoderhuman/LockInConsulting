'use client'

import { Bookmark, BookmarkCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { addItem, isSaved, removeItem, storageAvailable, useDeviceList, type DeviceItem } from '@/lib/device-lists'
import { useT } from '@/lib/i18n/client'
import { cn } from '@/lib/utils'

/** Save / unsave on this device. Says so plainly when the browser blocks storage. */
export function SaveButton({ item, compact = false }: { item: Omit<DeviceItem, 'at'>; compact?: boolean }) {
  const { t } = useT()
  const saved = isSaved(useDeviceList('saved'), item)
  const [blocked, setBlocked] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => setBlocked(!storageAvailable()), [])

  function toggle() {
    const ok = saved ? removeItem('saved', item) : addItem('saved', item)
    setMessage(ok ? t(saved ? 'save.removedMessage' : 'save.savedMessage', { name: item.name }) : t('save.blockedMessage'))
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={blocked}
        aria-pressed={saved}
        aria-label={compact ? t('save.saveName', { name: item.name }) : undefined}
        title={blocked ? t('save.blockedTitle') : undefined}
        className={cn(
          'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50',
          saved ? 'border-primary/60 text-primary' : 'border-border text-foreground hover:border-primary/60 hover:text-primary',
          compact && 'size-11 justify-center px-0',
        )}
      >
        {saved ? <BookmarkCheck className="size-4 text-primary" aria-hidden /> : <Bookmark className="size-4 text-primary" aria-hidden />}
        {!compact && (saved ? t('save.saved') : t('save.save'))}
      </button>
      <span role="status" className="sr-only">
        {message}
      </span>
    </span>
  )
}
