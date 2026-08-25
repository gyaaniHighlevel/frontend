/**
 * Language detection for Monaco editor.
 * Monaco replaces the custom highlight.ts tokenizer (LLD §10.3).
 */

export type Language = 'html' | 'javascript' | 'css'

export function languageFor(path: string): Language {
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.css')) return 'css'
  return 'javascript'
}
