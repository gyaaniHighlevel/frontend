<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
</script>

<template>
  <div class="flex flex-col gap-2 rounded-[9px] border border-border bg-white p-3">
    <template v-if="auth.hl.connected">
      <div class="flex items-center gap-[7px]">
        <span class="size-[7px] rounded-full bg-success-dot" />
        <span class="text-xs font-semibold text-foreground">HighLevel connected</span>
      </div>
      <div class="text-[11.5px] leading-[1.45] text-[#7a8698]">
        {{ auth.hl.locationType }} · {{ auth.hl.locationName }}<br />
        {{ auth.hl.scopes.join(', ') }}
      </div>
    </template>
    <template v-else>
      <div class="flex items-center gap-[7px]">
        <span class="size-[7px] rounded-full bg-[#94a3b8]" />
        <span class="text-xs font-semibold text-foreground">HighLevel not connected</span>
      </div>
      <button
        type="button"
        class="rounded-[7px] bg-primary px-3 py-[7px] text-xs font-semibold text-primary-foreground hover:bg-primary/90"
      >
        Connect HighLevel
      </button>
    </template>
  </div>
</template>
