<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChatPanel from '@/components/workspace/ChatPanel.vue'
import EditorPanel from '@/components/workspace/EditorPanel.vue'
import PreviewPanel from '@/components/workspace/PreviewPanel.vue'
import SnapshotSheet from '@/components/workspace/SnapshotSheet.vue'
import WorkspaceTopBar from '@/components/workspace/WorkspaceTopBar.vue'
import { useWorkspaceStore } from '@/stores/workspace'

definePage({
  meta: { requiresAuth: true },
})

const route = useRoute('/p/[projectId]')
const router = useRouter()
const workspace = useWorkspaceStore()

// The router path is the source of truth for the open project (§7): a refresh
// re-selects it, and 403/404 (not yours / deleted / unknown) bounces to the list.
watch(
  () => route.params.projectId,
  async (projectId) => {
    if (typeof projectId !== 'string' || !projectId) return
    await workspace.openProject(projectId)
    if (workspace.loadError) {
      await router.replace({ name: '/projects' })
      return
    }
    // A prompt typed on the dashboard prefills the chat box; sending stays a
    // deliberate user action (seed files are only written on Send).
    if (typeof route.query.prompt === 'string' && route.query.prompt) {
      workspace.prompt = route.query.prompt
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => workspace.closeProject())
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-white">
    <WorkspaceTopBar />
    <div v-if="workspace.loading" class="flex flex-1 items-center justify-center">
      <span class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <span class="size-2 animate-pulse rounded-full bg-primary" />
        Loading project…
      </span>
    </div>
    <div v-else class="flex min-h-0 flex-1">
      <ChatPanel />
      <EditorPanel />
      <PreviewPanel />
    </div>
    <SnapshotSheet />
  </div>
</template>
