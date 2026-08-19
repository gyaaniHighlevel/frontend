<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()

const device = ref<'desktop' | 'mobile'>('desktop')
const iframeEl = ref<HTMLIFrameElement>()

// postMessage listener (LLD §9.3): only trust the iframe we created.
function onMessage(event: MessageEvent) {
  if (!iframeEl.value || event.source !== iframeEl.value.contentWindow) return
  const data = event.data as { type?: string; message?: string } | null
  if (data?.type === 'genesis:error' && data.message) {
    workspace.reportPreviewError(data.message)
  }
}

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>

<template>
  <section class="flex min-w-0 flex-1 flex-col bg-surface-preview">
    <!-- Toolbar -->
    <div class="flex items-center justify-between border-b border-border bg-white px-4 py-2.5">
      <div class="flex items-center gap-[9px]">
        <span class="text-[12.5px] leading-none font-semibold text-foreground">Preview</span>
        <span class="rounded-full bg-accent px-2 py-[3px] text-[11px] leading-snug font-semibold text-accent-foreground">
          Live HighLevel data
        </span>
      </div>
      <div class="flex gap-2 text-[11.5px] leading-none font-medium text-muted-foreground">
        <button
          type="button"
          class="rounded-md px-2.5 py-[5px]"
          :class="device === 'desktop' ? 'border border-[#e2e7f0]' : 'text-[#94a3b8]'"
          @click="device = 'desktop'"
        >
          Desktop
        </button>
        <button
          type="button"
          class="rounded-md px-2.5 py-[5px]"
          :class="device === 'mobile' ? 'border border-[#e2e7f0]' : 'text-[#94a3b8]'"
          @click="device = 'mobile'"
        >
          Mobile
        </button>
        <button
          type="button"
          class="rounded-md border border-[#e2e7f0] px-2.5 py-[5px]"
          @click="workspace.rebuildPreview()"
        >
          Reload
        </button>
      </div>
    </div>

    <!-- Generated app: srcdoc built by the platform shell, opaque origin (INV-5) -->
    <div class="min-h-0 flex-1 p-5">
      <div
        class="relative mx-auto h-full overflow-hidden rounded-[10px] border border-[#e2e8f2] bg-white"
        :class="device === 'mobile' && 'max-w-[390px]'"
      >
        <iframe
          ref="iframeEl"
          :key="workspace.previewKey"
          :srcdoc="workspace.srcdoc"
          sandbox="allow-scripts"
          title="Generated app preview"
          class="size-full border-0"
        />
        <div
          v-if="workspace.generationStatus === 'streaming'"
          class="absolute inset-0 flex items-center justify-center bg-white/70"
        >
          <span class="flex items-center gap-2 rounded-full border border-[#bfd4fb] bg-white px-4 py-2 text-[12.5px] font-semibold text-primary shadow-sm">
            <span class="size-2 animate-pulse rounded-full bg-primary" />
            Generating…
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
