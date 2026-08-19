import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ChatMessage, DiffFile, Version, WorkspaceFile } from '@/types'
import { buildSrcdoc } from '@/lib/previewBuilder'
import { seedFiles } from './seedFiles'

/** Mock stand-in for the deployed proxy's Cloud Run URL (LLD §11). */
const PROXY_URL = 'https://hl-proxy.genesis.local'
const PROJECT_ID = 'contacts-calendar-hub'

const demoMessages: ChatMessage[] = [
  {
    id: 'm1',
    role: 'user',
    text: 'Build me a dashboard that shows my recent contacts and upcoming calendar appointments.',
  },
  {
    id: 'm2',
    role: 'assistant',
    text: 'Wired two endpoints and built the layout. Contacts come from the last 30 days; appointments cover the next 7.',
    apiCalls: [
      { method: 'GET', path: '/contacts/?limit=25' },
      { method: 'GET', path: '/calendars/events' },
    ],
    checklist: ['Created 3 files', 'Data flows through the hl-sdk shim', 'Preview rebuilt in 1.8s'],
    filesChanged: ['index.html', 'app.js', 'styles.css'],
  },
  { id: 'm3', role: 'user', text: 'Add a column for last message sent.' },
  {
    id: 'm4',
    role: 'assistant',
    text: 'That needs the Conversations API. Adding `conversations.readonly` to the app scopes.',
    scopeRequest: { scope: 'conversations.readonly' },
  },
]

const demoVersions: Version[] = [
  { id: 'v14', version: 14, title: 'Added last-message column', timeLabel: '12 min ago', filesLabel: '3 files', status: 'live' },
  { id: 'v13', version: 13, title: 'Split agenda into its own section', timeLabel: '38 min ago', filesLabel: '2 files', status: 'ok' },
  { id: 'v12', version: 12, title: 'Handled expired HighLevel token', timeLabel: '1h ago', filesLabel: '1 file', status: 'ok' },
  { id: 'v11', version: 11, title: 'Filtered appointments to next 7 days', timeLabel: '1h ago', filesLabel: '2 files', status: 'ok' },
  { id: 'v10', version: 10, title: 'Contacts table — first working build', timeLabel: '2h ago', filesLabel: '3 files', status: 'ok' },
  { id: 'v9', version: 9, title: 'Missing calendars.readonly scope', timeLabel: '2h ago', filesLabel: '', status: 'failed' },
]

const demoDiff: DiffFile[] = [
  {
    path: 'index.html',
    lines: [
      { kind: 'ctx', num: 42, text: '  <th>Source</th>' },
      { kind: 'del', num: 43, text: '− <th>Added</th>' },
      { kind: 'add', num: 43, text: '+ <th>Last message</th>' },
      { kind: 'add', num: 44, text: '+ <th>Added</th>' },
      { kind: 'ctx', num: 45, text: '' },
      { kind: 'ctx', num: 46, text: '  <td>{{ contact.source }}</td>' },
      { kind: 'add', num: 47, text: '+ <td>{{ lastMessage(contact.id) }}</td>' },
    ],
  },
  {
    path: 'app.js',
    lines: [
      { kind: 'ctx', num: 18, text: '  const [contactsRes, eventsRes] = await Promise.all([' },
      { kind: 'ctx', num: 19, text: '    hl.contacts.list({ limit: 25 }),' },
      { kind: 'add', num: 20, text: '+   hl.conversations.list({ limit: 50 }),' },
      { kind: 'ctx', num: 21, text: '  ])' },
    ],
  },
]

