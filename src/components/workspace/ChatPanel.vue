<script setup lang="ts">
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()

/** Splits `backtick` spans out of message text for inline-code rendering. */
function textParts(text: string): { code: boolean; t: string }[] {
  return text
    .split('`')
    .map((t, i) => ({ code: i % 2 === 1, t }))
    .filter((part) => part.t.length > 0)
}

function requestFix() {
  workspace.prompt = `The preview threw a runtime error: "${workspace.previewError}". Fix it.`
  workspace.sendPrompt()
}
</script>

<template>
  <section class="flex w-[420px] shrink-0 flex-col border-r border-border bg-surface-soft">
    <div class="flex items-center justify-between border-b border-[#eef1f6] px-[18px] py-3.5">
      <span class="text-[12.5px] leading-none font-semibold text-foreground">Chat</span>
      <span class="font-mono text-[11.5px] leading-none text-[#94a3b8]">
        {{ workspace.model }} · {{ workspace.tokensLabel }}
      </span>
    </div>

    <div class="flex flex-1 flex-col gap-4 overflow-y-auto p-[18px]">
      <template v-for="message in workspace.messages" :key="message.id">
        <!-- User bubble -->
        <div
          v-if="message.role === 'user'"
          class="max-w-[320px] self-end rounded-xl rounded-br-[4px] bg-primary px-3.5 py-[11px] text-[13.5px] leading-normal text-white"
        >
          {{ message.text }}
        </div>

        <!-- Assistant turn -->
        <div v-else class="flex flex-col gap-[9px]">
          <div class="flex items-center gap-[7px]">
            <div class="size-5 rounded-md bg-linear-150 from-[#3b82f6] to-[#1d4ed8]" />
            <span class="text-[12.5px] leading-none font-semibold text-foreground">Genesis</span>
          </div>

          <p class="text-[13.5px] leading-[1.6] text-[#334155]">
            <template v-for="(part, i) in textParts(message.text)" :key="i">
              <span v-if="part.code" class="font-mono text-[12.5px] font-medium text-primary">{{
                part.t
              }}</span>
              <template v-else>{{ part.t }}</template>
            </template>
          </p>

          <div
            v-if="message.apiCalls?.length"
            class="overflow-hidden rounded-[9px] border border-[#e2e8f4] bg-white"
          >
            <div
              class="border-b border-[#eef1f6] px-3 py-2 font-mono text-[11px] leading-none font-semibold tracking-[0.08em] uppercase text-[#94a3b8]"
            >
              HighLevel calls
            </div>
            <div
              v-for="(call, i) in message.apiCalls"
              :key="call.path"
              class="flex items-center gap-2 px-3 py-[9px]"
              :class="i < message.apiCalls.length - 1 && 'border-b border-[#f4f7fb]'"
            >
              <span class="rounded bg-success-soft px-1.5 py-0.5 font-mono text-[10px] leading-normal font-semibold text-success">
                {{ call.method }}
              </span>
              <span class="font-mono text-[11.5px] leading-snug text-[#475569]">{{ call.path }}</span>
            </div>
          </div>

          <div
            v-if="message.checklist?.length"
            class="flex flex-col gap-[5px] text-[12.5px] leading-[1.6] text-[#64748b]"
          >
            <div v-for="item in message.checklist" :key="item">✓ {{ item }}</div>
          </div>

          <div v-if="message.filesChanged?.length" class="flex flex-wrap gap-1.5">
            <span
              v-for="path in message.filesChanged"
              :key="path"
              class="rounded-md bg-muted px-2 py-1 font-mono text-[11px] leading-none font-medium text-[#475569]"
            >
              {{ path }}
            </span>
          </div>

          <div v-if="message.scopeRequest" class="flex gap-2">
            <button
              type="button"
              class="rounded-[7px] bg-primary px-3.5 py-[7px] text-[12.5px] leading-none font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Approve scope
            </button>
            <button
              type="button"
              class="rounded-[7px] border border-[#dfe4ec] bg-white px-3.5 py-[7px] text-[12.5px] leading-none font-medium text-[#475569] hover:bg-surface"
            >
              Skip
            </button>
          </div>
        </div>
      </template>

      <!-- Ephemeral streaming turn -->
      <div v-if="workspace.generationStatus === 'streaming'" class="flex flex-col gap-[9px]">
        <div class="flex items-center gap-[7px]">
          <div class="size-5 rounded-md bg-linear-150 from-[#3b82f6] to-[#1d4ed8]" />
          <span class="text-[12.5px] leading-none font-semibold text-foreground">Genesis</span>
        </div>
        <p class="flex items-center gap-2 text-[13.5px] leading-[1.6] text-[#64748b]">
          <span class="size-2 animate-pulse rounded-full bg-primary" />
          Writing {{ workspace.activeFilePath }}…
        </p>
      </div>
    </div>

    <!-- Runtime error affordance (LLD §9.4): one click sends a structured fix turn -->
    <div v-if="workspace.previewError" class="border-t border-[#eef1f6] bg-warning-soft px-4 py-2.5">
      <button
        type="button"
        class="w-full text-left text-[12.5px] leading-[1.5] text-warning hover:underline"
        @click="requestFix()"
      >
        Preview threw: <span class="font-mono text-[11.5px]">{{ workspace.previewError }}</span> — Fix this
      </button>
    </div>

    <div class="border-t border-[#eef1f6] bg-white px-4 py-3.5">
      <div class="flex flex-col gap-2.5 rounded-[10px] border border-input px-3 py-[11px]">
        <textarea
          v-model="workspace.prompt"
          rows="1"
          placeholder="Ask for a change…"
          :disabled="workspace.generationStatus === 'streaming'"
          class="resize-none text-[13.5px] leading-snug text-foreground outline-none placeholder:text-[#98a3b4] disabled:opacity-50"
          @keydown.meta.enter="workspace.sendPrompt()"
        />
        <div class="flex items-center justify-between">
          <span class="font-mono text-[11.5px] leading-none text-[#a8b2c1]">⌘⏎ to send</span>
          <button
            type="button"
            :disabled="workspace.generationStatus === 'streaming'"
            class="rounded-[7px] bg-primary px-[13px] py-1.5 text-xs leading-none font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            @click="workspace.sendPrompt()"
          >
            {{ workspace.generationStatus === 'streaming' ? 'Generating…' : 'Send' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
