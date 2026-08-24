<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Pencil } from '@lucide/vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { backendErrorMessage } from '@/lib/backend'

const workspace = useWorkspaceStore()

const editing = ref(false)
const editName = ref('')
const savingName = ref(false)
const nameInput = ref<HTMLInputElement>()

async function startEditing() {
  editName.value = workspace.projectName
  editing.value = true
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}

async function commitRename() {
  if (!editing.value || savingName.value) return
  savingName.value = true
  try {
    await workspace.rename(editName.value)
    editing.value = false
  } catch (e) {
    console.error('rename failed:', backendErrorMessage(e))
  } finally {
    savingName.value = false
  }
}
</script>

<template>
  <header class="flex items-center justify-between border-b border-border bg-white px-[18px] py-2.5">
    <div class="flex items-center gap-3">
      <RouterLink :to="{ name: '/projects' }" class="block hover:opacity-80" title="Back to projects">
        <div class="size-6 rounded-[7px] bg-linear-150 from-[#3b82f6] to-[#1d4ed8]" />
      </RouterLink>

      <template v-if="editing">
        <input
          ref="nameInput"
          v-model="editName"
          maxlength="80"
          :disabled="savingName"
          class="rounded-md border border-input px-2 py-1 text-sm font-semibold text-foreground outline-none"
          @keydown.enter="commitRename"
          @keydown.esc="editing = false"
          @blur="commitRename"
        />
      </template>
      <template v-else>
        <span class="text-sm leading-none font-semibold text-foreground">{{ workspace.projectName }}</span>
        <button
          type="button"
          title="Rename project"
          class="rounded-md p-1 text-[#b6c0cf] hover:bg-surface hover:text-foreground"
          @click="startEditing"
        >
          <Pencil class="size-3.5" />
        </button>
      </template>

      <span class="rounded-md bg-muted px-2 py-[3px] font-mono text-[11.5px] leading-snug font-medium text-muted-foreground">
        v{{ workspace.version }}
      </span>
      <span
        v-if="workspace.saved && !workspace.busy"
        class="flex items-center gap-1.5 rounded-full bg-success-soft px-[9px] py-[3px] text-[11.5px] leading-snug font-semibold text-success"
      >
        <span class="size-1.5 rounded-full bg-success-dot" />
        Saved
      </span>
      <span
        v-else-if="workspace.busy"
        class="flex items-center gap-1.5 rounded-full bg-accent px-[9px] py-[3px] text-[11.5px] leading-snug font-semibold text-accent-foreground"
      >
        <span class="size-1.5 animate-pulse rounded-full bg-primary" />
        {{ workspace.generationStatus === 'committing' ? 'Saving…' : 'Generating…' }}
      </span>
    </div>
    <div class="flex items-center gap-[9px]">
      <button
        type="button"
        class="rounded-[7px] border border-[#dfe4ec] px-[13px] py-[7px] text-[12.5px] leading-none font-medium text-[#475569] hover:bg-surface"
        @click="workspace.historyOpen = true"
      >
        History
      </button>
    </div>
  </header>
</template>
