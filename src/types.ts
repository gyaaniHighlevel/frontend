/** HighLevel API families a project can depend on. */
export type HlScope = 'contacts' | 'conversations' | 'calendars'

export type ProjectStatus = 'published' | 'generating' | 'draft' | 'failed'

export interface Project {
  id: string
  name: string
  description: string
  initials: string
  /** Icon tile tint. */
  iconBg: string
  iconColor: string
  status: ProjectStatus
  scopes: HlScope[]
  version: number
  /** Relative-time label shown in the card footer (mock). */
  editedLabel: string
  /** Footer note overriding the default "vN · edited X" (failed reason, generating activity). */
  statusNote?: string
  /** 0-100, only while status === 'generating'. */
  progress?: number
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

/** One file of the working tree under the fixed three-file contract (LLD §1.2). */
export interface WorkspaceFile {
  path: string
  content: string
}

/** One colored token of pre-highlighted mock source code. */
export interface CodeSegment {
  t: string
  /** Text color; defaults to the editor's base tone. */
  c?: string
}

export interface CodeLine {
  seg: CodeSegment[]
  /** Row highlighted as recently written by the model. */
  highlight?: boolean
}

export type VersionStatus = 'live' | 'ok' | 'failed'

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
