import hlSdkSource from '@/assets/hl-sdk.js?raw'

export interface PreviewFile {
  path: string
  content: string
}

/** The fixed three-file contract (LLD §1.2): path validation is set membership. */
export const ALLOWED_PATHS = ['index.html', 'app.js', 'styles.css'] as const
export type AllowedPath = (typeof ALLOWED_PATHS)[number]

/**
 * A literal `</script` inside embedded content would terminate the inline
 * module and truncate the document (LLD §9.1 escaping rule).
 */
function esc(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script')
}

/**
 * buildSrcdoc (LLD §9.1): wraps the generated three files in the
 * platform-owned document shell — CSP meta, Tailwind CDN, import map pinning
 * vue, [v-cloak] style + styles.css, window.__GENESIS__, inlined hl-sdk shim.
 * The model's index.html becomes the body; app.js runs as an inline module.
 *
 * Render it in an `<iframe sandbox="allow-scripts">` — never allow-same-origin
 * (INV-5): the opaque origin plus connect-src is the security boundary.
 */
export function buildSrcdoc({
  files,
  proxyUrl,
  projectId,
}: {
  files: PreviewFile[]
  proxyUrl: string
  projectId: string
}): string {
  const file = (path: AllowedPath) => files.find((f) => f.path === path)?.content ?? ''
  const proxyOrigin = new URL(proxyUrl).origin

  // 'unsafe-eval' anticipates the in-DOM template compiler (new Function) of
  // the full Vue ESM build — VER-4. connect-src stays the boundary.
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com",
    "style-src 'unsafe-inline' https://cdn.tailwindcss.com",
    `connect-src ${proxyOrigin}`,
    'img-src https: data:',
    'font-src https: data:',
  ].join('; ')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<script src="https://cdn.tailwindcss.com"><\/script>
<script type="importmap">
{ "imports": { "vue": "https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js" } }
<\/script>
<style>
[v-cloak]{display:none}
${esc(file('styles.css'))}
</style>
<script>
window.__GENESIS__ = ${JSON.stringify({ projectId, proxyUrl })}
<\/script>
<script>
${esc(hlSdkSource)}
<\/script>
</head>
<body>
${file('index.html')}
<script type="module">
${esc(file('app.js'))}
<\/script>
</body>
</html>`
}
