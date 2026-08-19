<script setup lang="ts">
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useWorkspaceStore } from '@/stores/workspace'
import type { Version } from '@/types'

const workspace = useWorkspaceStore()

function rowClass(version: Version): string {
  if (version.status === 'live') return 'bg-white border border-border'
  if (version.id === workspace.viewingVersionId) return 'bg-[#e9f0ff] border border-[#bfd4fb]'
  return 'border border-transparent hover:bg-white'
}
</script>

<template>
  <Sheet v-model:open="workspace.historyOpen">
    <SheetContent
      side="right"
      :show-close-button="false"
      class="flex flex-row gap-0 p-0 data-[side=right]:w-[min(1200px,94vw)] data-[side=right]:sm:max-w-none"
    >
      <!-- Version list -->
      <div class="flex w-[340px] shrink-0 flex-col border-r border-border bg-surface-soft">
        <SheetHeader class="gap-0 border-b border-[#eef1f6] p-[18px]">
          <SheetTitle class="text-base leading-[1.2] font-bold text-foreground">
            Version history
          </SheetTitle>
          <SheetDescription class="mt-[3px] text-[12.5px] leading-snug text-[#8894a6]">
            {{ workspace.version }} versions · auto-saved per turn
          </SheetDescription>
        </SheetHeader>

        <div class="flex flex-1 flex-col gap-1.5 overflow-y-auto p-3.5">
          <button
            v-for="version in workspace.versions"
            :key="version.id"
            type="button"
            class="flex flex-col gap-[5px] rounded-[9px] p-3 text-left"
            :class="rowClass(version)"
            @click="version.status !== 'live' && (workspace.viewingVersionId = version.id)"
          >
            <div class="flex items-center justify-between">
              <span
                class="text-[12.5px] leading-none font-semibold"
                :class="{
                  'text-foreground': version.status === 'ok',
                  'text-primary': version.id === workspace.viewingVersionId,
                  'text-[#94a3b8]': version.status === 'failed',
                }"
              >
                <template v-if="version.status === 'live'">v{{ version.version }} · Current</template>
                <template v-else-if="version.status === 'failed'">v{{ version.version }} · build failed</template>
                <template v-else>v{{ version.version }}</template>
              </span>
              <span
                v-if="version.status === 'live'"
                class="rounded-[5px] bg-success-soft px-[7px] py-[3px] text-[10.5px] leading-snug font-semibold text-success"
              >
                Live
              </span>
              <span
                v-else-if="version.id === workspace.viewingVersionId"
                class="font-mono text-[11px] leading-none font-medium text-primary"
              >
                viewing
              </span>
            </div>
            <div
              class="text-xs leading-[1.45]"
              :class="{
                'text-[#7a8698]': version.status !== 'failed' && version.id !== workspace.viewingVersionId,
                'text-[#3b5697]': version.id === workspace.viewingVersionId,
                'text-[#a8b2c1]': version.status === 'failed',
              }"
            >
              {{ version.title }}
            </div>
            <div
              class="font-mono text-[11px] leading-none"
              :class="{
                'text-[#a8b2c1]': version.status !== 'failed' && version.id !== workspace.viewingVersionId,
                'text-[#7d97cc]': version.id === workspace.viewingVersionId,
                'text-[#c0c8d4]': version.status === 'failed',
              }"
            >
              {{ version.timeLabel }}<template v-if="version.filesLabel"> · {{ version.filesLabel }}</template>
            </div>
          </button>
        </div>
      </div>

      <!-- Diff pane -->
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div class="flex items-center gap-2.5">
            <span class="text-sm leading-none font-semibold text-foreground">
              v{{ workspace.viewingVersion.version }} → v{{ workspace.version }}
            </span>
            <span class="font-mono text-[12.5px] leading-none text-[#8894a6]">2 files changed</span>
            <span class="font-mono text-xs leading-none font-medium text-success">+34</span>
            <span class="font-mono text-xs leading-none font-medium text-destructive">−6</span>
          </div>
          <div class="flex gap-[9px]">
            <button
              type="button"
              class="rounded-[7px] border border-[#dfe4ec] px-3.5 py-2 text-[12.5px] leading-none font-medium text-[#475569] hover:bg-surface"
            >
              Preview v{{ workspace.viewingVersion.version }}
            </button>
            <button
              type="button"
              class="rounded-[7px] bg-primary px-4 py-2 text-[12.5px] leading-none font-semibold text-primary-foreground hover:bg-primary/90"
              @click="workspace.restoreViewingVersion()"
            >
              Restore v{{ workspace.viewingVersion.version }}
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto bg-editor py-4 font-mono text-xs leading-[1.9]">
          <template v-for="(file, fi) in workspace.diff" :key="file.path">
            <div
              class="px-[18px] pb-2.5 text-[11px] leading-none font-semibold text-[#64748b]"
              :class="fi > 0 && 'pt-[22px]'"
            >
              {{ file.path }}
            </div>
            <div
              v-for="(line, li) in file.lines"
              :key="li"
              class="flex px-[18px]"
              :class="{ 'bg-[#3f1d1d]': line.kind === 'del', 'bg-[#12331f]': line.kind === 'add' }"
            >
              <span
                class="w-11 shrink-0"
                :class="{
                  'text-[#3c4a63]': line.kind === 'ctx',
                  'text-[#a56a6a]': line.kind === 'del',
                  'text-[#6ba57f]': line.kind === 'add',
                }"
              >
                {{ line.num }}
              </span>
              <span
                class="whitespace-pre"
                :class="{
                  'text-[#94a3b8]': line.kind === 'ctx',
                  'text-[#fca5a5]': line.kind === 'del',
                  'text-[#86efac]': line.kind === 'add',
                }"
              >
                {{ line.text }}
              </span>
            </div>
          </template>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
