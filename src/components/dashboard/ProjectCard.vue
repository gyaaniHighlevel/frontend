<script setup lang="ts">
import { computed } from 'vue'
import { Pencil, Trash2 } from '@lucide/vue'
import type { Project } from '@/types'
import { relativeTime } from '@/lib/utils'

const { project } = defineProps<{ project: Project }>()

const emit = defineEmits<{
  rename: [project: Project]
  delete: [project: Project]
}>()

/** Deterministic icon tint per project so cards keep a stable identity. */
const tints = [
  { bg: '#e6efff', fg: '#1d4ed8' },
  { bg: '#ede9fe', fg: '#7c3aed' },
  { bg: '#fff1e6', fg: '#c2410c' },
  { bg: '#e6f6fb', fg: '#0369a1' },
  { bg: '#e8f7ee', fg: '#15803d' },
]

const tint = computed(() => {
  let hash = 0
  for (const ch of project.id) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return tints[Math.abs(hash) % tints.length]
})

const initials = computed(() =>
  project.name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2),
)
</script>

<template>
  <RouterLink
    :to="{ name: '/p/[projectId]', params: { projectId: project.id } }"
    class="group flex flex-col gap-3.5 rounded-xl border border-[#dbe2ee] bg-white p-[18px] text-left shadow-[0_1px_2px_rgba(15,23,42,.04)] transition-shadow hover:no-underline hover:shadow-[0_4px_14px_rgba(15,23,42,.08)]"
  >
    <div class="flex items-start justify-between">
      <div
        class="size-[34px] rounded-[9px] text-center text-[13px] leading-[34px] font-bold"
        :style="{ background: tint.bg, color: tint.fg }"
      >
        {{ initials }}
      </div>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          title="Rename project"
          class="rounded-md p-1.5 text-[#b6c0cf] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface hover:text-foreground"
          @click.stop.prevent="emit('rename', project)"
        >
          <Pencil class="size-3.5" />
        </button>
        <button
          type="button"
          title="Delete project"
          class="rounded-md p-1.5 text-[#b6c0cf] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-warning-soft hover:text-warning"
          @click.stop.prevent="emit('delete', project)"
        >
          <Trash2 class="size-3.5" />
        </button>
        <span
          class="rounded-full bg-muted px-[9px] py-1 text-[11px] leading-none font-semibold text-muted-foreground"
        >
          Draft
        </span>
      </div>
    </div>

    <div>
      <div class="text-[15.5px] leading-[1.3] font-semibold text-foreground">{{ project.name }}</div>
      <div class="mt-1 line-clamp-2 min-h-[1.2em] text-[13px] leading-normal text-[#7a8698]">
        {{ project.description || 'No description yet.' }}
      </div>
    </div>

    <div class="border-t border-[#eef1f6] pt-3 text-xs leading-none text-[#94a3b8]">
      edited {{ relativeTime(project.updatedAt) }}
    </div>
  </RouterLink>
</template>
