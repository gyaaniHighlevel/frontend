/**
 * Content-addressing helpers (frontend-integration.md §2.4). These MUST match
 * the backend exactly: `sha256` is lowercase hex over UTF-8 bytes, `size` is
 * the UTF-8 byte length, `fileId` is base64url of the path without padding.
 * `saveSnapshot` trusts the file doc's hash as the blob key, so a wrong value
 * here corrupts version history silently — never hand-write these fields.
 */

const encoder = new TextEncoder()

export const byteSize = (content: string): number => encoder.encode(content).length

export async function sha256hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(content))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// File paths are ASCII ("index.html" | "app.js" | "styles.css"), so btoa is safe.
export const fileId = (path: string): string =>
  btoa(path).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
