<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArchiveRestore, Trash2 } from '@lucide/vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import ProjectCard from '@/components/dashboard/ProjectCard.vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useProjectsStore } from '@/stores/projects'
import { backendErrorMessage } from '@/lib/backend'
import { relativeTime } from '@/lib/utils'
import type { Project } from '@/types'

definePage({
  meta: { requiresAuth: true },
})

const router = useRouter()
const projects = useProjectsStore()

const promptText = ref('')
const creating = ref(false)
const actionError = ref<string | null>(null)

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

onMounted(() => {
  void projects.fetchProjects()
})

/** Short project name derived from the prompt's first line. */
function nameFromPrompt(text: string): string {
  const firstLine = text.split('\n')[0].trim()
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine || 'Untitled app'
}

async function generate() {
  if (creating.value) return
  creating.value = true
  actionError.value = null
  const prompt = promptText.value.trim()
  try {
    const projectId = await projects.createProject(
      nameFromPrompt(prompt),
      prompt || undefined,
    )
    await router.push({
      name: '/p/[projectId]',
      params: { projectId },
      query: prompt ? { prompt } : undefined,
    })
  } catch (e) {
    actionError.value = backendErrorMessage(e)
  } finally {
    creating.value = false
  }
}

async function newProject() {
  if (creating.value) return
  creating.value = true
  actionError.value = null
  try {
    const projectId = await projects.createProject('Untitled app')
    await router.push({ name: '/p/[projectId]', params: { projectId } })
  } catch (e) {
    actionError.value = backendErrorMessage(e)
  } finally {
    creating.value = false
  }
}

// --- Rename dialog ---
const renameTarget = ref<Project | null>(null)
const renameName = ref('')
const renameSaving = ref(false)

function openRename(project: Project) {
  renameTarget.value = project
  renameName.value = project.name
}

async function saveRename() {
  const target = renameTarget.value
  const name = renameName.value.trim()
  if (!target || !name || renameSaving.value) return
  renameSaving.value = true
  actionError.value = null
  try {
    await projects.renameProject(target.id, name)
    renameTarget.value = null
  } catch (e) {
    actionError.value = backendErrorMessage(e)
  } finally {
    renameSaving.value = false
  }
}

// --- Delete + trash ---
const showTrash = ref(false)

async function deleteProject(project: Project) {
  if (!window.confirm(`Move "${project.name}" to trash? You can restore it later.`)) return
  actionError.value = null
  try {
    await projects.softDeleteProject(project.id)
  } catch (e) {
    actionError.value = backendErrorMessage(e)
  }
}

async function toggleTrash() {
  showTrash.value = !showTrash.value
  if (showTrash.value) {
    try {
      await projects.fetchDeleted()
    } catch (e) {
      actionError.value = backendErrorMessage(e)
    }
  }
}

async function restoreProject(project: Project) {
  actionError.value = null
  try {
    await projects.restoreProject(project.id)
  } catch (e) {
    actionError.value = backendErrorMessage(e)
  }
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-white">
    <AppSidebar />

    <!-- Loading -->
    <main v-if="projects.loading && !projects.loaded" class="flex flex-1 items-center justify-center">
      <span class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <span class="size-2 animate-pulse rounded-full bg-primary" />
        Loading projects…
      </span>
    </main>

    <!-- List failed to load -->
    <main v-else-if="projects.error" class="flex flex-1 flex-col items-center justify-center gap-3">
      <p class="text-sm text-destructive">{{ projects.error }}</p>
      <Button variant="outline" size="sm" @click="projects.fetchProjects()">Retry</Button>
    </main>

    <!-- Empty state: the prompt box is the whole page -->
    <main
      v-else-if="projects.projects.length === 0 && !showTrash"
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
            :disabled="creating"
            class="rounded-lg bg-primary px-[18px] py-[9px] text-[13.5px] leading-none font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            @click="generate"
          >
            {{ creating ? 'Creating…' : 'Generate app' }}
          </button>
        </div>
      </div>

      <p v-if="actionError" class="text-sm text-destructive">{{ actionError }}</p>

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

      <button
        type="button"
        class="text-[12.5px] font-medium text-[#94a3b8] hover:text-[#475569] hover:underline"
        @click="toggleTrash"
      >
        View trash
      </button>
    </main>

    <!-- Populated state: prompt bar on top, project grid below -->
    <main v-else class="flex flex-1 flex-col gap-[26px] overflow-y-auto bg-white px-11 py-[34px]">
      <div class="flex items-end justify-between">
        <div>
          <h1 class="text-2xl leading-[1.2] font-bold text-foreground">Projects</h1>
          <p class="mt-1 text-sm leading-snug text-[#7a8698]">
            {{ projects.projects.length }} {{ projects.projects.length === 1 ? 'app' : 'apps' }}
          </p>
        </div>
        <div class="flex gap-[9px]">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-lg border border-[#dfe4ec] px-3.5 py-[9px] text-[13px] leading-none font-medium text-[#475569] hover:bg-surface"
            @click="toggleTrash"
          >
            <Trash2 class="size-3.5" />
            {{ showTrash ? 'Hide trash' : 'Trash' }}
          </button>
          <button
            type="button"
            :disabled="creating"
            class="rounded-lg bg-primary px-4 py-[9px] text-[13px] leading-none font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            @click="newProject"
          >
            {{ creating ? 'Creating…' : 'New project' }}
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
          @keydown.enter="generate"
        />
        <button
          type="button"
          :disabled="creating"
          class="rounded-lg bg-primary px-4 py-2 text-[13px] leading-none font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          @click="generate"
        >
          {{ creating ? 'Creating…' : 'Generate' }}
        </button>
      </div>

      <p v-if="actionError" class="text-sm text-destructive">{{ actionError }}</p>

      <div class="grid grid-cols-3 gap-4">
        <ProjectCard
          v-for="project in projects.projects"
          :key="project.id"
          :project="project"
          @rename="openRename"
          @delete="deleteProject"
        />
      </div>

      <!-- Trash: soft-deleted projects, restorable -->
      <section v-if="showTrash" class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold text-foreground">Trash</h2>
        <p v-if="projects.deletedProjects.length === 0" class="text-[13px] text-[#94a3b8]">
          Nothing in the trash.
        </p>
        <div
          v-for="project in projects.deletedProjects"
          :key="project.id"
          class="flex items-center justify-between rounded-xl border border-dashed border-[#dfe4ec] bg-surface-soft px-4 py-3"
        >
          <div>
            <div class="text-[13.5px] font-semibold text-[#64748b]">{{ project.name }}</div>
            <div class="text-xs text-[#94a3b8]">deleted · was edited {{ relativeTime(project.updatedAt) }}</div>
          </div>
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-lg border border-[#dfe4ec] bg-white px-3 py-2 text-[12.5px] leading-none font-medium text-[#475569] hover:bg-surface"
            @click="restoreProject(project)"
          >
            <ArchiveRestore class="size-3.5" />
            Restore
          </button>
        </div>
      </section>
    </main>

    <!-- Rename dialog -->
    <Dialog :open="renameTarget !== null" @update:open="(open: boolean) => !open && (renameTarget = null)">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
          <DialogDescription>1–80 characters.</DialogDescription>
        </DialogHeader>
        <Input v-model="renameName" maxlength="80" @keydown.enter="saveRename" />
        <DialogFooter>
          <Button variant="outline" @click="renameTarget = null">Cancel</Button>
          <Button :disabled="renameSaving || !renameName.trim()" @click="saveRename">
            {{ renameSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
