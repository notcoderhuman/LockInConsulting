// Readable messages for the `?error=` code Better Auth (or our callback guard) appends when a
// Google sign-in does not complete. Unknown codes get a generic message; the code itself is
// never echoed back to the page.

const EXPIRED = new Set(['state_mismatch', 'state_not_found', 'please_restart_the_process', 'invalid_callback_request', 'no_code', 'invalid_code', 'nonce_binding_missing'])

export function oauthErrorMessage(code: string | null | undefined, signUpOpen = false): string | null {
  if (!code) return null
  // A new Google account was refused before it existed: no unspent 18+ confirmation from /age-confirm,
  // or Google did not verify the email (D-045). Neither reason is echoed back in detail.
  if (code === 'unable_to_create_user')
    return 'Your account wasn’t created. Start again from Create account: confirm that you’re 18 or older, then continue with a Google account whose email address Google has verified.'
  if (code === 'signup_disabled' && signUpOpen)
    return 'There’s no student account for this Google account yet. To create one, choose Create account.'
  if (code === 'access_denied') return 'Google sign-in was cancelled. You can try again whenever you’re ready.'
  if (code === 'account_not_linked') return 'This email already has a LockIn account. Sign in with your email and password instead.'
  if (code === 'signup_disabled') return 'New student accounts aren’t open yet, so this Google account can’t be used to sign up.'
  if (code === 'email_not_verified') return 'Google hasn’t verified this email address, so it can’t be used to sign in.'
  if (EXPIRED.has(code)) return 'Your sign-in expired or was interrupted. Please try again.'
  if (code === 'unavailable') return 'Sign-in is temporarily unavailable. Please try again shortly.'
  return 'Google sign-in didn’t complete. Please try again.'
}
