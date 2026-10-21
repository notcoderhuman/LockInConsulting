import 'server-only'
import { SupportError } from '@/lib/support/db'
import { json, jsonError } from './access'

// Shared request/response handling for /api/student/*.

const MAX_BODY_BYTES = 16 * 1024

export async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return jsonError(413, 'That message is too long.')
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return jsonError(413, 'That message is too long.')
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : jsonError(400, 'Invalid request.')
  } catch {
    return jsonError(400, 'Invalid request.')
  }
}

export function routeId(raw: string): number | null {
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 && String(id) === raw ? id : null
}

/** Maps known errors to safe responses. Unknown errors are logged without request content. */
export function handleError(error: unknown, failure = 'Something went wrong. Nothing was saved.'): Response {
  if (error instanceof SupportError) return jsonError(error.status, error.message, Object.keys(error.fieldErrors).length ? { fieldErrors: error.fieldErrors } : {})
  console.error('[student] request failed', error instanceof Error ? error.name : 'unknown error')
  return jsonError(500, failure)
}

export { json, jsonError }
