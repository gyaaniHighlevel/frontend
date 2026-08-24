import { api } from '@/lib/api'

/**
 * Route of pages/oauth/callback.vue. Must exactly match the
 * redirect_uri registered in the HighLevel marketplace app.
 */
export const HL_CALLBACK_PATH = '/oauth/callback'

/**
 * BroadcastChannel name the callback tab pings after a successful exchange so
 * already-open tabs can refresh their connection state.
 */
export const HL_OAUTH_CHANNEL = 'hl-oauth'

/** Mirror of the backend's ConnectionStatus (hl-oauth.service.ts). */
export interface HlConnectionStatus {
  connected: boolean
  locationId?: string
  locationName?: string
  companyId?: string
  scopes?: string[]
  /** Access-token expiry, epoch ms. Tokens live server-side only. */
  expiresAt?: number
}

/**
 * POST /oauth/hl/connect — exchanges the OAuth authorization code for tokens,
 * which are stored server-side; only display metadata comes back. The
 * redirect_uri comes from the backend's HL_REDIRECT_URI config.
 */
export function exchangeHlCode(code: string): Promise<HlConnectionStatus> {
  return api('POST', '/oauth/hl/connect', { code })
}

/** GET /oauth/hl/status — current connection state for the signed-in user. */
export function fetchHlStatus(): Promise<HlConnectionStatus> {
  return api('GET', '/oauth/hl/status')
}
