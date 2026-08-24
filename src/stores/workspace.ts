import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import type { ChatMessage, DiffFile, Project, ProjectFile, Snapshot, Version } from '@/types'
import { firebaseAuth, firestore } from '@/lib/firebase'
import { api } from '@/lib/api'
import {
  backendErrorMessage,
  mapFile,
  mapProject,
  mapSnapshot,
  renameProject as renameProjectFn,
  restoreSnapshot as restoreSnapshotFn,
  saveSnapshot as saveSnapshotFn,
  type FileWire,
  type ProjectWire,
  type SnapshotWire,
} from '@/lib/backend'
import { byteSize, fileId, sha256hex } from '@/lib/content'
import { buildSrcdoc, ALLOWED_PATHS } from '@/lib/previewBuilder'
import { relativeTime } from '@/lib/utils'
import { diffLines } from '@/lib/diff'
import { seedFiles } from './seedFiles'
import { readSseStream, type SseEvent } from '@/lib/sseClient'

/** Base URL of the `api` function — the HL proxy lives under /hl on it. */
const PROXY_URL = import.meta.env.VITE_API_BASE as string | undefined

/** Mock LLM flag: if true, use seed files instead of real generation. */
const MOCK_LLM = import.meta.env.VITE_MOCK_LLM === 'true'

const FILE_ORDER: Record<string, number> = { 'index.html': 0, 'app.js': 1, 'styles.css': 2 }
const byPath = (a: ProjectFile, b: ProjectFile) =>
  (FILE_ORDER[a.path] ?? 9) - (FILE_ORDER[b.path] ?? 9)

