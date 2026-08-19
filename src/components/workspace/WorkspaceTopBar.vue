<script setup lang="ts">
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
</script>

<template>
  <header class="flex items-center justify-between border-b border-border bg-white px-[18px] py-2.5">
    <div class="flex items-center gap-3">
      <RouterLink :to="{ name: '/projects' }" class="block hover:opacity-80" title="Back to projects">
        <div class="size-6 rounded-[7px] bg-linear-150 from-[#3b82f6] to-[#1d4ed8]" />
      </RouterLink>
      <span class="text-sm leading-none font-semibold text-foreground">{{ workspace.projectName }}</span>
      <span class="rounded-md bg-muted px-2 py-[3px] font-mono text-[11.5px] leading-snug font-medium text-muted-foreground">
        v{{ workspace.version }}
      </span>
      <span
        v-if="workspace.saved"
        class="flex items-center gap-1.5 rounded-full bg-success-soft px-[9px] py-[3px] text-[11.5px] leading-snug font-semibold text-success"
      >
        <span class="size-1.5 rounded-full bg-success-dot" />
        Saved
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
      <button
        type="button"
        class="rounded-[7px] border border-[#dfe4ec] px-[13px] py-[7px] text-[12.5px] leading-none font-medium text-[#475569] hover:bg-surface"
      >
        Scopes
      </button>
      <button
        type="button"
        class="rounded-[7px] bg-primary px-4 py-[7px] text-[12.5px] leading-none font-semibold text-primary-foreground hover:bg-primary/90"
      >
        Publish
      </button>
    </div>
  </header>
</template>
