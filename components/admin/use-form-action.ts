'use client'

import { startTransition, useActionState, type FormEvent } from 'react'
import type { ActionState } from '@/app/admin/actions'

type ServerAction = (prev: ActionState, form: FormData) => Promise<ActionState>

/**
 * Wraps a server action without React's automatic form reset, so a validation error keeps
 * everything the editor typed. The action itself still runs (and re-authorises) on the server.
 */
export function useFormAction(action: ServerAction) {
  const [state, dispatch, pending] = useActionState(action, null)
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    startTransition(() => dispatch(data))
  }
  return { state, pending, onSubmit }
}
