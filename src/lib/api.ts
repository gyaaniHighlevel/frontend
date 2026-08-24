import { firebaseAuth } from '@/lib/firebase'

const API_BASE = import.meta.env.VITE_API_BASE

/**
 * Error contract shared by REST responses and callable `error.details`
 * (frontend-integration.md §4). `message` is user-facing — render it directly.
 */
export interface ErrorBody {
  code: string
  message: string
  /** Seconds; present only on rate-limit errors. */
  retryAfter?: number
}

export class ApiError extends Error {
  status: number
  code: string
  retryAfter?: number

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

/**
 * REST fetch helper (frontend-integration.md §2.3). Attaches the Firebase ID
 * token and retries exactly once with a force-refreshed token on 401.
 */
export async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  if (!API_BASE) {
    throw new ApiError(0, 'CONFIG', 'VITE_API_BASE is not set. Add it to .env.local (see .env.example).')
  }

  const attempt = async (forceRefresh: boolean) => {
    const user = firebaseAuth.currentUser
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const token = await user.getIdToken(forceRefresh)
    return fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  let res = await attempt(false)
  if (res.status === 401) res = await attempt(true) // expired token → one forced refresh
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ code: 'UNKNOWN', message: res.statusText }))) as ErrorBody
    throw new ApiError(res.status, err.code, err.message, err.retryAfter)
  }
  return res.json() as Promise<T>
}
