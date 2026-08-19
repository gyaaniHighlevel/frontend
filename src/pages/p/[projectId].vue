<script setup lang="ts">
import ChatPanel from '@/components/workspace/ChatPanel.vue'
import EditorPanel from '@/components/workspace/EditorPanel.vue'
import PreviewPanel from '@/components/workspace/PreviewPanel.vue'
import SnapshotSheet from '@/components/workspace/SnapshotSheet.vue'
import WorkspaceTopBar from '@/components/workspace/WorkspaceTopBar.vue'
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-white">
    <WorkspaceTopBar />
    <div class="flex min-h-0 flex-1">
      <ChatPanel />
      <EditorPanel />
      <PreviewPanel />
    </div>
    <SnapshotSheet />
  </div>
</template>
