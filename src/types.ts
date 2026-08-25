/** The fixed three-file contract (LLD §1.2). */
export type FilePath = 'index.html' | 'app.js' | 'styles.css'

export type FileUpdatedBy = 'seed' | 'user' | 'restore' | 'llm'

export type SnapshotTrigger = 'seed' | 'generation' | 'manual' | 'restore'

/** projects/{pid}, normalized (timestamps as Dates) from either transport. */
export interface Project {
  id: string
  name: string
  description: string
  status: 'active' | 'deleted'
  headSnapshotId: string
  createdAt: Date
  updatedAt: Date
}

/** projects/{pid}/files/{fid} — one file of the mutable working tree. */
export interface ProjectFile {
  path: FilePath
  content: string
  size: number
  sha256: string
  updatedAt: Date
  updatedBy: FileUpdatedBy
}

export interface SnapshotEntry {
  path: FilePath
  sha256: string
  size: number
}

/** projects/{pid}/snapshots/{sid} — manifest only; content lives in blobs. */
export interface Snapshot {
  id: string
  createdAt: Date
  trigger: SnapshotTrigger
  restoredFrom: string | null
  label: string | null
  files: SnapshotEntry[]
}

/** users/{uid} — `hl` is a server-managed mirror of the HighLevel connection. */
export interface UserProfile {
  email: string
  displayName: string | null
  hl: { connected: boolean; locationId?: string; locationName?: string }
}

export interface HlApiCall {
  method: 'GET' | 'POST' | 'PUT'
  path: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  /** Message body; `backtick` spans render as inline code. */
  text: string
  apiCalls?: HlApiCall[]
  checklist?: string[]
  /** Renders Approve scope / Skip actions. */
  scopeRequest?: { scope: string }
  /** Paths this turn rewrote, rendered as chips (the "[updated app.js]" marker). */
  filesChanged?: string[]
}

/** One file of the working tree as the editor/preview consume it. */
export interface WorkspaceFile {
  path: string
  content: string
}


export type VersionStatus = 'live' | 'ok' | 'failed'

/** Display row of the version-history sheet, derived from a Snapshot. */
export interface Version {
  id: string
  version: number
  title: string
  timeLabel: string
  filesLabel: string
  status: VersionStatus
}

export type DiffLineKind = 'ctx' | 'add' | 'del'

export interface DiffLine {
  kind: DiffLineKind
  num: number
  text: string
}

export interface DiffFile {
  path: string
  lines: DiffLine[]
}
