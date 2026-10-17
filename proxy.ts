import { type NextRequest, NextResponse } from 'next/server'
import { buildCsp, createNonce, cspHeaderName, resolveCspMode } from '@/lib/security/csp'

export function proxy(request: NextRequest) {
  const nonce = createNonce()
  const policy = buildCsp(nonce, { isDev: process.env.NODE_ENV === 'development' })
  const header = cspHeaderName(resolveCspMode())

  // Next reads the nonce from the request's CSP header and stamps it on its own scripts/styles.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', policy)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set(header, policy)
  return response
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|textures|images|.*\\.(?:png|webp|ico|svg|txt|xml)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
