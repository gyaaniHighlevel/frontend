/**
 * SSE stream client (LLD §10.2).
 *
 * Reads SSE frames from a streaming response, parses events, and invokes
 * a callback for each. Implements stall detection and proper cleanup.
 */

export interface SseEvent {
  type: string
  data: Record<string, unknown>
}

/**
 * Read an SSE stream and invoke onEvent for each parsed event.
 * Implements heartbeat detection and stall watchdog.
 *
 * @param url - The SSE endpoint URL
 * @param token - Firebase ID token for Authorization header
 * @param onEvent - Callback invoked for each parsed event
 * @param signal - Optional AbortSignal to cancel the stream
 * @throws Error if the stream fails or times out
 */
export async function readSseStream(
  url: string,
  token: string,
  onEvent: (event: SseEvent) => void,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ code: 'UNKNOWN', message: response.statusText }))
    throw new Error(`${err.code}: ${err.message}`)
  }

  if (!response.body) {
    throw new Error('No response body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let lastEventTime = Date.now()
  const stallTimeout = 45_000 // 45 seconds

  // Stall watchdog: if no event for 45s, abort
  const stallTimer = setInterval(() => {
    if (Date.now() - lastEventTime > stallTimeout) {
      reader.cancel()
      clearInterval(stallTimer)
    }
  }, 5_000)

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value)

      // Split on \n\n (SSE frame boundary)
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? '' // Keep incomplete frame in buffer

      for (const frame of frames) {
        if (!frame.trim()) continue

        // Skip heartbeat comments
        if (frame.startsWith(':')) {
          lastEventTime = Date.now()
          continue
        }

        // Parse event: name and data
        const lines = frame.split('\n')
        let eventType = 'message'
        let eventData = ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6)
          }
        }

        if (eventData) {
          try {
            const data = JSON.parse(eventData)
            onEvent({ type: eventType, data })
            lastEventTime = Date.now()
          } catch (e) {
            console.error('Failed to parse SSE event data:', eventData, e)
          }
        }
      }
    }
  } finally {
    clearInterval(stallTimer)
    reader.releaseLock()
  }
}
