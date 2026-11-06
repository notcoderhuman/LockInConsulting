import { redirect } from 'next/navigation'

// The 18+ and consent step now comes right after sign-in (/chat), so there is nothing to confirm beforehand.
export default function AgeConfirmPage() {
  redirect('/auth')
}
