import type { DiffFile, DiffLine } from '@/types'

/**
 * Minimal line diff for the version-history pane: trims the common prefix and
 * suffix, then reports the middle as one del/add block with two context lines
 * on each side. Not an LCS — good enough to show what a version changed.
 */
export function diffLines(path: string, before: string, after: string): DiffFile | null {
  if (before === after) return null
  const a = before.split('\n')
  const b = after.split('\n')

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const lines: DiffLine[] = []
  const CONTEXT = 2
  for (let i = Math.max(0, start - CONTEXT); i < start; i++) {
    lines.push({ kind: 'ctx', num: i + 1, text: a[i] })
  }
  for (let i = start; i < endA; i++) {
    lines.push({ kind: 'del', num: i + 1, text: `− ${a[i]}` })
  }
  for (let i = start; i < endB; i++) {
    lines.push({ kind: 'add', num: i + 1, text: `+ ${b[i]}` })
  }
  for (let i = endB; i < Math.min(b.length, endB + CONTEXT); i++) {
    lines.push({ kind: 'ctx', num: i + 1, text: b[i] })
  }
  return { path, lines }
}

/** Added/removed line counts across a set of file diffs. */
export function diffStats(files: DiffFile[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const file of files) {
    for (const line of file.lines) {
      if (line.kind === 'add') added++
      else if (line.kind === 'del') removed++
    }
  }
  return { added, removed }
}
