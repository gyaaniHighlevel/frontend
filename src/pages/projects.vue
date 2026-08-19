<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { FlaskConical } from '@lucide/vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import ProjectCard from '@/components/dashboard/ProjectCard.vue'
import { useProjectsStore } from '@/stores/projects'

const router = useRouter()
const projects = useProjectsStore()

const promptText = ref('')

const apiChips = [
  { label: 'Contacts', color: '#3b82f6' },
  { label: 'Conversations', color: '#8b5cf6' },
  { label: 'Calendars', color: '#0ea5e9' },
]

const suggestions = [
  'Missed-call text-back console',
  'Pipeline review board',
  'Appointment no-show tracker',
]

function generate() {
  router.push({ name: '/p/[projectId]', params: { projectId: 'contacts-calendar-hub' } })
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-white">
    <AppSidebar />

    <!-- Empty state: the prompt box is the whole page -->
    <main
      v-if="projects.projects.length === 0"
      class="flex flex-1 flex-col items-center justify-center gap-7 px-20"
    >
      <div class="flex flex-col gap-2 text-center">
        <h1 class="text-[34px] leading-[1.15] font-bold text-foreground">
          What should we build for HighLevel?
        </h1>
        <p class="text-[15.5px] leading-normal text-[#5b6879]">
          Describe an app. We generate it against your live Contacts, Conversations and Calendars APIs.
        </p>
      </div>

      <div
        class="flex w-[720px] max-w-full flex-col gap-3.5 rounded-[14px] border border-input bg-white p-[18px] pb-3.5 shadow-[0_10px_30px_rgba(29,78,216,.08)]"
      >
        <textarea
          v-model="promptText"
          rows="2"
          placeholder="Build me a dashboard that shows my recent contacts and upcoming calendar appointments…"
          class="resize-none text-[15px] leading-normal text-foreground outline-none placeholder:text-[#98a3b4]"
        />
        <div class="flex items-center justify-between">
          <div class="flex gap-[7px]">
            <span
              v-for="chip in apiChips"
              :key="chip.label"
              class="flex items-center gap-1.5 rounded-full border border-[#e2e7f0] px-2.5 py-[5px] text-xs leading-none font-medium text-[#5b6879]"
            >
              <span class="size-1.5 rounded-full" :style="{ background: chip.color }" />
              {{ chip.label }}
            </span>
          </div>
          <button
            type="button"
            class="rounded-lg bg-primary px-[18px] py-[9px] text-[13.5px] leading-none font-semibold text-primary-foreground hover:bg-primary/90"
            @click="generate"
          >
            Generate app
          </button>
        </div>
      </div>

      <div class="flex gap-2.5">
        <button
          v-for="suggestion in suggestions"
          :key="suggestion"
          type="button"
          class="rounded-lg border border-[#e2e7f0] bg-surface px-3.5 py-[9px] text-[13px] leading-none font-medium text-[#475569] hover:border-[#c8d3e6]"
          @click="promptText = suggestion"
        >
          {{ suggestion }}
        </button>
      </div>
    </main>

    <!-- Populated state: prompt bar on top, project grid below -->
    <main v-else class="flex flex-1 flex-col gap-[26px] overflow-y-auto bg-white px-11 py-[34px]">
      <div class="flex items-end justify-between">
        <div>
          <h1 class="text-2xl leading-[1.2] font-bold text-foreground">Projects</h1>
          <p class="mt-1 text-sm leading-snug text-[#7a8698]">
            {{ projects.projects.length }} apps · {{ projects.publishedCount }} published to the
            HighLevel marketplace
          </p>
        </div>
        <div class="flex gap-[9px]">
          <button
            type="button"
            class="rounded-lg border border-[#dfe4ec] px-3.5 py-[9px] text-[13px] leading-none font-medium text-[#475569] hover:bg-surface"
          >
            Import from repo
          </button>
          <button
            type="button"
            class="rounded-lg bg-primary px-4 py-[9px] text-[13px] leading-none font-semibold text-primary-foreground hover:bg-primary/90"
          >
            New project
          </button>
        </div>
      </div>

      <div
        class="flex items-center gap-3.5 rounded-xl border border-input bg-[#f9fbfe] px-4 py-3.5"
      >
        <input
          v-model="promptText"
          type="text"
          placeholder="Describe another app…"
          class="flex-1 bg-transparent text-[14.5px] leading-none text-foreground outline-none placeholder:text-[#98a3b4]"
        />
        <button
          type="button"
          class="rounded-lg bg-primary px-4 py-2 text-[13px] leading-none font-semibold text-primary-foreground hover:bg-primary/90"
          @click="generate"
        >
          Generate
        </button>
      </div>

      <div class="grid grid-cols-3 gap-4">
        <ProjectCard v-for="project in projects.projects" :key="project.id" :project="project" />

        <button
          type="button"
          class="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#c8d3e6] bg-surface-soft p-[18px] hover:border-[#9db4dd]"
        >
          <span
            class="size-[30px] rounded-lg bg-accent text-center text-xl leading-[29px] font-normal text-accent-foreground"
          >
            +
          </span>
          <span class="text-[13.5px] leading-none font-semibold text-primary">Start from a template</span>
          <span class="text-[12.5px] leading-none text-[#94a3b8]">12 HighLevel starters</span>
        </button>
      </div>
    </main>

    <!-- Dev-only: flip between empty and populated dashboard states -->
    <button
      type="button"
      title="Dev: toggle demo data"
      class="fixed right-4 bottom-4 flex size-9 items-center justify-center rounded-full border border-border bg-white text-muted-foreground shadow-md hover:text-foreground"
      @click="projects.toggleDemoData()"
    >
      <FlaskConical class="size-4" />
    </button>
  </div>
</template>
