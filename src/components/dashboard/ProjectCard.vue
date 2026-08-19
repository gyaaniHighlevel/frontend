<script setup lang="ts">
import type { HlScope, Project, ProjectStatus } from '@/types'

const { project } = defineProps<{ project: Project }>()

const scopeColors: Record<HlScope, string> = {
  contacts: '#3b82f6',
  conversations: '#8b5cf6',
  calendars: '#0ea5e9',
}

const statusPills: Record<ProjectStatus, { label: string; class: string; dot?: boolean }> = {
  published: { label: 'Published', class: 'bg-success-soft text-success' },
  generating: { label: 'Generating', class: 'bg-accent text-accent-foreground', dot: true },
  draft: { label: 'Draft', class: 'bg-muted text-muted-foreground' },
  failed: { label: 'Build failed', class: 'bg-warning-soft text-warning' },
}

function footerText(p: Project): string {
  if (p.status === 'generating') return p.statusNote ?? 'Generating…'
  if (p.status === 'failed') return `v${p.version} · ${p.statusNote}`
  return `v${p.version} · edited ${p.editedLabel}`
}
</script>

<template>
  <RouterLink
    :to="{ name: '/p/[projectId]', params: { projectId: project.id } }"
    class="flex flex-col gap-3.5 rounded-xl border bg-white p-[18px] text-left shadow-[0_1px_2px_rgba(15,23,42,.04)] transition-shadow hover:no-underline hover:shadow-[0_4px_14px_rgba(15,23,42,.08)]"
    :class="project.status === 'generating' ? 'border-[#bfd4fb]' : 'border-[#dbe2ee]'"
  >
    <div class="flex items-start justify-between">
      <div
        class="size-[34px] rounded-[9px] text-center text-[13px] leading-[34px] font-bold"
        :style="{ background: project.iconBg, color: project.iconColor }"
      >
        {{ project.initials }}
      </div>
      <span
        class="flex items-center gap-[5px] rounded-full px-[9px] py-1 text-[11px] leading-none font-semibold"
        :class="statusPills[project.status].class"
      >
        <span v-if="statusPills[project.status].dot" class="size-1.5 rounded-full bg-primary" />
        {{ statusPills[project.status].label }}
      </span>
    </div>

    <div>
      <div class="text-[15.5px] leading-[1.3] font-semibold text-foreground">{{ project.name }}</div>
      <div class="mt-1 text-[13px] leading-normal text-[#7a8698]">{{ project.description }}</div>
    </div>

    <div v-if="project.status === 'generating'" class="h-[5px] overflow-hidden rounded-full bg-[#e8eef8]">
      <div class="h-full bg-primary" :style="{ width: `${project.progress ?? 0}%` }" />
    </div>
    <div v-else class="flex gap-1.5">
      <span
        v-for="scope in project.scopes"
        :key="scope"
        class="rounded-md bg-muted px-2 py-1 font-mono text-[11px] leading-none font-medium"
        :style="{ color: scopeColors[scope] }"
      >
        {{ scope }}
      </span>
    </div>

    <div class="border-t border-[#eef1f6] pt-3 text-xs leading-none text-[#94a3b8]">
      {{ footerText(project) }}
    </div>
  </RouterLink>
</template>
