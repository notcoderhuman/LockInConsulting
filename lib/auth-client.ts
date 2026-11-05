'use client'

import { emailOTPClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

// Same-origin client: it always talks to /api/auth on whichever host served the page.
export const authClient = createAuthClient({ plugins: [emailOTPClient()] })
