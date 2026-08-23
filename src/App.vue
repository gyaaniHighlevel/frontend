<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
</script>

<template>
  <div
    v-if="!auth.authReady"
    class="flex min-h-screen items-center justify-center bg-surface"
  >
    <div class="flex animate-pulse items-center gap-2.5">
      <div class="size-[30px] rounded-lg bg-linear-150 from-[#3b82f6] to-[#1d4ed8]" />
      <span class="text-[17px] font-bold text-foreground">Genesis</span>
    </div>
  </div>
  <RouterView v-else />
</template>
