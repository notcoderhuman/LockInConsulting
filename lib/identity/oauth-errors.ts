// Readable messages for the `?error=` code Better Auth (or our callback guard) appends when a
// provider sign-in (Google, Microsoft, Apple, Yahoo) does not complete. Unknown codes get a generic
// message; the code itself is never echoed back to the page.

const EXPIRED = new Set(['state_mismatch', 'state_not_found', 'please_restart_the_process', 'invalid_callback_request', 'no_code', 'invalid_code', 'nonce_binding_missing'])

export function oauthErrorMessage(code: string | null | undefined, signUpOpen = false): string | null {
  if (!code) return null
  // A new account was refused before it existed: no unspent 18+ confirmation from /age-confirm,
  // or the provider did not verify the email (D-045). Neither reason is echoed back in detail.
  if (code === 'unable_to_create_user')
    return 'Your account wasn’t created. Start again from Create account: confirm that you’re 18 or older, then continue with an account whose email address the provider has verified.'
  if (code === 'signup_disabled' && signUpOpen)
    return 'There’s no student account for this sign-in yet. To create one, choose Create account.'
  if (code === 'access_denied') return 'Sign-in was cancelled. You can try again whenever you’re ready.'
  // Linking refused: the provider or the existing account has an unverified email, or it is a team account.
  if (code === 'account_not_linked' || code === 'unable_to_link_account')
    return 'This email already has a LockIn account. Sign in the way you did before (or with an emailed code, or your email and password); you can then add this method from Your account.'
  if (code === 'signup_disabled') return 'New student accounts aren’t open yet, so this account can’t be used to sign up.'
  if (code === 'email_not_verified') return 'Your provider hasn’t verified this email address, so it can’t be used to sign in.'
  if (EXPIRED.has(code)) return 'Your sign-in expired or was interrupted. Please try again.'
  if (code === 'unavailable') return 'Sign-in is temporarily unavailable. Please try again shortly.'
  return 'Sign-in didn’t complete. Please try again.'
}
