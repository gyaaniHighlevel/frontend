<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import * as monaco from 'monaco-editor'
import { useWorkspaceStore } from '@/stores/workspace'
import { languageFor } from '@/lib/highlight'

const workspace = useWorkspaceStore()

const totalLines = computed(() =>
  workspace.files.reduce((sum, file) => sum + file.content.split('\n').length, 0),
)

/** Platform-owned pieces of the document shell (LLD §1.2) — shown for context. */
const platformFiles = ['hl-sdk.js', 'import map', 'tailwind']

// Monaco editor instance
const editorContainer = ref<HTMLElement>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null

// Track if we're editing (for Monaco, this is always true when focused)
const isEditing = ref(false)

// Initialize Monaco editor
onMounted(async () => {
  if (!editorContainer.value) return

  // Define custom theme to match the existing design
  monaco.editor.defineTheme('custom-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5b6f94' },
      { token: 'string', foreground: '86efac' },
      { token: 'number', foreground: 'fbbf24' },
      { token: 'keyword', foreground: 'c084fc' },
      { token: 'type', foreground: '60a5fa' },
      { token: 'tag', foreground: '7c8db0' },
    ],
    colors: {
      'editor.background': '#1a202c',
      'editor.foreground': '#cbd5e1',
      'editor.lineNumbersBackground': '#1a202c',
      'editor.lineNumbersForeground': '#3c4a63',
      'editor.selectionBackground': '#3b82f6',
      'editorCursor.foreground': '#cbd5e1',
      'editor.lineHighlightBackground': '#2d3748',
    },
  })

  editor = monaco.editor.create(editorContainer.value, {
    value: workspace.activeFile.content,
    language: languageFor(workspace.activeFile.path),
    theme: 'custom-dark',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 1.85 * 12,
    lineNumbers: 'on',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    readOnly: workspace.generationStatus !== 'idle',
    wordWrap: 'off',
    tabSize: 2,
    insertSpaces: true,
  })

  // Listen for content changes
  editor.onDidChangeModelContent(() => {
    const newContent = editor?.getValue() ?? ''
    workspace.updateFileContent(workspace.activeFilePath, newContent)
  })

  // Update read-only state based on generation status
  watch(
    () => workspace.generationStatus,
    (status) => {
      if (editor) {
        editor.updateOptions({ readOnly: status !== 'idle' })
      }
    },
  )
})

// Clean up editor on unmount
onBeforeUnmount(() => {
  editor?.dispose()
})

// Update editor when active file changes
watch(
  () => workspace.activeFilePath,
  async () => {
    if (!editor) return
    const newLanguage = languageFor(workspace.activeFile.path)
    const currentModel = editor.getModel()
    if (currentModel) {
      monaco.editor.setModelLanguage(currentModel, newLanguage)
    }
    editor.setValue(workspace.activeFile.content)
    isEditing.value = false
  },
)

// Update editor content when file content changes externally (e.g., from generation)
watch(
  () => workspace.activeFile.content,
  (newContent) => {
    if (editor && editor.getValue() !== newContent) {
      const position = editor.getPosition()
      editor.setValue(newContent)
      if (position) {
        editor.setPosition(position)
      }
    }
  },
)

// Auto-scroll to end during streaming generation
watch(
  () => workspace.generationStatus,
  async (status) => {
    if (status === 'streaming' && editor) {
      await nextTick()
      const lineCount = editor.getModel()?.getLineCount() ?? 0
      editor.revealLine(lineCount)
    }
  },
)
</script>

<template>
  <section class="flex w-[560px] shrink-0 flex-col border-r border-border bg-editor">
    <!-- Tabs: the working tree is exactly the three contract files -->
    <div class="flex items-center gap-0.5 border-b border-editor-border bg-editor-panel px-2.5">
      <button
        v-for="file in workspace.files"
        :key="file.path"
        type="button"
        class="border-b-2 px-[13px] py-[11px] font-mono text-xs leading-none"
        :class="
          file.path === workspace.activeFilePath
            ? 'border-[#3b82f6] font-medium text-[#e2e8f0]'
            : 'border-transparent text-[#64748b] hover:text-[#94a3b8]'
        "
        @click="workspace.openFile(file.path)"
      >
        {{ file.path }}
      </button>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <!-- File tree: three paths + read-only platform shell entries -->
      <div class="flex w-[150px] shrink-0 flex-col gap-[7px] border-r border-editor-border-soft px-3 py-3.5 font-mono text-[11.5px] leading-normal">
        <div class="text-[#94a3b8]">app</div>
        <button
          v-for="file in workspace.files"
          :key="file.path"
          type="button"
          class="pl-2.5 text-left hover:text-[#cbd5e1]"
          :class="file.path === workspace.activeFilePath ? 'text-[#e2e8f0]' : 'text-[#7b8aa3]'"
          @click="workspace.openFile(file.path)"
        >
          {{ file.path }}
        </button>
        <div class="mt-2 text-[#94a3b8]">platform</div>
        <div
          v-for="name in platformFiles"
          :key="name"
          class="pl-2.5 text-[#4a5a78]"
          title="Owned by the platform shell — not editable"
        >
          {{ name }}
        </div>
      </div>

      <!-- Monaco Editor -->
      <div class="flex-1 overflow-hidden flex flex-col">
        <div ref="editorContainer" class="flex-1" />
      </div>
    </div>

    <!-- Status bar -->
    <div class="flex items-center justify-between border-t border-editor-border bg-editor-panel px-3.5 py-[9px] font-mono text-[11px] leading-none text-[#64748b]">
      <span>{{ workspace.files.length }} files · {{ totalLines }} lines</span>
      <span v-if="workspace.generationStatus === 'streaming'" class="text-[#fbbf24]">
        generating…
      </span>
      <span v-else class="text-[#86efac]">build ok · 1.8s</span>
    </div>
  </section>
</template>

<style scoped>
/* Ensure the editor container takes up all available space */
:deep(.monaco-editor) {
  font-family: monospace;
}
</style>
