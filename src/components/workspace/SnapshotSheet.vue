<script setup lang="ts">
import { computed } from 'vue'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useWorkspaceStore } from '@/stores/workspace'
import { diffStats } from '@/lib/diff'
import type { Version } from '@/types'

const workspace = useWorkspaceStore()

const stats = computed(() => diffStats(workspace.diff))

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
            {{ workspace.versions.length }}
            {{ workspace.versions.length === 1 ? 'version' : 'versions' }} · saved per send
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
                  'text-foreground': version.status === 'ok' && version.id !== workspace.viewingVersionId,
                  'text-primary': version.id === workspace.viewingVersionId,
                }"
              >
                <template v-if="version.status === 'live'">v{{ version.version }} · Current</template>
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
              :class="version.id === workspace.viewingVersionId ? 'text-[#3b5697]' : 'text-[#7a8698]'"
            >
              {{ version.title }}
            </div>
            <div
              class="font-mono text-[11px] leading-none"
              :class="version.id === workspace.viewingVersionId ? 'text-[#7d97cc]' : 'text-[#a8b2c1]'"
            >
              {{ version.timeLabel }}<template v-if="version.filesLabel"> · {{ version.filesLabel }}</template>
            </div>
          </button>
        </div>
      </div>

      <!-- Diff pane -->
      <div class="flex min-w-0 flex-1 flex-col">
        <template v-if="workspace.viewingVersion">
          <div class="flex items-center justify-between border-b border-border px-5 py-3.5">
            <div class="flex items-center gap-2.5">
              <span class="text-sm leading-none font-semibold text-foreground">
                v{{ workspace.viewingVersion.version }} → v{{ workspace.version }}
              </span>
              <span class="font-mono text-[12.5px] leading-none text-[#8894a6]">
                {{ workspace.diff.length }} {{ workspace.diff.length === 1 ? 'file' : 'files' }} changed
              </span>
              <span class="font-mono text-xs leading-none font-medium text-success">+{{ stats.added }}</span>
              <span class="font-mono text-xs leading-none font-medium text-destructive">−{{ stats.removed }}</span>
            </div>
            <button
              type="button"
              :disabled="workspace.restoring"
              class="rounded-[7px] bg-primary px-4 py-2 text-[12.5px] leading-none font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              @click="workspace.restoreViewingVersion()"
            >
              {{ workspace.restoring ? 'Restoring…' : `Restore v${workspace.viewingVersion.version}` }}
            </button>
          </div>

          <div
            v-if="workspace.diffLoading"
            class="flex flex-1 items-center justify-center bg-editor font-mono text-xs text-[#64748b]"
          >
            computing diff…
          </div>
          <div
            v-else-if="workspace.diff.length === 0"
            class="flex flex-1 items-center justify-center bg-editor font-mono text-xs text-[#64748b]"
          >
            identical to the current version
          </div>
          <div v-else class="flex-1 overflow-y-auto bg-editor py-4 font-mono text-xs leading-[1.9]">
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
        </template>
        <div
          v-else
          class="flex flex-1 items-center justify-center bg-editor font-mono text-xs text-[#64748b]"
        >
          no earlier versions yet — send a prompt to create one
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