const SNAPSHOT_TITLES: Record<Snapshot['trigger'], string> = {
  seed: 'Starter template',
  manual: 'Manual save',
  restore: 'Restored from an earlier version',
  generation: 'Generated from prompt',
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let localSeq = 0
const localId = () => `local-${++localSeq}`

/**
 * Workspace store for one open project, backed by the real API
 * (frontend-integration.md §7–9): REST for the initial parallel fetch,
 * Firestore onSnapshot for live project/file updates, and the mock "send"
 * flow (§8) — batch-update the three file docs with the seed tree, then
 * saveSnapshot. When real generation ships, sendPrompt collapses into one
 * POST /generate SSE call.
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const projectId = ref<string | null>(null)
  const project = ref<Project | null>(null)
  const files = ref<ProjectFile[]>([])
  const snapshots = ref<Snapshot[]>([])
  const messages = ref<ChatMessage[]>([])

  const loading = ref(false)
  const loadError = ref<string | null>(null)

   const prompt = ref('')
   const saved = ref(true)
   const hasUnsavedChanges = ref(false)
   const model = ref('claude')
   const tokensLabel = ref('')
   const generationStatus = ref<'idle' | 'requesting' | 'streaming' | 'committing'>('idle')
   const generationId = ref<string | null>(null)
   const busy = computed(() => generationStatus.value !== 'idle')

  const projectName = computed(() => project.value?.name ?? '…')
  const version = computed(() => snapshots.value.length)

  const activeFilePath = ref('index.html')
  const activeFile = computed<ProjectFile>(
    () =>
      files.value.find((f) => f.path === activeFilePath.value) ??
      files.value[0] ?? {
        path: 'index.html',
        content: '',
        size: 0,
        sha256: '',
        updatedAt: new Date(),
        updatedBy: 'seed',
      },
  )

  const srcdoc = ref('')
  const previewKey = ref(0)
  const previewError = ref<string | null>(null)

  const historyOpen = ref(false)
  const viewingVersionId = ref<string | null>(null)
  const diff = ref<DiffFile[]>([])
  const diffLoading = ref(false)
  const restoring = ref(false)

  const versions = computed<Version[]>(() =>
    snapshots.value.map((s, i) => ({
      id: s.id,
      version: snapshots.value.length - i,
      title: s.label ?? SNAPSHOT_TITLES[s.trigger],
      timeLabel: relativeTime(s.createdAt),
      filesLabel: `${s.files.length} files`,
      status: s.id === project.value?.headSnapshotId ? 'live' : 'ok',
    })),
  )

  const viewingVersion = computed<Version | null>(
    () => versions.value.find((v) => v.id === viewingVersionId.value) ?? null,
  )

  let unsubs: Unsubscribe[] = []

  function openFile(path: string) {
    if (files.value.some((f) => f.path === path)) activeFilePath.value = path
  }

  /** Full iframe reload from the current working tree (decision 6). */
  function rebuildPreview() {
    if (!projectId.value || !PROXY_URL) return
    srcdoc.value = buildSrcdoc({
      files: files.value,
      proxyUrl: PROXY_URL,
      projectId: projectId.value,
    })
    previewKey.value++
    previewError.value = null
  }

  function reportPreviewError(message: string) {
    previewError.value = message
  }

  // --- Loading -------------------------------------------------------------

  async function refreshFiles(pid: string): Promise<void> {
    const { items } = await api<{ items: FileWire[] }>('GET', `/projects/${pid}/files`)
    files.value = items.map(mapFile).sort(byPath)
  }

  async function refreshSnapshots(pid: string): Promise<void> {
    const { items } = await api<{ items: SnapshotWire[] }>('GET', `/projects/${pid}/snapshots?limit=50`)
    snapshots.value = items.map(mapSnapshot)
  }

  async function refreshProject(pid: string): Promise<void> {
    project.value = mapProject(await api<ProjectWire>('GET', `/projects/${pid}`))
  }

  async function loadMessages(pid: string): Promise<void> {
    const uid = firebaseAuth.currentUser?.uid
    if (!uid) return
    // The ownerUid filter is required: list queries must be provably covered
    // by the security rules (`read: if isOwner()`), or they are denied.
    // Sorted client-side to avoid needing a composite index for equality+orderBy.
    const snap = await getDocs(
      query(collection(firestore, 'projects', pid, 'messages'), where('ownerUid', '==', uid), limit(100)),
    )
    messages.value = snap.docs
      .map((d) => {
        const data = d.data()
        return {
          id: d.id,
          role: 'user' as const,
          text: (data.content as string) ?? '',
          createdAt: (data.createdAt as Timestamp | null)?.toMillis() ?? 0,
        }
      })
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ createdAt: _createdAt, ...message }) => message)
    if (messages.value.length === 0) {
      messages.value.push({
        id: localId(),
        role: 'assistant',
        text: 'New project ready. Describe what you want to build and press Send — I will generate the three app files and save a version.',
      })
    }
  }

  function attachListeners(pid: string) {
    // Live project doc: name, headSnapshotId, status (rules grant owner reads).
    unsubs.push(
      onSnapshot(
        doc(firestore, 'projects', pid),
        (snap) => {
          const data = snap.data()
          if (!data || !project.value) return
          project.value = {
            ...project.value,
            name: data.name as string,
            description: data.description as string,
            status: data.status as Project['status'],
            headSnapshotId: data.headSnapshotId as string,
            updatedAt: (data.updatedAt as Timestamp | null)?.toDate() ?? project.value.updatedAt,
          }
        },
        (e) => console.error('project listener failed:', e),
      ),
    )
    // Live files — lets other tabs converge; paused while this tab streams the
    // mock generation so remote echoes don't clobber the typing animation.
    const uid = firebaseAuth.currentUser?.uid
    if (!uid) return
    unsubs.push(
      onSnapshot(
        query(collection(firestore, 'projects', pid, 'files'), where('ownerUid', '==', uid)),
        (snap) => {
          if (generationStatus.value !== 'idle') return
          const items = snap.docs
            .map((d) => mapFile(d.data() as FileWire))
            .sort(byPath)
          if (items.length > 0) files.value = items
        },
        (e) => console.error('files listener failed:', e),
      ),
    )
  }

  /** Three parallel fetches populate the workspace (§7); 403/404 → loadError. */
  async function openProject(pid: string): Promise<void> {
    closeProject()
    projectId.value = pid
    loading.value = true
    loadError.value = null
    try {
      const [projectWire, filesRes, snapsRes] = await Promise.all([
        api<ProjectWire>('GET', `/projects/${pid}`),
        api<{ items: FileWire[] }>('GET', `/projects/${pid}/files`),
        api<{ items: SnapshotWire[] }>('GET', `/projects/${pid}/snapshots?limit=50`),
      ])
      project.value = mapProject(projectWire)
      files.value = filesRes.items.map(mapFile).sort(byPath)
      snapshots.value = snapsRes.items.map(mapSnapshot)
      activeFilePath.value = 'index.html'
      saved.value = true
      await loadMessages(pid)
      attachListeners(pid)
      rebuildPreview()
    } catch (e) {
      loadError.value = backendErrorMessage(e)
    } finally {
      loading.value = false
    }
  }

  function closeProject() {
    unsubs.forEach((u) => u())
    unsubs = []
    projectId.value = null
    project.value = null
    files.value = []
    snapshots.value = []
    messages.value = []
    prompt.value = ''
    srcdoc.value = ''
    previewError.value = null
    loadError.value = null
    historyOpen.value = false
    viewingVersionId.value = null
    diff.value = []
    generationStatus.value = 'idle'
  }

  async function rename(name: string): Promise<void> {
    const trimmed = name.trim()
    if (!projectId.value || !trimmed || trimmed === project.value?.name) return
    await renameProjectFn({ projectId: projectId.value, name: trimmed })
    if (project.value) project.value = { ...project.value, name: trimmed }
  }

  /** Update file content and mark as having unsaved changes. */
  function updateFileContent(path: string, content: string): void {
    const file = files.value.find((f) => f.path === path)
    if (file) {
      file.content = content
      hasUnsavedChanges.value = true
      rebuildPreview()
    }
  }

  /** Commit manual changes by creating a new snapshot. */
  async function commitManualChanges(): Promise<void> {
    const pid = projectId.value
    if (!pid || !hasUnsavedChanges.value || busy.value) return

    generationStatus.value = 'committing'
    try {
      // Update all files in Firestore
      const batch = writeBatch(firestore)
      for (const file of files.value) {
        batch.update(doc(firestore, 'projects', pid, 'files', fileId(file.path)), {
          content: file.content,
          size: byteSize(file.content),
          sha256: await sha256hex(file.content),
          updatedAt: serverTimestamp(),
          updatedBy: 'user',
        })
      }
      await batch.commit()

      // Create a snapshot with trigger 'manual'
      await saveSnapshotFn({ projectId: pid })

      // Refresh to get the new snapshot and updated project
      await Promise.all([refreshFiles(pid), refreshSnapshots(pid), refreshProject(pid)])

      hasUnsavedChanges.value = false
      rebuildPreview()
      generationStatus.value = 'idle'
    } catch (e) {
      console.error('Failed to commit manual changes:', e)
      generationStatus.value = 'idle'
      // Re-sync the working tree with the server after a failure
      await refreshFiles(pid).catch(() => undefined)
    }
  }

  // --- Generation (§7): SSE streaming or mock seed files -------

  /** Attach listener to generation doc for fallback (§7.9). */
  function attachGenerationListener(pid: string, genId: string) {
    unsubs.push(
      onSnapshot(
        doc(firestore, 'projects', pid, 'generations', genId),
        (snap) => {
          const data = snap.data()
          if (!data) return
          const status = data.status as string
          const usage = data.usage as { inputTokens: number; outputTokens: number; cacheReadTokens: number } | null

          // Update token label from real usage
          if (usage) {
            const total = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0)
            tokensLabel.value = `${total.toLocaleString()} tokens`
          }

          // Handle terminal states
          if (status === 'completed') {
            generationStatus.value = 'committing'
            // Refresh to get the new snapshot and files
            Promise.all([refreshFiles(pid), refreshSnapshots(pid), refreshProject(pid)])
              .then(() => {
                rebuildPreview()
                generationStatus.value = 'idle'
              })
              .catch((e) => {
                console.error('Failed to refresh after generation:', e)
                generationStatus.value = 'idle'
              })
          } else if (status === 'failed') {
            const error = data.error as { code: string; message: string } | null
            messages.value.push({
              id: localId(),
              role: 'assistant',
              text: `Generation failed: ${error?.message ?? 'Unknown error'}`,
            })
            generationStatus.value = 'idle'
          }
        },
        (e) => console.error('generation listener failed:', e),
      ),
    )
  }

  async function sendPrompt(): Promise<void> {
    const text = prompt.value.trim()
    const pid = projectId.value
    if (!text || busy.value || !pid) return

    messages.value.push({ id: localId(), role: 'user', text })
    prompt.value = ''
    saved.value = false

    // 1. Persist the chat message (UI history only; rules require role 'user').
    const uid = firebaseAuth.currentUser?.uid
    if (uid) {
      void addDoc(collection(firestore, 'projects', pid, 'messages'), {
        ownerUid: uid,
        role: 'user',
        content: text.slice(0, 4000),
        createdAt: serverTimestamp(),
      }).catch((e) => console.error('message write failed:', e))
    }

    try {
      if (MOCK_LLM) {
        // Mock flow: stream seed files into editor
        generationStatus.value = 'streaming'
        const targets = seedFiles.map((f) => ({ ...f }))
        for (const target of targets) {
          const file = files.value.find((f) => f.path === target.path)
          if (!file) continue
          activeFilePath.value = target.path
          file.content = ''
          for (let i = 0; i < target.content.length; i += 64) {
            file.content += target.content.slice(i, i + 64)
            await sleep(8)
          }
        }

        generationStatus.value = 'committing'
        const batch = writeBatch(firestore)
        for (const target of targets) {
          batch.update(doc(firestore, 'projects', pid, 'files', fileId(target.path)), {
            content: target.content,
            size: byteSize(target.content),
            sha256: await sha256hex(target.content),
            updatedAt: serverTimestamp(),
            updatedBy: 'user',
          })
        }
        await batch.commit()
        await saveSnapshotFn({ projectId: pid, label: text.slice(0, 80) })
        await Promise.all([refreshFiles(pid), refreshSnapshots(pid), refreshProject(pid)])

        messages.value.push({
          id: localId(),
          role: 'assistant',
          text: 'Rebuilt the app from your prompt and saved a new version.',
          checklist: ['Wrote 3 files', `Snapshot v${snapshots.value.length} saved`, 'Preview reloaded'],
          filesChanged: [...ALLOWED_PATHS],
        })
        saved.value = true
        rebuildPreview()
        generationStatus.value = 'idle'
      } else {
        // Real SSE flow: POST /generate
        generationStatus.value = 'requesting'
        const token = await firebaseAuth.currentUser?.getIdToken()
        if (!token) throw new Error('No auth token')

        const generateUrl = `${PROXY_URL}/generate`
        let narration = ''
        let assistantMessageId = localId()

        await readSseStream(
          generateUrl,
          token,
          (event: SseEvent) => {
            switch (event.type) {
            case 'meta': {
              const genId = event.data.generationId as string
              generationId.value = genId
              generationStatus.value = 'streaming'
              attachGenerationListener(pid, genId)
              break
            }
            case 'text': {
              const delta = event.data.delta as string
              narration += delta
              const lastMsg = messages.value[messages.value.length - 1]
              if (lastMsg?.role === 'assistant' && lastMsg.id === assistantMessageId) {
                lastMsg.text = narration
              } else {
                messages.value.push({
                  id: assistantMessageId,
                  role: 'assistant',
                  text: narration,
                })
              }
              break
            }
            case 'file_start': {
              const path = event.data.path as string
              activeFilePath.value = path
              const file = files.value.find((f) => f.path === path)
              if (file) file.content = ''
              break
            }
            case 'file_delta': {
              const path = event.data.path as string
              const delta = event.data.delta as string
              const file = files.value.find((f) => f.path === path)
              if (file) file.content += delta
              break
            }
            case 'file_end': {
              break
            }
            case 'done': {
              generationStatus.value = 'committing'
              const usage = event.data.usage as { inputTokens: number; outputTokens: number; cacheReadTokens: number } | null
              if (usage) {
                const total = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0)
                tokensLabel.value = `${total.toLocaleString()} tokens`
              }
              Promise.all([refreshFiles(pid), refreshSnapshots(pid), refreshProject(pid)])
                .then(() => {
                  rebuildPreview()
                  saved.value = true
                  generationStatus.value = 'idle'
                })
                .catch((e) => {
                  console.error('Failed to refresh after generation:', e)
                  generationStatus.value = 'idle'
                })
              break
            }
            case 'error': {
              const code = event.data.code as string
              const message = event.data.message as string
              messages.value.push({
                id: localId(),
                role: 'assistant',
                text: `Generation failed (${code}): ${message}`,
              })
              generationStatus.value = 'idle'
              break
            }
            }
          },
          { projectId: pid, prompt: text },
        )
      }
    } catch (e) {
      messages.value.push({
        id: localId(),
        role: 'assistant',
        text: `Generation failed: ${backendErrorMessage(e)}`,
      })
      generationStatus.value = 'idle'
      // Re-sync the working tree with the server after a partial failure.
      await refreshFiles(pid).catch(() => undefined)
    }
  }

  // --- Version history (§9) -------------------------------------------------

  /** Reads one snapshot's content out of the owner-readable blobs. */
  async function loadSnapshotContent(snapshot: Snapshot): Promise<Map<string, string>> {
    const pid = projectId.value
    if (!pid) return new Map()
    const entries = await Promise.all(
      snapshot.files.map(async (entry) => {
        const blob = await getDoc(doc(firestore, 'projects', pid, 'blobs', entry.sha256))
        return [entry.path, (blob.data()?.content as string) ?? ''] as const
      }),
    )
    return new Map(entries)
  }

  /** Diff of the viewed snapshot against the current working tree. */
  async function loadDiff(snapshotId: string): Promise<void> {
    const snapshot = snapshots.value.find((s) => s.id === snapshotId)
    if (!snapshot) {
      diff.value = []
      return
    }
    diffLoading.value = true
    try {
      const changed = snapshot.files.filter(
        (entry) => files.value.find((f) => f.path === entry.path)?.sha256 !== entry.sha256,
      )
      const content = changed.length > 0 ? await loadSnapshotContent(snapshot) : new Map<string, string>()
      diff.value = changed
        .map((entry) =>
          diffLines(
            entry.path,
            content.get(entry.path) ?? '',
            files.value.find((f) => f.path === entry.path)?.content ?? '',
          ),
        )
        .filter((d): d is DiffFile => d !== null)
    } catch (e) {
      console.error('diff load failed:', e)
      diff.value = []
    } finally {
      diffLoading.value = false
    }
  }

  // Default the history sheet to the newest non-live version; reload the diff
  // whenever the viewed version changes.
  watch(historyOpen, (open) => {
    if (!open) return
    if (!viewingVersion.value || viewingVersion.value.status === 'live') {
      viewingVersionId.value = versions.value.find((v) => v.status !== 'live')?.id ?? null
    }
    if (viewingVersionId.value) void loadDiff(viewingVersionId.value)
    else diff.value = []
  })
  watch(viewingVersionId, (id) => {
    if (historyOpen.value && id) void loadDiff(id)
  })

  /**
   * Restore never rewinds history (§9.2): the backend copies the target's
   * content into the working files and creates a new head snapshot.
   */
  async function restoreViewingVersion(): Promise<void> {
    const pid = projectId.value
    const target = viewingVersion.value
    if (!pid || !target || restoring.value) return
    restoring.value = true
    try {
      const { data } = await restoreSnapshotFn({ projectId: pid, snapshotId: target.id })
      await Promise.all([refreshFiles(pid), refreshSnapshots(pid), refreshProject(pid)])
      rebuildPreview()
      historyOpen.value = false
      messages.value.push({
        id: localId(),
        role: 'assistant',
        text: data.restored
          ? `Restored v${target.version} — saved as the new current version.`
          : `The working tree already matches v${target.version}; nothing to restore.`,
      })
    } catch (e) {
      messages.value.push({
        id: localId(),
        role: 'assistant',
        text: `Restore failed: ${backendErrorMessage(e)}`,
      })
    } finally {
      restoring.value = false
    }
  }

  return {
    projectId,
    project,
    projectName,
    version,
    saved,
    hasUnsavedChanges,
    model,
    tokensLabel,
    loading,
    loadError,
    messages,
    prompt,
    files,
    activeFilePath,
    activeFile,
    generationStatus,
    busy,
    srcdoc,
    previewKey,
    previewError,
    versions,
    historyOpen,
    viewingVersionId,
    viewingVersion,
    diff,
    diffLoading,
    restoring,
    openProject,
    closeProject,
    rename,
    openFile,
    rebuildPreview,
    reportPreviewError,
    sendPrompt,
    restoreViewingVersion,
    updateFileContent,
    commitManualChanges,
  }
})
