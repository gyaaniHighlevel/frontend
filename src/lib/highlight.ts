import type { CodeLine, CodeSegment } from '@/types'

/** Editor syntax palette (matches the mockups' hand-highlighted code). */
const KEYWORD = '#c084fc'
const STRING = '#86efac'
const IDENT = '#60a5fa'
const TAG = '#7c8db0'
const NUMBER = '#fbbf24'
const COMMENT = '#5b6f94'

export type Language = 'html' | 'js' | 'css'

export function languageFor(path: string): Language {
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.css')) return 'css'
  return 'js'
}

const JS_TOKEN =
  /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b(import|from|export|const|let|var|function|async|await|return|if|else|new|null|undefined|true|false|default|try|catch|finally)\b|\b(\d+(?:\.\d+)?(?:e\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g

function highlightJsLine(line: string): CodeSegment[] {
  const seg: CodeSegment[] = []
  let last = 0
  for (const m of line.matchAll(JS_TOKEN)) {
    const idx = m.index ?? 0
    if (idx > last) seg.push({ t: line.slice(last, idx) })
    const c = m[1] ? COMMENT : m[2] ? STRING : m[3] ? KEYWORD : m[4] ? NUMBER : IDENT
    seg.push({ t: m[0], c })
    last = idx + m[0].length
  }
  if (last < line.length) seg.push({ t: line.slice(last) })
  return seg
}

/** Colors attribute strings inside an already-matched tag token. */
function splitTagToken(tag: string): CodeSegment[] {
  const seg: CodeSegment[] = []
  let last = 0
  for (const m of tag.matchAll(/"[^"]*"/g)) {
    const idx = m.index ?? 0
    if (idx > last) seg.push({ t: tag.slice(last, idx), c: TAG })
    seg.push({ t: m[0], c: STRING })
    last = idx + m[0].length
  }
  if (last < tag.length) seg.push({ t: tag.slice(last), c: TAG })
  return seg
}

function highlightHtmlLine(line: string): CodeSegment[] {
  const seg: CodeSegment[] = []
  let last = 0
  for (const m of line.matchAll(/<\/?[^>]*>?/g)) {
    const idx = m.index ?? 0
    if (idx > last) seg.push({ t: line.slice(last, idx) })
    seg.push(...splitTagToken(m[0]))
    last = idx + m[0].length
  }
  if (last < line.length) seg.push({ t: line.slice(last) })
  return seg
}

const CSS_TOKEN =
  /(\/\*.*?\*\/)|(#[0-9a-fA-F]{3,8}\b)|(-?\d+(?:\.\d+)?(?:px|rem|em|%|s|ms|vh|vw)?)|([a-z-]+)(?=\s*:)/g

function highlightCssLine(line: string): CodeSegment[] {
  const seg: CodeSegment[] = []
  let last = 0
  for (const m of line.matchAll(CSS_TOKEN)) {
    const idx = m.index ?? 0
    if (idx > last) seg.push({ t: line.slice(last, idx) })
    const c = m[1] ? COMMENT : m[2] ? STRING : m[3] ? NUMBER : TAG
    seg.push({ t: m[0], c })
    last = idx + m[0].length
  }
  if (last < line.length) seg.push({ t: line.slice(last) })
  return seg
}

/**
 * Lightweight line-based tokenizer for the read-only mock editor. Monaco
 * replaces this wholesale (LLD §10.3) — do not grow it toward a real parser.
 */
export function highlight(content: string, lang: Language): CodeLine[] {
  const lineFn =
    lang === 'html' ? highlightHtmlLine : lang === 'css' ? highlightCssLine : highlightJsLine
  return content.split('\n').map((line) => ({ seg: line ? lineFn(line) : [] }))
}