function cloneSeed(): WorkspaceFile[] {
  return seedFiles.map((f) => ({ ...f }))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Mock workspace store for one open project. The working tree holds exactly
 * the three contract files (LLD §1.2); the preview srcdoc is rebuilt only on
 * generation commit, restore, or explicit reload (decision 6: full iframe
 * reload, preview always equals the head snapshot). Firestore listeners, the
 * SSE client, and Monaco replace the mocks later; the contract stays.
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const projectName = ref('Contacts & Calendar Hub')
  const version = ref(14)
  const saved = ref(true)
  const model = ref('claude')
  const tokensLabel = ref('18.4k tokens')

  const messages = ref<ChatMessage[]>([...demoMessages])
  const prompt = ref('')

  const files = ref<WorkspaceFile[]>(cloneSeed())
  const activeFilePath = ref('index.html')
  const activeFile = computed(
    () => files.value.find((f) => f.path === activeFilePath.value) ?? files.value[0],
  )

  const generationStatus = ref<'idle' | 'streaming'>('idle')

  const srcdoc = ref(buildSrcdoc({ files: files.value, proxyUrl: PROXY_URL, projectId: PROJECT_ID }))
  const previewKey = ref(0)
  const previewError = ref<string | null>(null)

  const versions = ref<Version[]>([...demoVersions])
  const historyOpen = ref(false)
  const viewingVersionId = ref('v13')
  const viewingVersion = computed(
    () => versions.value.find((v) => v.id === viewingVersionId.value) ?? versions.value[1],
  )
  const diff = ref<DiffFile[]>([...demoDiff])

  function openFile(path: string) {
    if (files.value.some((f) => f.path === path)) activeFilePath.value = path
  }

  /** Full iframe reload from the current working tree (decision 6). */
  function rebuildPreview() {
    srcdoc.value = buildSrcdoc({ files: files.value, proxyUrl: PROXY_URL, projectId: PROJECT_ID })
    previewKey.value++
    previewError.value = null
  }

  function reportPreviewError(message: string) {
    previewError.value = message
  }

  /**
   * Simulates one generation turn against the mock backend: replays the SSE
   * event flow (§7.4) locally — file_start clears the file, file_delta chunks
   * append into the editor, done commits and reloads the preview.
   */
  async function runGeneration() {
    generationStatus.value = 'streaming'
    saved.value = false
    const targets = cloneSeed()

    for (const target of targets) {
      const file = files.value.find((f) => f.path === target.path)
      if (!file) continue
      activeFilePath.value = target.path // file_start: open/focus tab
      file.content = ''
      for (let i = 0; i < target.content.length; i += 64) {
        file.content += target.content.slice(i, i + 64) // file_delta
        await sleep(12)
      }
    }

    // done: bump head, persist the assistant turn, full preview reload
    version.value++
    versions.value.unshift({
      id: `v${version.value}`,
      version: version.value,
      title: 'Regenerated from prompt',
      timeLabel: 'just now',
      filesLabel: '3 files',
      status: 'live',
    })
    const previous = versions.value[1]
    if (previous?.status === 'live') previous.status = 'ok'
    messages.value.push({
      id: `m${messages.value.length + 1}`,
      role: 'assistant',
      text: 'Rebuilt the app from your prompt. Contacts, appointments and unread threads load through the hl-sdk shim.',
      checklist: ['Rewrote 3 files', 'Preview rebuilt'],
      filesChanged: ['index.html', 'app.js', 'styles.css'],
    })
    saved.value = true
    generationStatus.value = 'idle'
    rebuildPreview()
  }

  function sendPrompt() {
    const text = prompt.value.trim()
    if (!text || generationStatus.value === 'streaming') return
    messages.value.push({ id: `m${messages.value.length + 1}`, role: 'user', text })
    prompt.value = ''
    void runGeneration()
  }

  /** Mock restore (LLD §8.3): reload the preview from the restored tree. */
  function restoreViewingVersion() {
    files.value = cloneSeed()
    rebuildPreview()
    historyOpen.value = false
  }

  return {
    projectName,
    version,
    saved,
    model,
    tokensLabel,
    messages,
    prompt,
    files,
    activeFilePath,
    activeFile,
    generationStatus,
    srcdoc,
    previewKey,
    previewError,
    versions,
    historyOpen,
    viewingVersionId,
    viewingVersion,
    diff,
    openFile,
    rebuildPreview,
    reportPreviewError,
    sendPrompt,
    restoreViewingVersion,
  }
})
