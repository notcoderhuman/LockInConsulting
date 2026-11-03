import { translator, type Translate } from '@/lib/i18n'

export type SignInFieldErrors = { email?: string[]; password?: string[] }

const english = translator('en')

// Checked in the browser before anything is sent, so the reader learns which field to fix. Says
// nothing about whether an account exists: that answer stays generic (see the sign-in forms).
// `t` picks the reader's language; the admin sign-in stays English.
export function signInFieldErrors(email: string, password: string, minPasswordLength = 0, t: Translate = english): SignInFieldErrors {
  const errors: SignInFieldErrors = {}
  const e = email.trim()
  if (!e) errors.email = [t('signIn.emailRequired')]
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) errors.email = [t('signIn.emailFormat')]
  if (!password) errors.password = [t('signIn.passwordRequired')]
  else if (password.length < minPasswordLength) errors.password = [t('signIn.passwordMin', { n: minPasswordLength })]
  return errors
}

export const SIGN_IN_REJECTED = english('signIn.rejected')
export const SIGN_IN_THROTTLED = english('signIn.throttled')
export const SIGN_IN_UNAVAILABLE = english('signIn.unavailable')
