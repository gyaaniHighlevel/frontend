<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { highlight, languageFor } from '@/lib/highlight'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()

const codeLines = computed(() =>
  highlight(workspace.activeFile.content, languageFor(workspace.activeFile.path)),
)

const totalLines = computed(() =>
  workspace.files.reduce((sum, file) => sum + file.content.split('\n').length, 0),
)

/** Platform-owned pieces of the document shell (LLD §1.2) — shown for context. */
const platformFiles = ['hl-sdk.js', 'import map', 'tailwind']

// Follow-the-cursor while a generation streams into the active file (§10.3).
const codeScroller = ref<HTMLElement>()
watch(
  () => workspace.activeFile.content,
  async () => {
    if (workspace.generationStatus !== 'streaming') return
    await nextTick()
    codeScroller.value?.scrollTo({ top: codeScroller.value.scrollHeight })
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

      <!-- Code -->
      <div ref="codeScroller" class="flex-1 overflow-auto py-3.5 font-mono text-xs leading-[1.85]">
        <div v-for="(line, i) in codeLines" :key="i" class="flex px-3.5">
          <span class="w-8 shrink-0 text-[#3c4a63]">{{ i + 1 }}</span>
          <span class="whitespace-pre">
            <span v-for="(seg, j) in line.seg" :key="j" :style="{ color: seg.c ?? '#cbd5e1' }">{{
              seg.t
            }}</span>
          </span>
        </div>
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
