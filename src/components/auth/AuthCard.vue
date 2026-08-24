<script setup lang="ts">
defineProps<{
  title: string
  subtitle: string
}>()
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface px-4">
    <div class="flex w-full max-w-[400px] flex-col gap-7">
      <div class="flex items-center justify-center gap-2.5">
        <div class="size-[30px] rounded-lg bg-linear-150 from-[#3b82f6] to-[#1d4ed8]" />
        <span class="text-[17px] font-bold text-foreground">Genesis</span>
      </div>

      <div
        class="flex flex-col gap-5 rounded-xl border border-border bg-card p-7 shadow-[0_10px_30px_rgba(29,78,216,.08)]"
      >
        <div class="flex flex-col gap-1 text-center">
          <h1 class="text-xl font-bold text-card-foreground">{{ title }}</h1>
          <p class="text-sm text-muted-foreground">{{ subtitle }}</p>
        </div>

        <slot />
      </div>

      <p class="text-center text-[13px] text-muted-foreground">
        <slot name="footer" />
      </p>
    </div>
  </div>
</template>
