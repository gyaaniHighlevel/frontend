// hl-sdk.js — platform shim inlined into the preview srcdoc (LLD §9.1).
// Real transport: `window.hl.*` forwards to the Cloud Function proxy's /hl
// whitelist (LLD §6.2) with the caller's Firebase ID token, obtained from the
// parent via the postMessage handshake (§9.3). Generated code never sees the
// token — it lives in this closure; connect-src limits where it can go.
(() => {
  const PROXY_BASE = String(window.__GENESIS__.proxyUrl || '').replace(/\/+$/, '')

  // Error contract (LLD §6.3): status + code for programmatic handling,
  // message written for end users — generated apps render it verbatim.
  class HlError extends Error {
    constructor(status, code, message, retryAfter) {
      super(message)
      this.name = 'HlError'
      this.status = status
      this.code = code
      if (retryAfter !== undefined) this.retryAfter = retryAfter
    }
  }
  window.HlError = HlError

  // --- Token handshake (§9.3) ------------------------------------------------
  // The ready() gate queues all hl.* calls until the first genesis:token lands,
  // absorbing the race where the app's onMounted fires before the handshake.
  let token = null
  let waiters = []

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return
    const data = e.data
    if (data && data.type === 'genesis:token' && typeof data.token === 'string') {
      token = data.token
      waiters.splice(0).forEach((notify) => notify())
    }
  })

  function firstToken() {
    return new Promise((resolve, reject) => {
      if (token) return resolve()
      const timer = setTimeout(() => {
        reject(new HlError(401, 'UNAUTHENTICATED',
          'The preview could not authenticate. Reload the preview.'))
      }, 10000)
      waiters.push(() => { clearTimeout(timer); resolve() })
    })
  }

  // On a proxy 401 (expired preview token): ask the parent for a
  // force-refreshed token, wait for it to land, retry once (§9.4).
  function refreshedToken() {
    return new Promise((resolve) => {
      // Fall through on timeout — the retry then reports the real error.
      const timer = setTimeout(resolve, 10000)
      waiters.push(() => { clearTimeout(timer); resolve() })
      parent.postMessage({ type: 'genesis:token-refresh' }, '*')
    })
  }

  // --- Transport --------------------------------------------------------------

  async function request(method, path, { query, body } = {}) {
    await firstToken()

    const send = () => {
      const url = new URL(PROXY_BASE + path)
      for (const [key, value] of Object.entries(query || {})) {
        if (value !== undefined && value !== null) url.searchParams.set(key, value)
      }
      return fetch(url, {
        method,
        headers: {
          authorization: 'Bearer ' + token,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    }

    let res = await send()
    if (res.status === 401) {
      await refreshedToken()
      res = await send()
    }
    if (!res.ok) {
      let err = {}
      try { err = await res.json() } catch { /* non-JSON error body */ }
      throw new HlError(
        res.status,
        err.code || 'UNKNOWN',
        err.message || 'The request failed. Try again.',
        err.retryAfter,
      )
    }
    return res.json()
  }

  const id = (value) => encodeURIComponent(String(value))

  // SDK surface (LLD §6.2) — the ten whitelisted routes, nothing else.
  window.hl = {
    contacts: {
      list: ({ limit, page } = {}) =>
        request('GET', '/hl/contacts', { query: { limit, page } }),
      search: ({ query, limit } = {}) =>
        request('GET', '/hl/contacts/search', { query: { query, limit } }),
      create: (body) => request('POST', '/hl/contacts', { body }),
      update: (contactId, body) =>
        request('PUT', `/hl/contacts/${id(contactId)}`, { body }),
    },
    conversations: {
      list: ({ limit } = {}) =>
        request('GET', '/hl/conversations', { query: { limit } }),
      messages: (conversationId, { limit, lastMessageId } = {}) =>
        request('GET', `/hl/conversations/${id(conversationId)}/messages`, {
          query: { limit, lastMessageId },
        }),
      send: (conversationId, body) =>
        request('POST', `/hl/conversations/${id(conversationId)}/messages`, { body }),
    },
    calendars: {
      list: () => request('GET', '/hl/calendars'),
      appointments: ({ calendarId, startTime, endTime } = {}) =>
        request('GET', '/hl/calendars/appointments', {
          query: { calendarId, startTime, endTime },
        }),
      availability: (calendarId, { startDate, endDate, timezone } = {}) =>
        request('GET', `/hl/calendars/${id(calendarId)}/availability`, {
          query: { startDate, endDate, timezone },
        }),
    },
  }

  // Runtime error channel (§9.4): forward errors to the parent, deduplicated
  // by message within a 3s window so render loops don't flood the channel.
  const recent = new Map()
  function forward(message, stack) {
    const now = Date.now()
    if (recent.get(message) && now - recent.get(message) < 3000) return
    recent.set(message, now)
    parent.postMessage(
      { type: 'genesis:error', message: String(message).slice(0, 2048), stack: stack ? String(stack).slice(0, 2048) : undefined },
      '*',
    )
  }
  window.addEventListener('error', (e) => forward(e.message, e.error && e.error.stack))
  window.addEventListener('unhandledrejection', (e) =>
    forward((e.reason && e.reason.message) || String(e.reason), e.reason && e.reason.stack),
  )

  parent.postMessage({ type: 'genesis:ready' }, '*')
})()
