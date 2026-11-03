'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { useT } from '@/lib/i18n/client'
import { cn } from '@/lib/utils'

/**
 * A password field with a show/hide toggle. Visibility is component state only: nothing is stored,
 * and the field is masked again on submit so the browser never handles it as plain text.
 */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<'input'>, 'type'> & { id: string }) {
  const { t } = useT()
  const [visible, setVisible] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const form = input.current?.form
    if (!form) return
    const hide = () => setVisible(false)
    form.addEventListener('submit', hide)
    return () => form.removeEventListener('submit', hide)
  }, [])

  return (
    <div className="relative">
      <input ref={input} {...props} type={visible ? 'text' : 'password'} className={cn(className, 'pr-12')} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={t('password.show')}
        aria-pressed={visible}
        aria-controls={props.id}
        className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-primary focus-visible:text-primary"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  )
}
